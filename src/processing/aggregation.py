from __future__ import annotations

import pandas as pd


def monthly_summary(
    demand: pd.DataFrame,
    prices_daily: pd.DataFrame,
    weather_daily: pd.DataFrame | None,
    power_daily: pd.DataFrame | None,
    cost_ratio: float,
) -> pd.DataFrame:
    frame = demand.copy()
    frame["month"] = pd.to_datetime(frame["date"]).dt.to_period("M").dt.to_timestamp()
    grouped = frame.groupby("month", as_index=False).agg(
        serbia_consumption_mcm=("serbia_estimated_consumption_mcm", "sum"),
        bosnia_consumption_mcm=("bosnia_estimated_consumption_mcm", "sum"),
        total_volume_mcm=("total_estimated_consumption_mcm", "sum"),
        total_volume_mwh=("total_estimated_consumption_mwh", "sum"),
        avg_hdd=("hdd", "mean"),
        avg_temp_c=("avg_temp_c", "mean"),
    )
    if prices_daily is not None and not prices_daily.empty:
        price_frame = prices_daily.copy()
        price_frame["month"] = pd.to_datetime(price_frame["date"]).dt.to_period("M").dt.to_timestamp()
        monthly_prices = price_frame.groupby("month", as_index=False).agg(
            avg_price_eur_mwh=("price_eur_mwh", "mean")
        )
        grouped = grouped.merge(monthly_prices, on="month", how="left")
    else:
        grouped["avg_price_eur_mwh"] = None
    grouped["estimated_revenue"] = grouped["total_volume_mwh"] * grouped["avg_price_eur_mwh"]
    grouped["estimated_cost"] = grouped["estimated_revenue"] * cost_ratio
    grouped["estimated_margin"] = grouped["estimated_revenue"] - grouped["estimated_cost"]
    grouped["quality_flag"] = "calculated"

    if weather_daily is not None and not weather_daily.empty:
        weather_monthly = weather_daily.copy()
        weather_monthly["month"] = pd.to_datetime(weather_monthly["date"]).dt.to_period("M").dt.to_timestamp()
        grouped = grouped.merge(
            weather_monthly.groupby("month", as_index=False)[["hdd"]].mean().rename(columns={"hdd": "weighted_hdd"}),
            on="month",
            how="left",
        )

    if power_daily is not None and not power_daily.empty:
        power_monthly = power_daily.copy()
        power_monthly["month"] = pd.to_datetime(power_monthly["date"]).dt.to_period("M").dt.to_timestamp()
        grouped = grouped.merge(
            power_monthly.groupby("month", as_index=False)[["generation_gwh"]].sum(),
            on="month",
            how="left",
        )

    return grouped
