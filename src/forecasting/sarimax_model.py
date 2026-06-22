from __future__ import annotations

import pandas as pd

try:
    from statsmodels.tsa.statespace.sarimax import SARIMAX
except Exception:  # pragma: no cover
    SARIMAX = None


def run_sarimax(monthly_summary: pd.DataFrame, periods: int = 6) -> pd.DataFrame:
    if SARIMAX is None or monthly_summary.empty:
        return pd.DataFrame()
    frame = monthly_summary.dropna(subset=["serbia_consumption_mcm"]).copy().sort_values("month")
    if len(frame) < 18:
        return pd.DataFrame()
    series = frame.set_index("month")["serbia_consumption_mcm"].asfreq("MS")
    exog = None
    if "weighted_hdd" in frame.columns and frame["weighted_hdd"].notna().sum() == len(frame):
        exog = frame.set_index("month")["weighted_hdd"].asfreq("MS")
    model = SARIMAX(
        series,
        exog=exog,
        order=(1, 0, 1),
        seasonal_order=(1, 1, 1, 12),
        enforce_stationarity=False,
        enforce_invertibility=False,
    )
    results = model.fit(disp=False)
    future_index = pd.date_range(series.index.max() + pd.offsets.MonthBegin(1), periods=periods, freq="MS")
    future_exog = None
    if exog is not None:
        future_exog = pd.Series(exog.iloc[-1], index=future_index)
    forecast = results.get_forecast(steps=periods, exog=future_exog)
    conf = forecast.conf_int()
    return pd.DataFrame(
        {
            "month": future_index,
            "forecast_serbia_consumption_mcm": forecast.predicted_mean.values,
            "lower_ci": conf.iloc[:, 0].values,
            "upper_ci": conf.iloc[:, 1].values,
            "model": "sarimax",
        }
    )
