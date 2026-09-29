from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st


def render(flows: pd.DataFrame) -> None:
    st.subheader("Gas flows")
    if flows.empty:
        st.info("No gas flow data available.")
        return
    points = sorted(flows["point_name"].dropna().unique().tolist())
    selected_points = st.multiselect("Filter by point", points, default=points)
    filtered = flows[flows["point_name"].isin(selected_points)]
    st.dataframe(filtered, use_container_width=True)
    st.plotly_chart(
        px.line(filtered, x="date", y="value_mcm", color="point_name", title="Daily imports/outflows by point"),
        use_container_width=True,
    )
