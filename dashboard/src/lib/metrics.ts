// MAPE, WAPE and bias in TypeScript, with exactly the same formulas and zero
// handling as forecasting_core/metrics.py.
//
// Used to score the live data feed's forecasts (forecast made before a month
// arrived vs the actual) and, in the tests, as an independent cross-check of
// every metric the Python engine reports.
//
//   MAPE = 100 / n' * sum |A - F| / |A|   over months with |A| > 1 unit
//   WAPE = 100 * sum |A - F| / sum |A|
//   Bias = 100 * sum (F - A) / sum A       (+ over-forecast, - under-forecast)

export const EPS = 1;

export interface MetricResult {
  mape: number | null;
  wape: number | null;
  bias: number | null;
  mapeExcluded: number;
  n: number;
}

export function evaluate(actual: number[], forecast: number[]): MetricResult {
  if (actual.length !== forecast.length) throw new Error("actual and forecast lengths differ");
  if (actual.length === 0) throw new Error("cannot score an empty forecast");
  let apeSum = 0;
  let used = 0;
  let absErr = 0;
  let absAct = 0;
  let signedErr = 0;
  let act = 0;
  actual.forEach((a, i) => {
    const e = a - forecast[i];
    if (Math.abs(a) > EPS) {
      apeSum += Math.abs(e) / Math.abs(a);
      used += 1;
    }
    absErr += Math.abs(e);
    absAct += Math.abs(a);
    signedErr += forecast[i] - a;
    act += a;
  });
  return {
    mape: used ? (apeSum / used) * 100 : null,
    wape: absAct ? (absErr / absAct) * 100 : null,
    bias: act ? (signedErr / act) * 100 : null,
    mapeExcluded: actual.length - used,
    n: actual.length,
  };
}
