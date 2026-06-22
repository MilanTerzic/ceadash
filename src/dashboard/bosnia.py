from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st


def render(bosnia_daily: pd.DataFrame) -> None:
    st.subheader("Bosnia estimate")
    if bosnia_daily.empty:
        st.info("No Bosnia estimate available.")
        return
    st.dataframe(bosnia_daily, use_container_width=True)
    st.plotly_chart(
        px.line(bosnia_daily, x="date", y="bosnia_estimated_consumption_mcm", title="Daily Bosnia estimate"),
        use_container_width=True,
    )
