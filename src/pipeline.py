from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from src.config import AppConfig
from src.connectors.entsoe_connector import EntsoeConnector
from src.connectors.excel_loader import ExcelLoader
from src.connectors.open_meteo_connector import OpenMeteoConnector
from src.processing.aggregation import monthly_summary
from src.processing.bosnia_model import estimate_bosnia_from_share, load_manual_bosnia
from src.processing.demand_estimation import estimate_daily_demand
from src.processing.domestic_production import expand_annual_to_daily, load_annual_domestic_production
from src.processing.gas_flows import combine_flow_sources, summarize_flows_daily
from src.processing.gas_power_generation import load_manual_generation
from src.processing.pricing import expand_quarterly_prices, load_default_quarterly_prices, normalize_quarterly_prices
from src.processing.weather import add_hdd, weighted_weather_summary
from src.storage.local_store import LocalStore
from src.utils.validation import validate_time_series


LOGGER = logging.getLogger(__name__)


def build_dataset_bundle(config: AppConfig, uploads: dict[str, pd.DataFrame] | None = None) -> dict[str, pd.DataFrame]:
    uploads = uploads or {}
    assumptions = config.assumptions
    store = LocalStore(config.app["processed_data_dir"])

    workbook = ExcelLoader(
        config.app["workbook_path"],
        mcm_to_gwh=float(assumptions["mcm_to_gwh"]),
    ).load()

    flows = combine_flow_sources(workbook.gas_flows, workbook.rs_to_hu)
    if "manual_flows" in uploads and not uploads["manual_flows"].empty:
        manual_flows = uploads["manual_flows"].copy()
        manual_flows["source"] = "manual_upload"
        manual_flows["quality_flag"] = "manual_upload"
        flows = combine_flow_sources(flows, manual_flows)

    flow_summary = summarize_flows_daily(flows)

    bosnia_daily = (
        load_manual_bosnia(uploads["manual_bosnia"])
        if "manual_bosnia" in uploads and not uploads["manual_bosnia"].empty
        else estimate_bosnia_from_share(
            flows,
            share=float(assumptions["bosnia_default_share"]),
            reference_points=list(assumptions["bosnia_reference_points"]),
        )
    )

    price_quarterly = load_default_quarterly_prices(config.paths["default_price_seed"])
    domestic_production_annual = load_annual_domestic_production(
        config.paths["domestic_production_seed"],
        mcm_to_gwh=float(assumptions["mcm_to_gwh"]),
    )
    domestic_production_daily = expand_annual_to_daily(
        domestic_production_annual,
        mcm_to_gwh=float(assumptions["mcm_to_gwh"]),
    )
    if "manual_prices" in uploads and not uploads["manual_prices"].empty:
        upload_prices = uploads["manual_prices"].copy()
        upload_prices["source"] = "manual_upload"
        upload_prices["quality_flag"] = "manual_upload"
        try:
            upload_prices = normalize_quarterly_prices(
                upload_prices,
                default_source="manual_upload",
                default_quality_flag="manual_upload",
                default_price_name="Manual upload",
            )
        except ValueError as exc:
            LOGGER.warning("Manual price upload ignored: %s", exc)
            upload_prices = pd.DataFrame()

        if not upload_prices.empty:
            manual_keys = set(upload_prices[["year", "quarter"]].apply(tuple, axis=1))
            price_quarterly = pd.concat(
                [
                    price_quarterly[~price_quarterly[["year", "quarter"]].apply(tuple, axis=1).isin(manual_keys)],
                    upload_prices,
                ],
                ignore_index=True,
                sort=False,
            )
            price_quarterly = normalize_quarterly_prices(price_quarterly)
    prices_monthly, prices_daily = expand_quarterly_prices(price_quarterly)

    weather_daily = _build_weather(config, uploads, flow_summary, workbook.embedded_weather)
    weighted_weather = weighted_weather_summary(weather_daily, config.assumptions["serbia_weather_weights"])

    demand_daily = estimate_daily_demand(
        flow_summary=flow_summary,
        bosnia_estimate=bosnia_daily,
        assumptions=assumptions,
        weighted_weather=weighted_weather,
        domestic_production_daily=domestic_production_daily,
    )

    power_daily = _build_power(config, uploads, demand_daily)
    monthly = monthly_summary(
        demand=demand_daily,
        prices_daily=prices_daily,
        weather_daily=weighted_weather,
        power_daily=power_daily,
        cost_ratio=float(assumptions["revenue_cost_split"]["cost_ratio_of_revenue"]),
    )

    validation_results = {
        "flows_validation": validate_time_series(flows, "date", "value_mcm", allow_negative=False),
        "demand_validation": validate_time_series(demand_daily, "date", "serbia_estimated_consumption_mcm", allow_negative=False),
        "prices_validation": validate_time_series(prices_daily, "date", "price_eur_mwh", allow_negative=False),
    }

    bundle = {
        "gas_flows": flows,
        "flow_summary": flow_summary,
        "historical_consumption": workbook.historical_consumption,
        "bosnia_daily": bosnia_daily,
        "domestic_production_annual": domestic_production_annual,
        "domestic_production_daily": domestic_production_daily,
        "weather_daily": weighted_weather,
        "weather_city_daily": weather_daily,
        "demand_daily": demand_daily,
        "power_daily": power_daily,
        "prices_quarterly": price_quarterly,
        "prices_monthly": prices_monthly,
        "prices_daily": prices_daily,
        "monthly_summary": monthly,
        "page_allocations": workbook.page_allocations,
        "workbook_metadata": pd.DataFrame([workbook.metadata]),
    } | validation_results

    for name, frame in bundle.items():
        if isinstance(frame, pd.DataFrame):
            try:
                store.save(name, frame)
            except Exception as exc:
                LOGGER.warning("Failed to persist %s: %s", name, exc)
    return bundle


