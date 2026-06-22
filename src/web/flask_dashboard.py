from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from flask import Flask, Response, redirect, render_template_string, request, send_file, url_for

from src.config import ensure_directories, load_config
from src.export.excel_export import export_report
from src.forecasting.baseline import seasonal_monthly_average
from src.pipeline import build_dataset_bundle
from src.utils.logging_config import configure_logging


PROJECT_ROOT = Path(__file__).resolve().parents[2]
HTML_TEMPLATE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title }}</title>
  <style>
    body { font-family: Segoe UI, Tahoma, sans-serif; margin: 0; background: #f4f6f8; color: #1f2937; }
    header { background: linear-gradient(135deg, #123c69, #1d6fa5); color: white; padding: 24px 32px; }
    main { padding: 24px 32px 40px; }
    .meta { opacity: 0.9; margin-top: 8px; font-size: 14px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin: 20px 0 28px; }
    .card { background: white; border-radius: 14px; padding: 18px; box-shadow: 0 8px 24px rgba(16, 24, 40, 0.08); }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
    .value { font-size: 28px; font-weight: 700; margin-top: 8px; }
    .subvalue { font-size: 13px; color: #64748b; margin-top: 6px; }
    .grid { display: grid; grid-template-columns: 1.35fr 1fr; gap: 20px; }
    .panel { background: white; border-radius: 14px; padding: 18px; box-shadow: 0 8px 24px rgba(16, 24, 40, 0.08); margin-bottom: 20px; }
    .panel h2 { margin: 0 0 12px; font-size: 18px; }
    .wide { grid-column: 1 / -1; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
    th { background: #f8fafc; position: sticky; top: 0; }
    .table-wrap { overflow: auto; max-height: 360px; }
    .actions { margin-top: 12px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .button { display: inline-block; background: #0f766e; color: white; text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: 600; }
    .button.secondary { background: #334155; }
    .muted { color: #64748b; font-size: 14px; }
    .inline-meta { color: #475569; font-size: 14px; margin: 8px 0 0; }
    .filters { background: white; border-radius: 14px; padding: 18px; box-shadow: 0 8px 24px rgba(16, 24, 40, 0.08); margin: 20px 0; }
    .filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
    label { display: block; font-size: 13px; color: #475569; margin-bottom: 4px; }
    input, select { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: white; }
    .check-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-top: 12px; }
    .check-item { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #334155; }
    .check-item input { width: auto; }
    @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>{{ title }}</h1>
    <div class="meta">Offline embedded mode | Workbook: {{ workbook_path }}</div>
  </header>
  <main>
    <section class="cards">
      {% for card in cards %}
      <div class="card">
        <div class="label">{{ card.label }}</div>
        <div class="value">{{ card.value }}</div>
        {% if card.subvalue %}
        <div class="subvalue">{{ card.subvalue }}</div>
        {% endif %}
      </div>
      {% endfor %}
    </section>

    <section class="actions">
      <a class="button" href="/export.xlsx">Download Excel Export</a>
      <a class="button secondary" href="/refresh">Refresh Cached Data</a>
      <span class="muted">All charts and tables below are served from local Python data only.</span>
    </section>
    <p class="inline-meta">View: {{ granularity_label }} | Cached data built at: {{ generated_at }}</p>

    <section class="filters">
      <form method="get">
        <div class="filter-grid">
          <div>
            <label for="start">Start date</label>
            <input type="date" id="start" name="start" value="{{ filters.start }}">
          </div>
          <div>
            <label for="end">End date</label>
            <input type="date" id="end" name="end" value="{{ filters.end }}">
          </div>
          <div>
            <label for="granularity">Granularity</label>
            <select id="granularity" name="granularity">
              <option value="daily" {% if filters.granularity == 'daily' %}selected{% endif %}>Daily</option>
              <option value="monthly" {% if filters.granularity == 'monthly' %}selected{% endif %}>Monthly</option>
            </select>
          </div>
          <div>
            <label for="kireevo_mode">Kireevo mode</label>
            <select id="kireevo_mode" name="kireevo_mode">
              <option value="net" {% if filters.kireevo_mode == 'net' %}selected{% endif %}>Net (Kireevo - Kiskundorozsma-2)</option>
              <option value="gross" {% if filters.kireevo_mode == 'gross' %}selected{% endif %}>Gross Kireevo only</option>
            </select>
          </div>
          <div>
            <label for="history_years">History window</label>
            <select id="history_years" name="history_years">
              {% for option in [3,5,7,10] %}
              <option value="{{ option }}" {% if filters.history_years == option %}selected{% endif %}>{{ option }} years</option>
              {% endfor %}
            </select>
          </div>
        </div>
        <div class="check-grid">
          {% for checkbox in checkboxes %}
          <label class="check-item"><input type="checkbox" name="{{ checkbox.name }}" value="1" {% if checkbox.checked %}checked{% endif %}>{{ checkbox.label }}</label>
          {% endfor %}
        </div>
        <div class="actions">
          <button class="button" type="submit">Apply Filters</button>
        </div>
      </form>
    </section>

    <section class="grid">
      <div class="panel wide">
        <h2>{{ composition_title }}</h2>
        {{ composition_chart|safe }}
      </div>
      <div class="panel wide">
        <h2>{{ source_title }}</h2>
        {{ source_chart|safe }}
      </div>
      <div class="panel wide">
        <h2>Monthly Source Totals</h2>
        {{ monthly_source_chart|safe }}
      </div>
      <div class="panel">
        <h2>Historical Daily Demand</h2>
        {{ daily_history_chart|safe }}
      </div>
      <div class="panel">
        <h2>Historical Monthly Demand</h2>
        {{ monthly_history_chart|safe }}
      </div>
      <div class="panel wide">
        <h2>Monthly Composition Breakdown</h2>
        {{ monthly_composition_chart|safe }}
      </div>
      <div class="panel">
        <h2>Temperature And Gas-To-Power</h2>
        {{ temp_power_chart|safe }}
      </div>
      <div class="panel">
        <h2>Demand Peaks</h2>
        <div class="table-wrap">{{ peaks_table|safe }}</div>
      </div>
      <div class="panel wide">
        <h2>{{ composition_table_title }}</h2>
        <div class="table-wrap">{{ composition_table|safe }}</div>
      </div>
      <div class="panel wide">
        <h2>{{ source_table_title }}</h2>
        <div class="table-wrap">{{ source_table|safe }}</div>
      </div>
      <div class="panel">
        <h2>Domestic Production Seed</h2>
        <div class="table-wrap">{{ production_table|safe }}</div>
      </div>
      <div class="panel">
        <h2>Validation</h2>
        <div class="table-wrap">{{ validation_table|safe }}</div>
      </div>
      <div class="panel wide">
        <h2>Forecast</h2>
        {{ forecast_chart|safe }}
      </div>
    </section>
  </main>
</body>
</html>
"""


def _fig_html(fig: go.Figure, include_js: bool = False) -> str:
    return fig.to_html(
        full_html=False,
        include_plotlyjs=True if include_js else False,
        config={"displayModeBar": False, "responsive": True},
    )


def _build_cards(monthly_summary: pd.DataFrame) -> list[dict[str, str]]:
    if monthly_summary.empty:
        return []
    latest = monthly_summary.sort_values("month").iloc[-1]
    return [
        {"label": "Latest Month", "value": str(pd.Timestamp(latest["month"]).date()), "subvalue": ""},
        {"label": "Serbia Demand (mcm)", "value": f"{latest['serbia_consumption_mcm']:.1f}", "subvalue": ""},
        {"label": "Bosnia Estimate (mcm)", "value": f"{latest['bosnia_consumption_mcm']:.1f}", "subvalue": ""},
        {"label": "Average Price", "value": f"{latest['avg_price_eur_mwh']:.1f}", "subvalue": ""},
        {"label": "Estimated Margin", "value": f"{latest['estimated_margin']:,.0f}", "subvalue": ""},
    ]


def _selected_flag(args, name: str, default: bool = True) -> bool:
    if name in args:
        return args.get(name) == "1"
    return default


def _build_composition(bundle: dict[str, pd.DataFrame]) -> pd.DataFrame:
    flows = bundle["gas_flows"].copy()
    demand = bundle["demand_daily"].copy()
    production = bundle["domestic_production_daily"].copy()
    weather = bundle["weather_daily"].copy()
    power = bundle["power_daily"].copy()

    point_pivot = (
        flows[flows["direction"] == "inflow"]
        .pivot_table(index="date", columns="point_name", values="value_mcm", aggfunc="sum")
        .reset_index()
    )
    point_pivot.columns.name = None

    composition = demand.merge(point_pivot, on="date", how="left")
    if not production.empty:
        composition = composition.merge(
            production[["date", "domestic_production_mcm"]].rename(columns={"domestic_production_mcm": "domestic_production_embedded_mcm"}),
            on="date",
            how="left",
        )
    if not weather.empty:
        composition = composition.merge(weather[["date", "avg_temp_c", "hdd"]], on="date", how="left", suffixes=("", "_weather"))
    if not power.empty:
        composition = composition.merge(power[["date", "generation_gwh"]], on="date", how="left")
    else:
        composition["generation_gwh"] = None

    import_columns = [
        col for col in point_pivot.columns
        if col != "date"
    ]
    composition["total_imported_mcm"] = composition[import_columns].fillna(0.0).sum(axis=1) if import_columns else 0.0
    composition["bosnia_deduction_mcm"] = composition["bosnia_estimated_consumption_mcm"].fillna(0.0)
    composition["domestic_production_total_mcm"] = composition["domestic_production_mcm"].fillna(
        composition.get("domestic_production_embedded_mcm", 0.0)
    )
    composition["source_kireevo_mcm"] = composition.get("Kireevo (BG) / Zaychar (RS)", 0.0).fillna(0.0)
    composition["source_kiskundorozsma2_mcm"] = composition.get("Kiskundorozsma-2 (HU) / Horgos (RS)", 0.0).fillna(0.0)
    composition["source_kireevo_net_mcm"] = (
        composition["source_kireevo_mcm"] - composition["source_kiskundorozsma2_mcm"]
    ).clip(lower=0.0)
    composition["source_kalotina_mcm"] = composition.get("Kalotina", 0.0).fillna(0.0)
    composition["source_kiskundorozsma_mcm"] = composition.get("Kiskundorozsma (HU>RS)", 0.0).fillna(0.0)
    composition["serbia_required_demand_mcm"] = composition["serbia_estimated_consumption_mcm"].fillna(0.0)
    composition = composition.sort_values("date")
    return composition


def _build_filters(bundle: dict[str, pd.DataFrame], args) -> dict[str, object]:
    composition = _build_composition(bundle)
    max_date = pd.to_datetime(composition["date"]).max()
    default_start = max(pd.to_datetime(composition["date"]).min(), max_date - pd.DateOffset(years=5))
    start = pd.to_datetime(args.get("start", default_start.date()), errors="coerce")
    end = pd.to_datetime(args.get("end", max_date.date()), errors="coerce")
    if pd.isna(start):
        start = default_start
    if pd.isna(end):
        end = max_date
    if start > end:
        start, end = end, start
    return {
        "start": start.strftime("%Y-%m-%d"),
        "end": end.strftime("%Y-%m-%d"),
        "granularity": args.get("granularity", "daily"),
        "kireevo_mode": args.get("kireevo_mode", "net"),
        "history_years": int(args.get("history_years", 5)),
        "include_bosnia": _selected_flag(args, "include_bosnia", True),
        "include_production": _selected_flag(args, "include_production", True),
        "include_required": _selected_flag(args, "include_required", True),
        "include_temperature": _selected_flag(args, "include_temperature", True),
        "include_power": _selected_flag(args, "include_power", True),
    }


def _aggregate_composition(composition: pd.DataFrame, frequency: str) -> pd.DataFrame:
    if composition.empty:
        return composition.copy()

    value_columns = [
        col
        for col in composition.columns
        if col != "date"
    ]
    aggregation_map = {
        col: ("mean" if col == "avg_temp_c" else "sum")
        for col in value_columns
    }
    aggregated = composition.copy()
    aggregated["month"] = pd.to_datetime(aggregated["date"]).dt.to_period(frequency).dt.to_timestamp()
    aggregated = aggregated.groupby("month", as_index=False).agg(aggregation_map)
    aggregated = aggregated.rename(columns={"month": "date"})
    return aggregated


def _bundle_to_context(bundle: dict[str, pd.DataFrame], title: str, workbook_path: str, args) -> dict[str, object]:
    composition = _build_composition(bundle)
    filters = _build_filters(bundle, args)
    start = pd.to_datetime(filters["start"])
    end = pd.to_datetime(filters["end"])
    composition = composition[(composition["date"] >= start) & (composition["date"] <= end)].copy()
    chart_composition = (
        _aggregate_composition(composition, "M")
        if filters["granularity"] == "monthly"
        else composition.copy()
    )
    chart_x_col = "date"
    chart_unit_label = "mcm/month" if filters["granularity"] == "monthly" else "mcm/day"
    selected_kireevo_col = "source_kireevo_net_mcm" if filters["kireevo_mode"] == "net" else "source_kireevo_mcm"
    selected_kireevo_label = (
        "Kireevo net (Kireevo - Kiskundorozsma-2)"
        if filters["kireevo_mode"] == "net"
        else "Kireevo gross"
    )

    monthly = bundle["monthly_summary"].copy()
    monthly = monthly[(monthly["month"] >= start.to_period("M").to_timestamp()) & (monthly["month"] <= end.to_period("M").to_timestamp())]
    history_cutoff = pd.Timestamp(end) - pd.DateOffset(years=filters["history_years"])
    historical = bundle["historical_consumption"].copy()
    historical = historical[(historical["date"] >= history_cutoff) & (historical["date"] <= end)].copy()
    production_annual = bundle["domestic_production_annual"].copy()
    forecast = seasonal_monthly_average(monthly, periods=12)

    area_series = [col for col in [
        "Kireevo (BG) / Zaychar (RS)",
        "Kiskundorozsma (HU>RS)",
        "Kiskundorozsma-2 (HU) / Horgos (RS)",
        "Kalotina",
    ] if col in composition.columns]
    if filters["include_production"]:
        area_series.append("domestic_production_total_mcm")
    area_frame = chart_composition[[chart_x_col] + area_series].copy() if area_series else chart_composition[[chart_x_col]].copy()
    area_long = area_frame.melt(id_vars=chart_x_col, var_name="component", value_name="mcm_value") if area_series else pd.DataFrame(columns=[chart_x_col, "component", "mcm_value"])
    composition_chart = px.area(
        area_long,
        x=chart_x_col,
        y="mcm_value",
        color="component",
        labels={"mcm_value": chart_unit_label, chart_x_col: "Date"},
    )
    if filters["include_required"]:
        composition_chart.add_trace(
            go.Scatter(
                x=chart_composition[chart_x_col],
                y=chart_composition["serbia_required_demand_mcm"],
                mode="lines",
                line=dict(color="#c1121f", width=3),
                name="Required Serbia demand",
            )
        )
    if filters["include_bosnia"]:
        composition_chart.add_trace(
            go.Scatter(
                x=chart_composition[chart_x_col],
                y=chart_composition["bosnia_deduction_mcm"],
                mode="lines",
                line=dict(color="#1d4ed8", dash="dot", width=2),
                name="Bosnia deduction",
            )
        )
    composition_chart.update_layout(margin=dict(l=20, r=20, t=10, b=20), legend_title_text="")

    source_frame = chart_composition[
        [
            chart_x_col,
            selected_kireevo_col,
            "source_kalotina_mcm",
            "source_kiskundorozsma_mcm",
        ]
    ].copy()
    source_long = source_frame.melt(id_vars=chart_x_col, var_name="source", value_name="mcm_value")
    source_labels = {
        "source_kireevo_net_mcm": "Kireevo net (Kireevo - Kiskundorozsma-2)",
        "source_kireevo_mcm": "Kireevo gross",
        "source_kalotina_mcm": "Kalotina",
        "source_kiskundorozsma_mcm": "Kiskundorozsma",
    }
    source_long["source"] = source_long["source"].map(source_labels).fillna(source_long["source"])
    source_chart = px.area(
        source_long,
        x=chart_x_col,
        y="mcm_value",
        color="source",
        labels={"mcm_value": chart_unit_label, chart_x_col: "Date"},
    )
    source_chart.update_layout(margin=dict(l=20, r=20, t=10, b=20), legend_title_text="")

    monthly_source = composition[
        [
            "date",
            selected_kireevo_col,
            "source_kalotina_mcm",
            "source_kiskundorozsma_mcm",
        ]
    ].copy()
    monthly_source["month"] = pd.to_datetime(monthly_source["date"]).dt.to_period("M").dt.to_timestamp()
    monthly_source = monthly_source.groupby("month", as_index=False)[
        [selected_kireevo_col, "source_kalotina_mcm", "source_kiskundorozsma_mcm"]
    ].sum()
    monthly_source_long = monthly_source.melt(id_vars="month", var_name="source", value_name="mcm_per_month")
    monthly_source_long["source"] = monthly_source_long["source"].map(source_labels).fillna(monthly_source_long["source"])
    monthly_source_chart = px.bar(
        monthly_source_long,
        x="month",
        y="mcm_per_month",
        color="source",
        barmode="stack",
        labels={"mcm_per_month": "mcm/month", "month": "Month"},
    )
    monthly_source_chart.update_layout(margin=dict(l=20, r=20, t=10, b=20), legend_title_text="")

    historical_daily_chart = px.line(
        historical,
        x="date",
        y="serbia_estimated_consumption_mcm",
        labels={"serbia_estimated_consumption_mcm": "mcm/day", "date": "Date"},
    )
    historical_daily_chart.update_layout(margin=dict(l=20, r=20, t=10, b=20))

    historical_monthly = historical.copy()
    historical_monthly["month"] = pd.to_datetime(historical_monthly["date"]).dt.to_period("M").dt.to_timestamp()
    historical_monthly = historical_monthly.groupby("month", as_index=False)["serbia_estimated_consumption_mcm"].sum()
    monthly_history_chart = px.area(
        historical_monthly,
        x="month",
        y="serbia_estimated_consumption_mcm",
        labels={"serbia_estimated_consumption_mcm": "mcm/month", "month": "Month"},
    )
    monthly_history_chart.update_layout(margin=dict(l=20, r=20, t=10, b=20))

    monthly_composition = composition.copy()
    monthly_composition["month"] = pd.to_datetime(monthly_composition["date"]).dt.to_period("M").dt.to_timestamp()
    aggregation_map = {col: "sum" for col in area_series + ["bosnia_deduction_mcm", "serbia_required_demand_mcm"]}
    aggregation_map.update({"avg_temp_c": "mean", "generation_gwh": "sum"})
    monthly_comp = monthly_composition.groupby("month", as_index=False).agg(aggregation_map)
    monthly_long = monthly_comp[["month"] + area_series].melt(id_vars="month", var_name="component", value_name="mcm") if area_series else pd.DataFrame(columns=["month", "component", "mcm"])
    monthly_composition_chart = px.area(
        monthly_long,
        x="month",
        y="mcm",
        color="component",
        labels={"mcm": "mcm/month", "month": "Month"},
    )
    if filters["include_required"]:
        monthly_composition_chart.add_trace(
            go.Scatter(
                x=monthly_comp["month"],
                y=monthly_comp["serbia_required_demand_mcm"],
                mode="lines",
                line=dict(color="#c1121f", width=3),
                name="Required Serbia demand",
            )
        )
    monthly_composition_chart.update_layout(margin=dict(l=20, r=20, t=10, b=20), legend_title_text="")

    temp_power_chart = go.Figure()
    if filters["include_temperature"] and "avg_temp_c" in composition.columns:
        temp_power_chart.add_trace(
            go.Scatter(x=chart_composition[chart_x_col], y=chart_composition["avg_temp_c"], mode="lines", name="Temperature (C)")
        )
    if filters["include_power"] and chart_composition["generation_gwh"].notna().any():
        temp_power_chart.add_trace(
            go.Bar(x=chart_composition[chart_x_col], y=chart_composition["generation_gwh"], name="Gas to power (GWh)")
        )
    temp_power_chart.update_layout(margin=dict(l=20, r=20, t=10, b=20))

    forecast_chart = go.Figure()
    forecast_chart.add_trace(
        go.Scatter(
            x=monthly["month"],
            y=monthly["serbia_consumption_mcm"],
            mode="lines+markers",
            name="Actual",
        )
    )
    if not forecast.empty:
        forecast_chart.add_trace(
            go.Scatter(
                x=forecast["month"],
                y=forecast["forecast_serbia_consumption_mcm"],
                mode="lines+markers",
                name="Seasonal Forecast",
            )
        )
    forecast_chart.update_layout(margin=dict(l=20, r=20, t=10, b=20))

    peaks = historical.nlargest(10, "serbia_estimated_consumption_mcm")[
        ["date", "serbia_estimated_consumption_mcm", "temperature_c"]
    ].copy()
    peaks["date"] = pd.to_datetime(peaks["date"]).dt.strftime("%Y-%m-%d")

    validation = pd.concat(
        [
            bundle["flows_validation"].assign(dataset="flows"),
            bundle["demand_validation"].assign(dataset="demand"),
            bundle["prices_validation"].assign(dataset="prices"),
        ],
        ignore_index=True,
        sort=False,
    )
    if validation.empty:
        validation = pd.DataFrame([{"dataset": "all", "check": "none", "count": 0, "severity": "ok"}])

    composition_display = chart_composition[
        ["date"] + area_series + ["total_imported_mcm", "bosnia_deduction_mcm", "domestic_production_total_mcm", "serbia_required_demand_mcm", "avg_temp_c", "generation_gwh"]
    ].copy()
    composition_display["date"] = pd.to_datetime(composition_display["date"]).dt.strftime("%Y-%m-%d")

    source_display = chart_composition[
        [
            "date",
            selected_kireevo_col,
            "source_kalotina_mcm",
            "source_kiskundorozsma_mcm",
            "source_kiskundorozsma2_mcm",
            "total_imported_mcm",
        ]
    ].copy()
    source_display = source_display.rename(
        columns={
            selected_kireevo_col: f"{selected_kireevo_label} (mcm/day)",
            "source_kalotina_mcm": "Kalotina (mcm/day)",
            "source_kiskundorozsma_mcm": "Kiskundorozsma (mcm/day)",
            "source_kiskundorozsma2_mcm": "Kiskundorozsma-2 / Horgos (mcm/day)",
            "total_imported_mcm": "Total imported (mcm/day)",
        }
    )
    source_display["date"] = pd.to_datetime(source_display["date"]).dt.strftime("%Y-%m-%d")

    checkboxes = [
        {"name": "include_bosnia", "label": "Show Bosnia deduction", "checked": filters["include_bosnia"]},
        {"name": "include_production", "label": "Show domestic production", "checked": filters["include_production"]},
        {"name": "include_required", "label": "Show required demand line", "checked": filters["include_required"]},
        {"name": "include_temperature", "label": "Show temperature", "checked": filters["include_temperature"]},
        {"name": "include_power", "label": "Show gas-to-power", "checked": filters["include_power"]},
    ]

    source_cards = []
    if not composition.empty:
        latest_comp = composition.sort_values("date").iloc[-1]
        source_cards = [
            {"label": selected_kireevo_label, "value": f"{latest_comp[selected_kireevo_col]:.2f}", "subvalue": "mcm/day latest"},
            {"label": "Kalotina", "value": f"{latest_comp['source_kalotina_mcm']:.2f}", "subvalue": "mcm/day latest"},
            {"label": "Kiskundorozsma", "value": f"{latest_comp['source_kiskundorozsma_mcm']:.2f}", "subvalue": "mcm/day latest"},
            {"label": "Kiskundorozsma-2 / Horgos", "value": f"{latest_comp['source_kiskundorozsma2_mcm']:.2f}", "subvalue": "mcm/day latest"},
        ]

    return {
        "title": title,
        "workbook_path": workbook_path,
        "generated_at": bundle.get("_generated_at", "unknown"),
        "granularity_label": "Monthly view" if filters["granularity"] == "monthly" else "Daily view",
        "composition_title": "Monthly Composition of Serbia Demand" if filters["granularity"] == "monthly" else "Daily Composition of Serbia Demand",
        "source_title": "Supply By Source (Monthly)" if filters["granularity"] == "monthly" else "Supply By Source",
        "composition_table_title": "Monthly Composition Table" if filters["granularity"] == "monthly" else "Composition Table",
        "source_table_title": "Monthly Source Breakdown Table" if filters["granularity"] == "monthly" else "Source Breakdown Table",
        "cards": _build_cards(monthly) + source_cards,
        "filters": filters,
        "checkboxes": checkboxes,
        "composition_chart": _fig_html(composition_chart, include_js=True),
        "source_chart": _fig_html(source_chart),
        "monthly_source_chart": _fig_html(monthly_source_chart),
        "daily_history_chart": _fig_html(historical_daily_chart),
        "monthly_history_chart": _fig_html(monthly_history_chart),
        "monthly_composition_chart": _fig_html(monthly_composition_chart),
        "temp_power_chart": _fig_html(temp_power_chart),
        "forecast_chart": _fig_html(forecast_chart),
        "peaks_table": peaks.to_html(index=False, classes="dataframe", border=0),
        "composition_table": composition_display.to_html(index=False, classes="dataframe", border=0),
        "source_table": source_display.to_html(index=False, classes="dataframe", border=0),
        "production_table": production_annual.to_html(index=False, classes="dataframe", border=0),
        "validation_table": validation.to_html(index=False, classes="dataframe", border=0),
    }


def create_app(config_path: str | Path = "config/offline_embedded_config.yaml") -> Flask:
    configure_logging()
    config = load_config(config_path)
    ensure_directories(config)
    app = Flask(__name__)

    state: dict[str, object] = {"bundle": None}

    def load_state() -> dict[str, pd.DataFrame]:
        if state["bundle"] is None:
            bundle = build_dataset_bundle(config, uploads={})
            bundle["_generated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            state["bundle"] = bundle
        return state["bundle"]

    @app.get("/")
    def index() -> str:
        bundle = load_state()
        context = _bundle_to_context(bundle, config.app["title"], config.app["workbook_path"], request.args)
        return render_template_string(HTML_TEMPLATE, **context)

    @app.get("/health")
    def health() -> Response:
        return Response("ok", mimetype="text/plain")

    @app.get("/refresh")
    def refresh() -> Response:
        state["bundle"] = None
        load_state()
        return redirect(request.referrer or url_for("index"))

    @app.get("/export.xlsx")
    def export_xlsx():
        bundle = load_state()
        output_path = (PROJECT_ROOT / config.app["exports_dir"] / "serbian_gas_offline_dashboard_export.xlsx").resolve()
        export_report(output_path, bundle)
        return send_file(output_path, as_attachment=True, download_name=output_path.name)

    return app
