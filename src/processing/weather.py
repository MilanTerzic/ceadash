from __future__ import annotations

import pandas as pd


def add_hdd(frame: pd.DataFrame, base_temperature_c: float) -> pd.DataFrame:
    output = frame.copy()
    output["hdd"] = (base_temperature_c - output["avg_temp_c"]).clip(lower=0)
    return output


def weighted_weather_summary(frame: pd.DataFrame, weights: dict[str, float]) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=["date", "avg_temp_c", "min_temp_c", "max_temp_c", "hdd", "source"])
    local = frame.copy()
    local["weight"] = local["city"].map(weights).fillna(0)
    if local["weight"].sum() == 0:
        local["weight"] = 1.0
    weighted = (
        local.groupby("date")
        .apply(
            lambda part: pd.Series(
                {
                    "avg_temp_c": (part["avg_temp_c"] * part["weight"]).sum() / part["weight"].sum(),
                    "min_temp_c": (part["min_temp_c"] * part["weight"]).sum() / part["weight"].sum(),
                    "max_temp_c": (part["max_temp_c"] * part["weight"]).sum() / part["weight"].sum(),
                    "hdd": (part["hdd"] * part["weight"]).sum() / part["weight"].sum(),
                }
            ),
            include_groups=False,
        )
        .reset_index()
    )
    weighted["city"] = "Weighted Serbia"
    weighted["source"] = "weighted_weather"
    weighted["quality_flag"] = "calculated"
    return weighted
