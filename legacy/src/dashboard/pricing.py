from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st


def render(prices_quarterly: pd.DataFrame, prices_daily: pd.DataFrame) -> None:
    st.subheader("Pricing / Srbijagas price")
    if prices_quarterly.empty:
        st.info("No pricing data available.")
        return
    st.dataframe(prices_quarterly, use_container_width=True)
    if not prices_daily.empty:
        st.plotly_chart(
            px.line(prices_daily, x="date", y="price_eur_mwh", title="Daily expanded price series"),
            use_container_width=True,
        )
