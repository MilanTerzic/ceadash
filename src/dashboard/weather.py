from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st


def render(weather_daily: pd.DataFrame) -> None:
    st.subheader("Weather / temperature")
    if weather_daily.empty:
        st.info("No weather data available.")
        return
    st.dataframe(weather_daily, use_container_width=True)
    st.plotly_chart(
        px.line(weather_daily, x="date", y=["avg_temp_c", "hdd"], title="Temperature and HDD"),
        use_container_width=True,
    )
