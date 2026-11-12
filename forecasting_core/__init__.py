"""forecasting_core: the shared forecasting engine.

The same package is imported by the Jupyter notebook and loaded into the
dashboard's browser-side Python (Pyodide). Keeping one implementation is what
guarantees that the notebook and the dashboard report identical numbers.

Modules
-------
series    : the MonthlySeries container and calendar helpers
features  : lag features, rolling means and seasonal (calendar) indicators
models    : the six forecasting models compared in this exercise
metrics   : MAPE, WAPE and bias with explicit zero handling
backtest  : chronological train-test split and rolling-origin evaluation
analysis  : trend, seasonality and calendar-effect statistics
pipeline  : runs everything for one series and returns a JSON-ready result
fallback  : rule-based interpretation used when the LLM is unavailable
grounding : checks that numbers quoted by the LLM exist in the results
"""

__version__ = "1.0.0"

from .series import MonthlySeries, days_in_month, next_months
from .metrics import mape, wape, bias, evaluate
from .models import MODEL_REGISTRY, MODEL_ORDER, make_model
from .pipeline import PipelineConfig, run_pipeline
from .fallback import rule_based_interpretation
from .grounding import grounding_check

__all__ = [
    "MonthlySeries",
    "days_in_month",
    "next_months",
    "mape",
    "wape",
    "bias",
    "evaluate",
    "MODEL_REGISTRY",
    "MODEL_ORDER",
    "make_model",
    "PipelineConfig",
    "run_pipeline",
    "rule_based_interpretation",
    "grounding_check",
]