def _build_weather(
    config: AppConfig,
    uploads: dict[str, pd.DataFrame],
    flow_summary: pd.DataFrame,
    embedded_weather: pd.DataFrame,
) -> pd.DataFrame:
    if "manual_weather" in uploads and not uploads["manual_weather"].empty:
        weather = uploads["manual_weather"].copy()
        weather["date"] = pd.to_datetime(weather["date"], errors="coerce").dt.normalize()
        weather["source"] = "manual_upload"
        weather["quality_flag"] = "manual_upload"
        if "hdd" not in weather.columns:
            weather = add_hdd(weather, float(config.assumptions["hdd_base_temperature_c"]))
        return weather

    if bool(config.app.get("embedded_only")):
        if embedded_weather.empty:
            return pd.DataFrame()
        return add_hdd(embedded_weather, float(config.assumptions["hdd_base_temperature_c"]))

    if flow_summary.empty:
        return pd.DataFrame()
    if not bool(config.connectors["open_meteo"].get("enabled", True)):
        if embedded_weather.empty:
            return pd.DataFrame()
        return add_hdd(embedded_weather, float(config.assumptions["hdd_base_temperature_c"]))
    start_date = str(flow_summary["date"].min().date())
    end_date = str(min(flow_summary["date"].max().date(), pd.Timestamp.today().date()))
    connector = OpenMeteoConnector(
        base_url=config.connectors["open_meteo"]["base_url"],
        timeout_seconds=int(config.connectors["open_meteo"]["timeout_seconds"]),
    )
    frames = []
    for city, coords in config.connectors["open_meteo"]["cities"].items():
        frame = connector.fetch_daily_temperature(
            city=city,
            latitude=float(coords["latitude"]),
            longitude=float(coords["longitude"]),
            start_date=start_date,
            end_date=end_date,
        )
        if not frame.empty:
            frames.append(frame)
    weather = pd.concat(frames, ignore_index=True, sort=False) if frames else pd.DataFrame()
    if not weather.empty:
        weather = add_hdd(weather, float(config.assumptions["hdd_base_temperature_c"]))
    return weather


def _build_power(
    config: AppConfig,
    uploads: dict[str, pd.DataFrame],
    demand_daily: pd.DataFrame,
) -> pd.DataFrame:
    if "manual_power" in uploads and not uploads["manual_power"].empty:
        return load_manual_generation(uploads["manual_power"])
    if bool(config.app.get("embedded_only")):
        return pd.DataFrame()
    if demand_daily.empty:
        return pd.DataFrame()
    if not bool(config.connectors["entsoe"].get("enabled", True)):
        return pd.DataFrame()
    connector = EntsoeConnector(
        api_key=config.connectors["entsoe"]["api_key"],
        area_code=config.connectors["entsoe"]["area_code"],
        timeout_seconds=int(config.connectors["entsoe"]["timeout_seconds"]),
    )
    start_date = str(demand_daily["date"].min().date())
    end_date = str(min(demand_daily["date"].max().date(), pd.Timestamp.today().date()))
    return connector.fetch_gas_generation(start_date=start_date, end_date=end_date)
