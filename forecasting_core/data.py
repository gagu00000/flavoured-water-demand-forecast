"""Loading, validating and aggregating the raw Kaggle file (notebook only).

The raw CSV (about 9 million order lines, 789 MB) is far too large for a browser
or a serverless function, so it is reduced once, here, to a small monthly table.
This module is not loaded into the dashboard's in-browser Python.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

RAW_DTYPES = {
    "Order_ID": "string",
    "Customer_ID": "string",
    "Customer_Type": "category",
    "Product": "category",
    "Category": "category",
    "Unit_Price": "float64",
    "Quantity": "int32",
    "Discount": "float64",
    "Total_Price": "float64",
    "Region": "category",
}


def load_raw(path: str | Path) -> pd.DataFrame:
    """Read the raw CSV with explicit types (dates parsed, text as categories)."""
    return pd.read_csv(path, dtype=RAW_DTYPES, parse_dates=["Order_Date"], encoding="utf-8")


def validate(df: pd.DataFrame) -> dict:
    """Data-quality checks reported in the notebook (and asserted there)."""
    recomputed = df["Unit_Price"] * df["Quantity"] * (1 - df["Discount"])
    dates = df["Order_Date"].dt.normalize()
    # Calendar from the first day to the end of the last month present, so a short final month shows up
    last_month_end = dates.max().to_period("M").end_time.normalize()
    full_range = pd.date_range(dates.min(), last_month_end, freq="D")
    return {
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "null_cells": int(df.isna().sum().sum()),
        "duplicate_rows": int(df.duplicated().sum()),
        "duplicate_order_product": int(df.duplicated(["Order_ID", "Product"]).sum()),
        "non_positive_quantity": int((df["Quantity"] <= 0).sum()),
        "non_positive_price": int((df["Unit_Price"] <= 0).sum()),
        "total_price_mismatches": int((np.abs(recomputed - df["Total_Price"]) > 0.011).sum()),
        "b2c_rows_with_discount": int(((df["Customer_Type"] == "B2C") & (df["Discount"] > 0)).sum()),
        "first_date": str(dates.min().date()),
        "last_date": str(dates.max().date()),
        "days_with_sales": int(dates.nunique()),
        "calendar_days_in_range": int(len(full_range)),
        "missing_days": [str(d.date()) for d in full_range.difference(dates.unique())],
    }


def observed_days(df: pd.DataFrame) -> pd.Series:
    """Number of distinct sales days in each month (Dec 2023 has 30, not 31)."""
    month = df["Order_Date"].dt.to_period("M")
    return df["Order_Date"].dt.normalize().groupby(month).nunique().rename("days")


def aggregate_monthly(df: pd.DataFrame, category: str = "Water") -> pd.DataFrame:
    """Monthly units, revenue and order lines by product x region x customer type."""
    sub = df[df["Category"] == category]
    month = sub["Order_Date"].dt.to_period("M").rename("month")
    agg = (
        sub.groupby([month, "Product", "Region", "Customer_Type"], observed=True)
        .agg(units=("Quantity", "sum"), revenue=("Total_Price", "sum"), lines=("Quantity", "size"))
        .reset_index()
    )
    agg["month"] = agg["month"].astype(str)
    agg["Product"] = agg["Product"].astype(str)
    agg["Region"] = agg["Region"].astype(str)
    agg["Customer_Type"] = agg["Customer_Type"].astype(str)
    return agg


def build_series(agg: pd.DataFrame, days: pd.Series, product: str, region: str | None = None,
                 customer_type: str | None = None, start: str | None = None, end: str | None = None) -> list[dict]:
    """Records [{'month', 'units', 'days', 'revenue'}] for one slice of the data."""
    sub = agg[agg["Product"] == product]
    if region:
        sub = sub[sub["Region"] == region]
    if customer_type:
        sub = sub[sub["Customer_Type"] == customer_type]
    monthly = sub.groupby("month")[["units", "revenue"]].sum().sort_index()
    if start:
        monthly = monthly[monthly.index >= start]
    if end:
        monthly = monthly[monthly.index <= end]
    day_map = {str(k): int(v) for k, v in days.items()}
    return [{"month": m, "units": float(r.units), "days": day_map[m], "revenue": float(r.revenue)}
            for m, r in monthly.iterrows()]


def regional_units(agg: pd.DataFrame, product: str, months: list[str], customer_type: str | None = None) -> dict:
    """{region: [units per month]} aligned with `months`, for forecast allocation."""
    sub = agg[agg["Product"] == product]
    if customer_type:
        sub = sub[sub["Customer_Type"] == customer_type]
    pivot = sub.pivot_table(index="month", columns="Region", values="units", aggfunc="sum").reindex(months)
    return {r: pivot[r].fillna(0).astype(float).tolist() for r in pivot.columns}


def export_dashboard_data(agg: pd.DataFrame, days: pd.Series, path: str | Path, source: dict) -> dict:
    """Compact JSON for the dashboard: units and revenue for every slice, by month.

    Layout: cube[product][region][customer_type] = [units per month] (and the
    same for revenue), so the browser can sum any combination of filters.
    """
    months = sorted(agg["month"].unique())
    products = sorted(agg["Product"].unique())
    regions = sorted(agg["Region"].unique())
    types = sorted(agg["Customer_Type"].unique())
    idx = agg.set_index(["Product", "Region", "Customer_Type", "month"]).sort_index()
    full = pd.MultiIndex.from_product([products, regions, types, months],
                                      names=["Product", "Region", "Customer_Type", "month"])
    idx = idx.reindex(full, fill_value=0)
    units = idx["units"].to_numpy().reshape(len(products), len(regions), len(types), len(months))
    revenue = idx["revenue"].to_numpy().reshape(len(products), len(regions), len(types), len(months))
    payload = {
        "source": source,
        "months": months,
        "days": [int(days[pd.Period(m, "M")]) for m in months],
        "products": products,
        "regions": regions,
        "customer_types": types,
        "units": units.astype(int).tolist(),
        "revenue": np.round(revenue, 2).tolist(),
    }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    return {"bytes": Path(path).stat().st_size, "products": len(products), "regions": len(regions),
            "months": len(months)}
