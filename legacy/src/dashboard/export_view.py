from __future__ import annotations

from pathlib import Path

import streamlit as st

from src.export.excel_export import export_report


def render(output_dir: str, datasets: dict[str, object]) -> None:
    st.subheader("Export")
    if st.button("Export Excel report"):
        path = Path(output_dir) / "serbian_gas_mvp_export.xlsx"
        export_report(path, datasets)
        st.success(f"Export created: {path}")
