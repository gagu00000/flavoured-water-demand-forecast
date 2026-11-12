// End-to-end tests of the production build, organised by the lab brief's requirements.
// The LLM endpoint is mocked so the tests are deterministic and need no API key;
// the real function is covered by the unit tests and a live check.

import { expect, type Page, type Route, test } from "@playwright/test";

type LlmMode = "ok" | "busy";

const LLM_ANSWER = {
  ok: true,
  model: "llm-test",
  interpretation: {
    seasonality_trend: "Mocked: no significant trend; the days in each month drive the monthly pattern.",
    best_model: "Mocked: the calendar-aware models are effectively tied with the best.",
    recommendations: ["Mocked: plan production per sales day."],
    limitations: ["The data is synthetic."],
    confidence: "medium",
    source: "llm",
  },
  grounding: { checked: 0, unverified: [] },
  attempts: [],
  ms: 5,
};

test.describe.serial("Flavoured water forecasting dashboard", () => {
  let page: Page;
  let llmMode: LlmMode = "ok";
  const llmRequests: { data_version: number; last_month: string; last_change?: string }[] = [];
  const pageErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      // A mocked 503 makes the browser log the failed request; anything else is a real error
      if (m.type() === "error" && !/status of 503/.test(m.text())) pageErrors.push(`console: ${m.text()}`);
    });
    await page.route("**/api/interpret", async (route: Route) => {
      const body = route.request().postDataJSON() as { snapshot: { context: { data_version: number; last_change?: string }; data: { last_month: string } } };
      llmRequests.push({
        data_version: body.snapshot.context.data_version,
        last_month: body.snapshot.data.last_month,
        last_change: body.snapshot.context.last_change,
      });
      if (llmMode === "busy") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "The AI service is busy right now.", retryable: true }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LLM_ANSWER) });
      }
    });
    await page.goto("/");
  });

  test.afterAll(async () => {
    await page.close();
  });

  const main = () => page.getByRole("main");
  const ai = () => page.getByRole("complementary", { name: "AI Analyst interpretation" });
  const openTab = (name: string) => page.getByRole("tab", { name }).click();

  test("shows the launch-year results immediately, before the engine is ready", async () => {
    await expect(main().getByText("465,666 units")).toBeVisible({ timeout: 5_000 });
    await expect(main().getByText("Calendar-adjusted Naive").first()).toBeVisible();
    await expect(main().getByText("Dec 2021").first()).toBeVisible();
  });

  test("the in-browser engine boots", async () => {
    await expect(page.getByTestId("engine-status")).toContainText("Live engine ready", { timeout: 120_000 });
  });

  test("LLM interpretation answers the three questions (mocked LLM)", async () => {
    await expect(ai().getByText("How well did the model capture seasonality or trends?")).toBeVisible();
    await expect(ai().getByText("Which model performed best and why?")).toBeVisible();
    await expect(ai().getByText("What recommendations would you give the company?")).toBeVisible();
    await expect(ai().getByText(/Mocked: no significant trend/)).toBeVisible();
    await expect(ai().getByText("llm-test")).toBeVisible();
    expect(llmRequests[0]).toMatchObject({ data_version: 1, last_month: "2021-12" });
  });

  test("Task 2: switching the model updates the forecast chart and table", async () => {
    await page.getByRole("radio", { name: /^ARIMA/ }).click();
    await expect(main().getByText(/ARIMA · Native ARIMA prediction interval/)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Seasonal Naive/ })).toBeDisabled();
  });

  test("Task 4: the forecast horizon control changes the number of forecast months", async () => {
    const horizon = page.getByLabel("Forecast horizon");
    await horizon.focus();
    await horizon.press("End"); // 6 months
    await expect(main().getByText(/Production plan · next 6 months/i)).toBeVisible({ timeout: 30_000 });
    await expect(main().locator("table").first().locator("tbody tr")).toHaveCount(7); // 6 months + total
    await horizon.press("Home"); // 1 month
    await horizon.press("ArrowRight");
    await horizon.press("ArrowRight"); // back to 3
    await expect(main().getByText(/Production plan · next 3 months/i)).toBeVisible({ timeout: 30_000 });
  });

  test("Task 3: the chronological test window can be changed", async () => {
    const test6 = page.getByLabel("Test window");
    await test6.focus();
    await test6.press("End"); // max for 12 months = 6
    await expect(main().getByText(/tested on Jul 2021 – Dec 2021/)).toBeVisible({ timeout: 30_000 });
    await test6.press("Home");
    await expect(main().getByText(/tested on Oct 2021 – Dec 2021/)).toBeVisible({ timeout: 30_000 });
  });

  test("Task 5: MAPE and WAPE for every model, ranked, with the formulas", async () => {
    await openTab("Models & Metrics");
    await expect(main().getByRole("region", { name: "WAPE by model" })).toBeVisible();
    await expect(main().getByRole("region", { name: "MAPE by model" })).toBeVisible();
    const table = main().getByRole("table").first();
    for (const name of ["Naive", "Calendar-adjusted Naive", "ARIMA", "Random Forest", "XGBoost", "Seasonal Naive"]) {
      await expect(table.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(table.getByText("1.92%").first()).toBeVisible(); // Calendar-adjusted Naive backtest WAPE
    await expect(table.getByText(/Disabled: Needs a full year/)).toBeVisible();
  });

  test("Task 6 & 7a: actual-vs-predicted charts and trend/seasonality views render", async () => {
    await expect(main().getByRole("img", { name: /test window compared with actual sales/ })).toBeVisible();
    await openTab("Trend & Seasonality");
    await expect(main().getByText("not testable yet")).toBeVisible();
    await expect(main().getByRole("img", { name: /Units per sales day over time/ })).toBeVisible();
    await expect(main().getByRole("img", { name: /Autocorrelation/ })).toBeVisible();
  });

  test("Task 1: feature engineering views show lags, seasonal indicators and limits", async () => {
    await openTab("Feature Engineering");
    await expect(main().getByText("Lag 1").first()).toBeVisible();
    await expect(main().getByText("Days in month").first()).toBeVisible();
    await expect(main().getByText(/Only 6 training rows/)).toBeVisible();
    await expect(main().getByText("lag rows").first()).toBeVisible();
  });

  test("Regions: heatmap and forecast allocation", async () => {
    await openTab("Regions & Distribution");
    await expect(main().getByRole("img", { name: /Units per day by region and month/ })).toBeVisible();
    await expect(main().getByText("Saarland").first()).toBeVisible();
  });

  test("Real-time data: a new month arrives, models re-run and the LLM re-interprets", async () => {
    await openTab("Live Data Feed");
    const before = llmRequests.length;
    await main().getByRole("button", { name: /Next month arrives/ }).click();
    await expect(main().getByText(/Through\s+Jan 2022/)).toBeVisible();
    await expect(main().getByText("data version 2")).toBeVisible();
    // The forecast made before January arrived is scored against the actual
    await expect(main().getByRole("cell", { name: "166,182" })).toBeVisible({ timeout: 30_000 });
    await expect(main().getByRole("cell", { name: "160,396" })).toBeVisible();
    // The interpretation is regenerated for the new data
    await expect.poll(() => llmRequests.length, { timeout: 30_000 }).toBeGreaterThan(before);
    expect(llmRequests.at(-1)).toMatchObject({ data_version: 2, last_month: "2022-01", last_change: "New actual received: 2022-01 = 166,182 units" });
    await expect(ai().getByText("data v2")).toBeVisible({ timeout: 30_000 });
  });

  test("Real-time data: user-entered sales are validated, added and modelled", async () => {
    const input = main().getByLabel(/Units sold in Feb 2022/);
    await input.fill("-5");
    await main().getByRole("button", { name: /Add Feb 22/ }).click();
    await expect(main().getByRole("alert")).toContainText("negative");
    await input.fill("150000");
    await main().getByRole("button", { name: /Add Feb 22/ }).click();
    await expect(main().getByText("Feb 2022: 150,000")).toBeVisible();
    await expect(main().getByText(/User entered 2022-02 = 150,000 units/)).toBeVisible();
    await expect(main().getByRole("button", { name: /Next month arrives/ })).toBeDisabled();
    await expect.poll(() => llmRequests.at(-1)?.last_month, { timeout: 30_000 }).toBe("2022-02");
    await main().getByRole("button", { name: /Remove last entered/ }).click();
    await expect(main().getByRole("button", { name: /Next month arrives/ })).toBeEnabled();
  });

  test("LLM fallback: when the AI service is busy the rule-based interpretation is shown", async () => {
    llmMode = "busy";
    await main().getByRole("button", { name: /Next month arrives/ }).click(); // new data -> new request
    await expect(ai().getByText("Rule-based summary")).toBeVisible({ timeout: 30_000 });
    await expect(ai().getByText(/The AI service is busy right now/)).toBeVisible();
    await expect(ai().getByText(/performed best on/)).toBeVisible(); // fallback text answers Q2
    llmMode = "ok";
    await ai().getByRole("button", { name: "Regenerate interpretation" }).click();
    await expect(ai().getByText("llm-test")).toBeVisible({ timeout: 30_000 });
  });

  test("Reset returns to the launch year", async () => {
    await main().getByRole("button", { name: /Reset to launch year/ }).click();
    await openTab("Overview");
    await expect(main().getByText("465,666 units")).toBeVisible({ timeout: 30_000 });
  });

  test("Keyboard: arrow keys move between tabs", async () => {
    await page.getByRole("tab", { name: "Overview" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Models & Metrics" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  test("Responsive: phone width has no horizontal scroll and folds the controls", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("button", { name: "Controls" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("link", { name: "AI Analyst" }).click();
    await expect(ai()).toBeInViewport();
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("no console errors or uncaught exceptions during the whole session", async () => {
    expect(pageErrors).toEqual([]);
  });
});
