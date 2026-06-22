from __future__ import annotations

import pandas as pd


def combine_flow_sources(*frames: pd.DataFrame) -> pd.DataFrame:
    valid = [frame for frame in frames if frame is not None and not frame.empty]
    if not valid:
        return pd.DataFrame(
            columns=[
                "date",
                "point_name",
                "country_from",
                "country_to",
                "direction",
                "value",
                "unit",
                "value_mcm",
                "value_mwh",
                "source",
                "quality_flag",
            ]
        )
    combined = pd.concat(valid, ignore_index=True, sort=False)
    combined["date"] = pd.to_datetime(combined["date"], errors="coerce").dt.normalize()
    combined = combined.dropna(subset=["date"]).sort_values(["date", "point_name"])
    combined = combined.drop_duplicates(subset=["date", "point_name", "direction"], keep="first")
    return combined


def summarize_flows_daily(flows: pd.DataFrame) -> pd.DataFrame:
    if flows.empty:
        return pd.DataFrame(columns=["date", "total_inflow_mcm", "total_outflow_mcm", "net_import_mcm"])
    grouped = (
        flows.groupby(["date", "direction"], as_index=False)["value_mcm"]
        .sum()
        .pivot(index="date", columns="direction", values="value_mcm")
        .reset_index()
        .rename_axis(None, axis=1)
    )
    grouped["total_inflow_mcm"] = grouped.get("inflow", 0.0).fillna(0.0)
    grouped["total_outflow_mcm"] = grouped.get("outflow", 0.0).fillna(0.0)
    grouped["net_import_mcm"] = grouped["total_inflow_mcm"] - grouped["total_outflow_mcm"]
    return grouped[["date", "total_inflow_mcm", "total_outflow_mcm", "net_import_mcm"]]
