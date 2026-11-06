// Run npm run test:coverage-warning after npx playwright install chromium.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { createServer } = require("node:http");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { build } = createRequire(require.resolve("tsx"))("esbuild");

const impact = {
  requestId: "coverage-test", requestType: "Venda de Folga", impactStatus: "IMPACTA",
  hasCriticalWarning: true, badgeLabel: "Impacta", badgeTone: "red", summary: "Cobertura abaixo da necessidade.",
  impacts: [{ date: "2026-11-10", label: "Folga solicitada", lob: "ADS", shift: "Manhã", required: 10,
    currentAvailable: 10, currentGap: 0, impactDelta: -1, projectedAvailable: 9, projectedGap: -1,
    impactStatus: "IMPACTA", result: "WORSENS" }]
};
const initialRequest = {
  id: "coverage-test", type: "Venda de Folga", requester: "Pessoa Teste", priority: "Média",
  status: "Em análise", area: "WFM", time: "agora", lob: "ADS", canWfmFinal: true,
  description: "Teste de interação", payload: { dayOffKind: "DAY_OFF_SELL" }
};

test("coverage warning interaction in the real request pages", async (t) => {
  const output = mkdtempSync(join(tmpdir(), "coverage-warning-"));
  await build({
    entryPoints: [join(__dirname, "fixtures/coverage-warning.tsx")], bundle: true,
    outfile: join(output, "app.js"), platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "shell-without-next-router", setup(builder) {
      builder.onResolve({ filter: /components\/layout\/app-shell$/ }, () => ({ path: "shell", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const TopActions = () => null;" }));
    } }]
  });
  execFileSync(process.execPath, [require.resolve("tailwindcss/lib/cli"), "-i", "src/app/globals.css", "-o", join(output, "app.css")], { stdio: "pipe" });
  const server = createServer((req, res) => {
    const asset = req.url === "/app.js" ? "app.js" : req.url === "/app.css" ? "app.css" : null;
    res.setHeader("Content-Type", asset === "app.js" ? "text/javascript" : asset === "app.css" ? "text/css" : "text/html");
    res.end(asset ? readFileSync(join(output, asset)) : '<html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(output, { recursive: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function setup({ personal = false, touch = false, noImpact = false } = {}) {
    const context = await browser.newContext(touch ? { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true } : {});
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const state = { calls: [], saves: 0, listReads: 0, scheduleReads: 0, workHoursReads: 0, fail: false, release: null, request: structuredClone(initialRequest) };
    const consoleErrors = [];
    page.on("pageerror", error => consoleErrors.push(error.message));
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      let data = {};
      if (url.pathname === "/api/requests/status") {
        const body = route.request().postDataJSON();
        state.calls.push(body);
        if (!body.actionInput?.confirmCoverageWarning && !noImpact) {
          return route.fulfill({ status: 409, json: { type: "COVERAGE_WARNING", message: "Confirme o impacto", coverageImpact: impact } });
        }
        if (state.release) await new Promise(resolve => { state.release = resolve; });
        if (state.fail) return route.fulfill({ status: 503, json: { message: "Aprovação indisponível. Tente novamente." } });
        state.saves++;
        state.request.status = "Aprovado";
        data = { data: state.request, scheduleUpdated: true };
      } else if (url.pathname === "/api/requests") {
        state.listReads++;
        data = { data: url.searchParams.has("id") ? state.request : [state.request], actor: { role: "WFM" }, total: 1, page: 1, totalPages: 1, summary: { total: 1, byStatus: { [state.request.status]: 1 } } };
      } else if (url.pathname === "/api/schedules") {
        state.scheduleReads++;
        data = { data: { scheduleDays: [], ownEmployee: { id: "person", name: "Pessoa Teste", schedule: "5x2", shift: "Manhã", lob: "ADS" } } };
      } else if (url.pathname === "/api/work-hours") {
        state.workHoursReads++;
        data = { data: [], summary: {} };
      } else if (url.pathname === "/api/monthly-advance") data = { data: [] };
      else if (url.pathname === "/api/settings") data = { data: {} };
      else if (url.pathname === "/api/employee-additional-data") data = { data: {} };
      else data = { data: null };
      return route.fulfill({ json: data });
    });
    await page.goto(`${origin}/?${personal ? "request=coverage-test&personal=true" : "requestId=coverage-test"}`);
    const detail = personal ? page.locator(".fixed").filter({ has: page.getByRole("heading", { name: "Detalhe da Solicitação" }) }) : page.getByRole("dialog", { name: "Detalhe da Solicitação" });
    await page.getByRole("button", { name: "Aprovar final", exact: true }).waitFor();
    await detail.getByLabel("Entrada final").fill("08:15");
    await detail.getByLabel("Saída final").fill("17:15");
    const approve = () => page.getByRole("button", { name: "Aprovar final", exact: true }).click();
    const warning = () => page.getByRole("dialog", { name: "Aprovação com impacto operacional" });
    t.after(async () => { assert.deepEqual(consoleErrors, []); await context.close(); });
    return { page, state, detail, approve, warning };
  }

  await t.test("Voltar preserves the mounted form; reopens; blocks background and information clicks", async () => {
    const { page, state, detail, approve, warning } = await setup();
    await approve();
    await warning().waitFor();
    const hitTest = await warning().getByRole("button", { name: "Voltar", exact: true }).evaluate(button => {
      const bounds = button.getBoundingClientRect();
      return { pointerEvents: getComputedStyle(button).pointerEvents,
        receivesHit: document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === button };
    });
    assert.deepEqual(hitTest, { pointerEvents: "auto", receivesHit: true });
    if (process.env.COVERAGE_SCREENSHOTS) await page.screenshot({ path: join(process.env.COVERAGE_SCREENSHOTS, "desktop.png") });
    await page.evaluate(() => { window.backgroundClicks = 0; document.querySelector('[role="dialog"]')?.addEventListener("click", () => window.backgroundClicks++); });
    await warning().getByText("Necessidade", { exact: true }).click();
    await page.mouse.click(5, 5);
    assert.equal(await warning().count(), 1);
    assert.equal(await page.evaluate(() => window.backgroundClicks), 0);
    await page.keyboard.press("Escape");
    assert.equal(await warning().count(), 1); // Existing alert has no Escape/outside dismissal.
    await warning().getByRole("button", { name: "Voltar", exact: true }).click();
    await warning().waitFor({ state: "detached" });
    assert.equal(await detail.getByLabel("Entrada final").inputValue(), "08:15");
    assert.equal(await detail.getByLabel("Saída final").inputValue(), "17:15");
    assert.equal(state.saves, 0);
    assert.equal(state.calls.length, 1);
    await page.waitForFunction(() => document.activeElement?.textContent === "Aprovar final");
    await approve();
    await warning().waitFor();
    await warning().getByRole("button", { name: "Voltar", exact: true }).click();
    await page.getByRole("button", { name: "Fechar detalhe da solicitação" }).click();
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.pointerEvents), "");
  });

  await t.test("confirmation saves once despite repeated clicks and refreshes indicators", async () => {
    const { page, state, approve, warning } = await setup();
    await approve(); await warning().waitFor();
    const reads = state.listReads;
    state.release = true;
    await warning().getByRole("button", { name: "Aprovar mesmo assim", exact: true }).dblclick();
    await page.getByRole("button", { name: "Aprovando...", exact: true }).waitFor();
    assert.equal(await warning().getByRole("button", { name: "Voltar", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Aprovando...", exact: true }).isDisabled(), true);
    assert.equal(state.calls.length, 2);
    state.release();
    await warning().waitFor({ state: "detached" });
    await page.getByText("Solicitação aprovada e cronograma atualizado.", { exact: true }).first().waitFor();
    assert.equal(state.saves, 1);
    assert.ok(state.listReads > reads);
    assert.equal(state.calls[1].actionInput.finalApprovedStartTime, "08:15");
  });

  await t.test("keyboard focus stays in alert and supports Tab, Enter and Space", async () => {
    const { page, approve, warning, state } = await setup();
    await approve(); await warning().waitFor();
    const back = warning().getByRole("button", { name: "Voltar", exact: true });
    const confirm = warning().getByRole("button", { name: "Aprovar mesmo assim", exact: true });
    assert.equal(await back.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await confirm.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Tab");
    assert.equal(await back.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Space");
    await warning().waitFor({ state: "detached" });
    await approve(); await warning().waitFor();
    await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
    await warning().waitFor({ state: "detached" });
    assert.equal(state.saves, 1);
  });

  await t.test("touch interaction on a small screen", async () => {
    const { page, state, approve, warning } = await setup({ touch: true });
    await approve(); await warning().waitFor();
    if (process.env.COVERAGE_SCREENSHOTS) await page.screenshot({ path: join(process.env.COVERAGE_SCREENSHOTS, "touch.png") });
    await warning().getByText("Gap previsto", { exact: true }).tap();
    await warning().getByRole("button", { name: "Voltar", exact: true }).tap();
    await approve(); await warning().waitFor();
    await warning().getByRole("button", { name: "Aprovar mesmo assim", exact: true }).tap();
    await warning().waitFor({ state: "detached" });
    assert.equal(state.saves, 1);
  });

  await t.test("API error keeps alert usable and allows retry", async () => {
    const { page, state, approve, warning } = await setup();
    await approve(); await warning().waitFor();
    state.fail = true;
    await warning().getByRole("button", { name: "Aprovar mesmo assim", exact: true }).click();
    await warning().getByRole("alert").waitFor();
    assert.match(await warning().getByRole("alert").innerText(), /indisponível/);
    assert.equal(await warning().getByRole("button", { name: "Aprovar mesmo assim", exact: true }).isEnabled(), true);
    assert.equal(state.saves, 0);
    state.fail = false;
    await warning().getByRole("button", { name: "Aprovar mesmo assim", exact: true }).click();
    await warning().waitFor({ state: "detached" });
    assert.equal(state.saves, 1);
  });

  await t.test("approval without impact keeps its existing flow", async () => {
    const { page, state, approve, warning } = await setup({ noImpact: true });
    await approve();
    await page.getByText("Solicitação aprovada e cronograma atualizado.", { exact: true }).first().waitFor();
    assert.equal(await warning().count(), 0);
    assert.equal(state.saves, 1);
    assert.equal(state.calls.length, 1);
  });

  await t.test("personal schedule also handles retry and refreshes schedule and hours", async () => {
    const { state, detail, approve, warning } = await setup({ personal: true });
    await approve(); await warning().waitFor();
    await warning().getByRole("button", { name: "Voltar", exact: true }).click();
    assert.equal(await detail.getByLabel("Entrada final").inputValue(), "08:15");
    await approve(); await warning().waitFor();
    state.fail = true;
    await warning().getByRole("button", { name: "Aprovar mesmo assim", exact: true }).click();
    await warning().getByRole("alert").waitFor();
    const reads = [state.scheduleReads, state.workHoursReads];
    state.fail = false;
    await warning().getByRole("button", { name: "Aprovar mesmo assim", exact: true }).click();
    await warning().waitFor({ state: "detached" });
    assert.equal(state.saves, 1);
    assert.ok(state.scheduleReads > reads[0]); assert.ok(state.workHoursReads > reads[1]);
  });
});
