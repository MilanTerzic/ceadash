from __future__ import annotations

import calendar

import pandas as pd


def load_annual_domestic_production(path: str, mcm_to_gwh: float) -> pd.DataFrame:
    frame = pd.read_csv(path)
    frame["production_mcm_year"] = frame["production_gwh"] / mcm_to_gwh
    frame["production_mcm_day_default"] = frame["production_mcm_year"] / 365.0
    frame["source"] = "embedded_seed"
    frame["quality_flag"] = "default_assumption"
    return frame


def expand_annual_to_daily(annual: pd.DataFrame, mcm_to_gwh: float) -> pd.DataFrame:
    records: list[dict[str, object]] = []
    for row in annual.to_dict(orient="records"):
        year = int(row["year"])
        days_in_year = 366 if calendar.isleap(year) else 365
        daily_gwh = float(row["production_gwh"]) / days_in_year
        daily_mcm = daily_gwh / mcm_to_gwh
        for day in pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D"):
            records.append(
                {
                    "date": day.normalize(),
                    "domestic_production_gwh": daily_gwh,
                    "domestic_production_mcm": daily_mcm,
                    "source": row["source"],
                    "quality_flag": row["quality_flag"],
                }
            )
    return pd.DataFrame(records)
