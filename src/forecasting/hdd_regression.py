from __future__ import annotations

import pandas as pd
from sklearn.linear_model import LinearRegression


def forecast_with_hdd(monthly_summary: pd.DataFrame) -> pd.DataFrame:
    required = {"serbia_consumption_mcm", "weighted_hdd", "month"}
    if monthly_summary.empty or not required.issubset(monthly_summary.columns):
        return pd.DataFrame()
    frame = monthly_summary.dropna(subset=["serbia_consumption_mcm", "weighted_hdd"]).copy()
    if len(frame) < 6:
        return pd.DataFrame()
    model = LinearRegression()
    model.fit(frame[["weighted_hdd"]], frame["serbia_consumption_mcm"])
    predictions = model.predict(frame[["weighted_hdd"]])
    return pd.DataFrame(
        {
            "month": frame["month"],
            "forecast_serbia_consumption_mcm": predictions,
            "actual_serbia_consumption_mcm": frame["serbia_consumption_mcm"],
            "model": "hdd_regression_backtest",
        }
    )
