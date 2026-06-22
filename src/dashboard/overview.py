from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st


def render(monthly_summary: pd.DataFrame, demand_daily: pd.DataFrame, prices_monthly: pd.DataFrame) -> None:
    st.subheader("Overview")
    if monthly_summary.empty:
        st.info("No monthly summary available yet.")
        return

    latest = monthly_summary.sort_values("month").iloc[-1]
    cols = st.columns(4)
    cols[0].metric("Monthly Serbia demand (mcm)", f"{latest['serbia_consumption_mcm']:.1f}")
    cols[1].metric("Monthly Bosnia est. (mcm)", f"{latest['bosnia_consumption_mcm']:.1f}")
    cols[2].metric("Avg price", f"{latest['avg_price_eur_mwh']:.1f}")
    cols[3].metric("Estimated margin", f"{latest['estimated_margin']:.0f}")

    st.plotly_chart(
        px.bar(
            monthly_summary,
            x="month",
            y=["serbia_consumption_mcm", "bosnia_consumption_mcm"],
            barmode="group",
            title="Monthly volume summary",
        ),
        use_container_width=True,
    )
    if not demand_daily.empty and "avg_temp_c" in demand_daily.columns:
        st.plotly_chart(
            px.scatter(
                demand_daily,
                x="avg_temp_c",
                y="serbia_estimated_consumption_mcm",
                trendline="ols",
                title="Demand vs temperature",
            ),
            use_container_width=True,
        )
    if not prices_monthly.empty:
        st.plotly_chart(
            px.line(prices_monthly, x="date", y="price_eur_mwh", title="Monthly price trend"),
            use_container_width=True,
        )
