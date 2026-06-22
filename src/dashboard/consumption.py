from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st


def render(demand_daily: pd.DataFrame) -> None:
    st.subheader("Consumption estimate")
    if demand_daily.empty:
        st.info("No demand estimate available.")
        return
    st.caption(demand_daily["assumptions_used"].iloc[0] if "assumptions_used" in demand_daily.columns else "")
    st.dataframe(demand_daily, use_container_width=True)
    st.plotly_chart(
        px.line(
            demand_daily,
            x="date",
            y=["serbia_estimated_consumption_mcm", "bosnia_estimated_consumption_mcm"],
            title="Daily demand estimate",
        ),
        use_container_width=True,
    )
