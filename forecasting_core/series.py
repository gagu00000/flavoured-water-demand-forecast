"""Monthly series container and calendar helpers."""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np


def days_in_month(month: str) -> int:
    """Calendar days in a 'YYYY-MM' month (handles leap years)."""
    year, mon = (int(part) for part in month.split("-"))
    return calendar.monthrange(year, mon)[1]


def month_number(month: str) -> int:
    """Month of year (1-12) for a 'YYYY-MM' string."""
    return int(month.split("-")[1])


def next_months(last_month: str, count: int) -> list[str]:
    """The `count` months that follow `last_month`, as 'YYYY-MM' strings."""
    year, mon = (int(part) for part in last_month.split("-"))
    out = []
    for _ in range(count):
        mon += 1
        if mon > 12:
            mon, year = 1, year + 1
        out.append(f"{year:04d}-{mon:02d}")
    return out


@dataclass
class MonthlySeries:
    """A monthly sales series.

    months : 'YYYY-MM' labels in chronological order, no gaps
    units  : units sold in each month
    days   : days of sales observed in each month. Normally the calendar days,
             but the last month of the dataset (Dec 2023) has 30 observed days,
             so the observed count is kept rather than assumed.
    """

    months: list[str]
    units: np.ndarray
    days: np.ndarray
    name: str = "series"
    notes: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.units = np.asarray(self.units, dtype=float)
        self.days = np.asarray(self.days, dtype=float)
        if not (len(self.months) == len(self.units) == len(self.days)):
            raise ValueError("months, units and days must have the same length")
        for prev, cur in zip(self.months, self.months[1:]):
            if next_months(prev, 1)[0] != cur:
                raise ValueError(f"months must be consecutive: {prev} -> {cur}")
        if np.any(self.units < 0):
            raise ValueError("units cannot be negative")
        if np.any(self.days <= 0):
            raise ValueError("days must be positive")

    @classmethod
    def from_records(cls, records: Iterable[dict], name: str = "series") -> "MonthlySeries":
        """Build from [{'month': 'YYYY-MM', 'units': ..., 'days': optional}, ...]."""
        rows = sorted(records, key=lambda r: r["month"])
        months = [r["month"] for r in rows]
        units = [float(r["units"]) for r in rows]
        days = [float(r.get("days") or days_in_month(r["month"])) for r in rows]
        return cls(months, np.array(units), np.array(days), name=name)

    def __len__(self) -> int:
        return len(self.months)

    def head(self, n: int) -> "MonthlySeries":
        """First n months (used for chronological training windows)."""
        return MonthlySeries(self.months[:n], self.units[:n], self.days[:n], self.name)

    def slice(self, start: int, stop: int) -> "MonthlySeries":
        return MonthlySeries(self.months[start:stop], self.units[start:stop], self.days[start:stop], self.name)

    @property
    def daily_rate(self) -> np.ndarray:
        """Units per observed day: removes the month-length effect."""
        return self.units / self.days

    def future_calendar(self, horizon: int) -> tuple[list[str], np.ndarray]:
        """Labels and calendar day counts for the next `horizon` months."""
        months = next_months(self.months[-1], horizon)
        return months, np.array([days_in_month(m) for m in months], dtype=float)

    def to_records(self) -> list[dict]:
        return [
            {"month": m, "units": float(u), "days": int(d)}
            for m, u, d in zip(self.months, self.units, self.days)
        ]


def as_series(obj: MonthlySeries | Sequence[dict]) -> MonthlySeries:
    """Accept either a MonthlySeries or a list of record dicts."""
    return obj if isinstance(obj, MonthlySeries) else MonthlySeries.from_records(obj)
