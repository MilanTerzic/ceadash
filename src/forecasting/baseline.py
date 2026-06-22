from __future__ import annotations

import pandas as pd


def seasonal_monthly_average(monthly_summary: pd.DataFrame, periods: int = 12) -> pd.DataFrame:
    if monthly_summary.empty:
        return pd.DataFrame()
    history = monthly_summary.copy().sort_values("month")
    history["calendar_month"] = pd.to_datetime(history["month"]).dt.month
    profile = history.groupby("calendar_month", as_index=False)["serbia_consumption_mcm"].mean()
    last_month = pd.to_datetime(history["month"]).max()
    future_rows = []
    for step in range(1, periods + 1):
        future_month = (last_month + pd.offsets.MonthBegin(step)).normalize()
        month_num = future_month.month
        value = profile.loc[profile["calendar_month"] == month_num, "serbia_consumption_mcm"].mean()
        future_rows.append(
            {
                "month": future_month,
                "forecast_serbia_consumption_mcm": value,
                "model": "seasonal_monthly_average",
            }
        )
    return pd.DataFrame(future_rows)
