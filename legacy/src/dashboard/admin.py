from __future__ import annotations

from io import BytesIO

import pandas as pd
import streamlit as st


def render() -> dict[str, pd.DataFrame]:
    st.subheader("Data upload / admin")
    uploads: dict[str, pd.DataFrame] = {}
    upload_specs = {
        "manual_flows": "Manual gas flows upload",
        "manual_prices": "Manual prices upload",
        "manual_weather": "Manual weather upload",
        "manual_bosnia": "Manual Bosnia upload",
        "manual_power": "Manual gas-fired power upload",
    }
    for key, label in upload_specs.items():
        file = st.file_uploader(label, type=["csv", "xlsx"], key=key)
        if file is None:
            continue
        uploads[key] = _read_uploaded_file(file)
        st.success(f"Loaded {len(uploads[key])} rows for {label.lower()}.")
    return uploads


def _read_uploaded_file(file) -> pd.DataFrame:
    name = file.name.lower()
    payload = BytesIO(file.read())
    if name.endswith(".csv"):
        return pd.read_csv(payload)
    return pd.read_excel(payload)
