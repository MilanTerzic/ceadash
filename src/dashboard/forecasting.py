from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st


def render(baseline_forecast: pd.DataFrame, sarimax_forecast: pd.DataFrame) -> None:
    st.subheader("Forecasting")
    if baseline_forecast.empty and sarimax_forecast.empty:
        st.info("Not enough data for forecasts yet.")
        return
    if not baseline_forecast.empty:
        st.plotly_chart(
            px.line(
                baseline_forecast,
                x="month",
                y="forecast_serbia_consumption_mcm",
                title="Seasonal monthly average forecast",
            ),
            use_container_width=True,
        )
    if not sarimax_forecast.empty:
        st.dataframe(sarimax_forecast, use_container_width=True)
