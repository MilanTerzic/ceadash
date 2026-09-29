from __future__ import annotations

import pandas as pd

from src.utils.units import mcm_to_mwh


def estimate_daily_demand(
    flow_summary: pd.DataFrame,
    bosnia_estimate: pd.DataFrame,
    assumptions: dict[str, float],
    weighted_weather: pd.DataFrame | None = None,
    domestic_production_daily: pd.DataFrame | None = None,
) -> pd.DataFrame:
    frame = flow_summary.copy()
    frame["date"] = pd.to_datetime(frame["date"]).dt.normalize()
    output = frame.merge(bosnia_estimate[["date", "bosnia_estimated_consumption_mcm"]], on="date", how="left")
    if weighted_weather is not None and not weighted_weather.empty:
        output = output.merge(weighted_weather[["date", "avg_temp_c", "hdd"]], on="date", how="left")
    if domestic_production_daily is not None and not domestic_production_daily.empty:
        output = output.merge(
            domestic_production_daily[["date", "domestic_production_mcm"]],
            on="date",
            how="left",
        )
    output["bosnia_estimated_consumption_mcm"] = output["bosnia_estimated_consumption_mcm"].fillna(0.0)
    output["domestic_production_mcm"] = output.get("domestic_production_mcm", assumptions["domestic_production_mcm_day"])
    output["domestic_production_mcm"] = output["domestic_production_mcm"].fillna(assumptions["domestic_production_mcm_day"])
    output["storage_balance_mcm"] = 0.0
    output["serbia_estimated_consumption_mcm"] = (
        output["net_import_mcm"].fillna(0.0)
        + output["domestic_production_mcm"]
        + output["storage_balance_mcm"]
        - output["bosnia_estimated_consumption_mcm"]
    )
    output["total_estimated_consumption_mcm"] = (
        output["serbia_estimated_consumption_mcm"] + output["bosnia_estimated_consumption_mcm"]
    )
    output["total_estimated_consumption_mwh"] = output["total_estimated_consumption_mcm"].apply(
        lambda value: mcm_to_mwh(value, assumptions["mcm_to_gwh"])
    )
    output["assumptions_used"] = (
        f"default_domestic_production={assumptions['domestic_production_mcm_day']} mcm/day; "
        f"bosnia_share={assumptions['bosnia_default_share']}; storage_balance=0"
    )
    output["source"] = "calculated"
    output["quality_flag"] = "calculated"
    return output
