from __future__ import annotations

import streamlit as st

from src.config import ensure_directories, load_config
from src.dashboard import admin as admin_view
from src.dashboard import bosnia as bosnia_view
from src.dashboard import consumption as consumption_view
from src.dashboard import export_view
from src.dashboard import forecasting as forecasting_view
from src.dashboard import gas_flows as gas_flows_view
from src.dashboard import overview as overview_view
from src.dashboard import pricing as pricing_view
from src.dashboard import weather as weather_view
from src.forecasting.baseline import seasonal_monthly_average
from src.forecasting.hdd_regression import forecast_with_hdd
from src.forecasting.sarimax_model import run_sarimax
from src.pipeline import build_dataset_bundle
from src.utils.logging_config import configure_logging


@st.cache_resource
def _load_config():
    configure_logging()
    config = load_config()
    ensure_directories(config)
    return config


def main() -> None:
    config = _load_config()
    st.set_page_config(page_title=config.app["title"], layout="wide")
    st.title(config.app["title"])
    st.caption(
        f"Workbook fallback: {config.app['workbook_path']} | "
        f"Default unit assumption: {config.assumptions['price_unit']}"
    )

    with st.sidebar:
        st.header("Controls")
        refresh = st.button("Refresh datasets")
        uploads = admin_view.render()

    if refresh or "bundle" not in st.session_state:
        st.session_state["bundle"] = build_dataset_bundle(config, uploads=uploads)

    bundle = st.session_state["bundle"]
    baseline_forecast = seasonal_monthly_average(bundle["monthly_summary"])
    hdd_backtest = forecast_with_hdd(bundle["monthly_summary"])
    sarimax_forecast = run_sarimax(bundle["monthly_summary"])

    tabs = st.tabs(
        [
            "Overview",
            "Gas flows",
            "Consumption estimate",
            "Bosnia estimate",
            "Weather",
            "Pricing",
            "Forecasting",
            "Validation",
            "Export",
        ]
    )

    with tabs[0]:
        overview_view.render(bundle["monthly_summary"], bundle["demand_daily"], bundle["prices_monthly"])
    with tabs[1]:
        gas_flows_view.render(bundle["gas_flows"])
    with tabs[2]:
        consumption_view.render(bundle["demand_daily"])
    with tabs[3]:
        bosnia_view.render(bundle["bosnia_daily"])
    with tabs[4]:
        weather_view.render(bundle["weather_daily"])
    with tabs[5]:
        pricing_view.render(bundle["prices_quarterly"], bundle["prices_daily"])
    with tabs[6]:
        forecasting_view.render(baseline_forecast, sarimax_forecast)
        if not hdd_backtest.empty:
            st.subheader("HDD regression backtest")
            st.dataframe(hdd_backtest, use_container_width=True)
    with tabs[7]:
        st.subheader("Validation")
        st.write("Flows")
        st.dataframe(bundle["flows_validation"], use_container_width=True)
        st.write("Demand")
        st.dataframe(bundle["demand_validation"], use_container_width=True)
        st.write("Prices")
        st.dataframe(bundle["prices_validation"], use_container_width=True)
    with tabs[8]:
        export_view.render(
            config.app["exports_dir"],
            {
                "gas_flows": bundle["gas_flows"],
                "demand_daily": bundle["demand_daily"],
                "monthly_summary": bundle["monthly_summary"],
                "weather_daily": bundle["weather_daily"],
                "prices_daily": bundle["prices_daily"],
                "power_daily": bundle["power_daily"],
                "assumptions": st.session_state.get(
                    "assumptions_frame",
                    __import__("pandas").DataFrame(
                        [{"assumption_name": key, "value": value} for key, value in config.assumptions.items()]
                    ),
                ),
            },
        )


if __name__ == "__main__":
    main()
