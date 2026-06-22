from __future__ import annotations

import pandas as pd


QUARTER_TO_MONTHS = {
    "Q1": [1, 2, 3],
    "Q2": [4, 5, 6],
    "Q3": [7, 8, 9],
    "Q4": [10, 11, 12],
}


def normalize_quarterly_prices(
    prices: pd.DataFrame,
    *,
    default_source: str = "default_seed",
    default_quality_flag: str = "default_assumption",
    default_price_name: str = "Srbijagas default",
) -> pd.DataFrame:
    if prices is None or prices.empty:
        return pd.DataFrame(
            columns=[
                "year",
                "quarter",
                "srbijagas_price",
                "source",
                "quality_flag",
                "price_name",
                "price_eur_mwh",
            ]
        )

    frame = prices.copy()
    frame.columns = [str(col).strip() for col in frame.columns]

    if "price_eur_mwh" not in frame.columns:
        if "srbijagas_price" in frame.columns:
            frame["price_eur_mwh"] = frame["srbijagas_price"]
        else:
            raise ValueError("Quarterly price data must include either 'price_eur_mwh' or 'srbijagas_price'.")

    frame["year"] = pd.to_numeric(frame.get("year"), errors="coerce")
    frame["quarter"] = frame.get("quarter").astype(str).str.strip().str.upper()
    frame["price_eur_mwh"] = pd.to_numeric(frame["price_eur_mwh"], errors="coerce")
    frame["srbijagas_price"] = pd.to_numeric(frame.get("srbijagas_price", frame["price_eur_mwh"]), errors="coerce")
    if "source" in frame.columns:
        frame["source"] = frame["source"].fillna(default_source)
    else:
        frame["source"] = default_source
    if "quality_flag" in frame.columns:
        frame["quality_flag"] = frame["quality_flag"].fillna(default_quality_flag)
    else:
        frame["quality_flag"] = default_quality_flag
    if "price_name" in frame.columns:
        frame["price_name"] = frame["price_name"].fillna(default_price_name)
    else:
        frame["price_name"] = default_price_name

    frame = frame[frame["quarter"].isin(QUARTER_TO_MONTHS.keys())].copy()
    frame = frame.dropna(subset=["year", "price_eur_mwh"])
    frame["year"] = frame["year"].astype(int)

    frame = frame.sort_values(["year", "quarter"]).drop_duplicates(["year", "quarter"], keep="last")
    ordered_columns = [
        "year",
        "quarter",
        "srbijagas_price",
        "source",
        "quality_flag",
        "price_name",
        "price_eur_mwh",
    ]
    return frame[ordered_columns].reset_index(drop=True)


def load_default_quarterly_prices(path: str) -> pd.DataFrame:
    frame = pd.read_csv(path)
    return normalize_quarterly_prices(frame)


def expand_quarterly_prices(prices: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    prices = normalize_quarterly_prices(prices)
    monthly_records: list[dict[str, object]] = []
    daily_records: list[dict[str, object]] = []
    for row in prices.to_dict(orient="records"):
        months = QUARTER_TO_MONTHS[row["quarter"]]
        for month in months:
            month_start = pd.Timestamp(year=int(row["year"]), month=month, day=1)
            monthly_records.append(
                {
                    "date": month_start,
                    "year": row["year"],
                    "quarter": row["quarter"],
                    "month": month,
                    "price_name": row["price_name"],
                    "price_eur_mwh": row["price_eur_mwh"],
                    "source": row["source"],
                    "quality_flag": row["quality_flag"],
                }
            )
            month_end = month_start + pd.offsets.MonthEnd(0)
            for day in pd.date_range(month_start, month_end, freq="D"):
                daily_records.append(
                    {
                        "date": day.normalize(),
                        "year": row["year"],
                        "quarter": row["quarter"],
                        "month": month,
                        "price_name": row["price_name"],
                        "price_eur_mwh": row["price_eur_mwh"],
                        "source": row["source"],
                        "quality_flag": row["quality_flag"],
                    }
                )
    return pd.DataFrame(monthly_records), pd.DataFrame(daily_records)
