from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from src.config import ensure_directories, load_config
from src.export.excel_export import export_report
from src.forecasting.baseline import seasonal_monthly_average
from src.forecasting.hdd_regression import forecast_with_hdd
from src.forecasting.sarimax_model import run_sarimax
from src.pipeline import build_dataset_bundle
from src.utils.logging_config import configure_logging


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Plain Python CLI for the Serbian gas offer customization MVP."
    )
    parser.add_argument("--config", default="config/default_config.yaml", help="Path to config YAML.")
    parser.add_argument("--workbook", help="Override workbook path.")
    parser.add_argument("--export-xlsx", help="Write a consolidated Excel report to this path.")
    parser.add_argument("--export-dir", help="Write all datasets as CSV files into this directory.")
    parser.add_argument("--print-head", type=int, default=5, help="Number of rows to print for key tables.")
    parser.add_argument("--manual-flows", help="Optional CSV/XLSX upload for gas flows.")
    parser.add_argument("--manual-prices", help="Optional CSV/XLSX upload for prices.")
    parser.add_argument("--manual-weather", help="Optional CSV/XLSX upload for weather.")
    parser.add_argument("--manual-bosnia", help="Optional CSV/XLSX upload for Bosnia demand/outflow.")
    parser.add_argument("--manual-power", help="Optional CSV/XLSX upload for gas-fired power.")
    return parser


def read_table(path: str | None) -> pd.DataFrame:
    if not path:
        return pd.DataFrame()
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    if file_path.suffix.lower() == ".csv":
        return pd.read_csv(file_path)
    return pd.read_excel(file_path)


def collect_uploads(args: argparse.Namespace) -> dict[str, pd.DataFrame]:
    mapping = {
        "manual_flows": args.manual_flows,
        "manual_prices": args.manual_prices,
        "manual_weather": args.manual_weather,
        "manual_bosnia": args.manual_bosnia,
        "manual_power": args.manual_power,
    }
    return {key: read_table(path) for key, path in mapping.items() if path}


def print_summary(bundle: dict[str, pd.DataFrame], print_head: int) -> None:
    gas_flows = bundle["gas_flows"]
    monthly = bundle["monthly_summary"]
    demand = bundle["demand_daily"]
    power = bundle["power_daily"]

    print("Serbian Gas Offer Customization MVP")
    print("=" * 40)
    print(f"Gas flow rows: {len(gas_flows)}")
    print(f"Daily demand rows: {len(demand)}")
    print(f"Monthly summary rows: {len(monthly)}")
    print(f"Gas power rows: {len(power)}")
    print()

    if not monthly.empty:
        latest = monthly.sort_values("month").iloc[-1]
        print("Latest monthly snapshot")
        print(f"Month: {latest['month'].date()}")
        print(f"Serbia demand (mcm): {latest['serbia_consumption_mcm']:.2f}")
        print(f"Bosnia estimate (mcm): {latest['bosnia_consumption_mcm']:.2f}")
        print(f"Average price: {latest['avg_price_eur_mwh']:.2f}")
        print(f"Estimated revenue: {latest['estimated_revenue']:.2f}")
        print(f"Estimated margin: {latest['estimated_margin']:.2f}")
        print()

    print("Monthly summary preview")
    print(monthly.head(print_head).to_string(index=False))
    print()

    print("Validation preview")
    for key in ("flows_validation", "demand_validation", "prices_validation"):
        frame = bundle[key]
        print(f"[{key}]")
        if frame.empty:
            print("No issues detected.")
        else:
            print(frame.to_string(index=False))
        print()


def export_csv_bundle(export_dir: str, bundle: dict[str, pd.DataFrame]) -> None:
    output_dir = Path(export_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, frame in bundle.items():
        if isinstance(frame, pd.DataFrame):
            frame.to_csv(output_dir / f"{name}.csv", index=False)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    configure_logging()
    config = load_config(args.config)
    if args.workbook:
        config.raw["app"]["workbook_path"] = args.workbook
    ensure_directories(config)

    uploads = collect_uploads(args)
    bundle = build_dataset_bundle(config, uploads=uploads)

    baseline = seasonal_monthly_average(bundle["monthly_summary"])
    hdd_backtest = forecast_with_hdd(bundle["monthly_summary"])
    sarimax = run_sarimax(bundle["monthly_summary"])
    bundle["forecast_baseline"] = baseline
    bundle["forecast_hdd_backtest"] = hdd_backtest
    bundle["forecast_sarimax"] = sarimax

    print_summary(bundle, args.print_head)

    if args.export_dir:
        export_csv_bundle(args.export_dir, bundle)
        print(f"CSV bundle exported to: {Path(args.export_dir).resolve()}")

    if args.export_xlsx:
        export_path = export_report(args.export_xlsx, bundle)
        print(f"Excel report exported to: {export_path.resolve()}")


if __name__ == "__main__":
    main()
