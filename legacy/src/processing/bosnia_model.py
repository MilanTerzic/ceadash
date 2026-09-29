from __future__ import annotations

import pandas as pd


def estimate_bosnia_from_share(
    flows: pd.DataFrame,
    share: float,
    reference_points: list[str],
) -> pd.DataFrame:
    if flows.empty:
        return pd.DataFrame(columns=["date", "bosnia_estimated_consumption_mcm", "source", "quality_flag"])
    scope = flows[flows["point_name"].isin(reference_points)].copy()
    if scope.empty:
        scope = flows[flows["direction"] == "outflow"].copy()
    grouped = scope.groupby("date", as_index=False)["value_mcm"].sum()
    grouped["bosnia_estimated_consumption_mcm"] = grouped["value_mcm"].fillna(0.0) * share
    grouped["source"] = "assumption"
    grouped["quality_flag"] = "estimated"
    return grouped[["date", "bosnia_estimated_consumption_mcm", "source", "quality_flag"]]


def load_manual_bosnia(frame: pd.DataFrame) -> pd.DataFrame:
    expected = {"date", "bosnia_estimated_consumption_mcm"}
    if not expected.issubset(frame.columns):
        raise ValueError("Manual Bosnia upload must contain date and bosnia_estimated_consumption_mcm columns.")
    output = frame.copy()
    output["date"] = pd.to_datetime(output["date"], errors="coerce").dt.normalize()
    output["source"] = "manual_upload"
    output["quality_flag"] = "manual_upload"
    return output[["date", "bosnia_estimated_consumption_mcm", "source", "quality_flag"]]
