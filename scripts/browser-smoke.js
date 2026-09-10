/** Optional UI regression check. See README for Playwright setup.
 * Starts a separate server and temporary data store; never changes the normal demo feed.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../backend/app");
const { low } = require("../backend/data/demo-invoices.json");

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vendorguard-ui-"));
  const output = path.resolve(process.env.QA_OUTPUT_DIR || "test-results");
  fs.mkdirSync(output, { recursive: true });
  let server, browser;
  try {
    server = (await createApp({ dataDir: directory, env: {} })).listen(
      0,
      "127.0.0.1",
    );
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_CHANNEL
        ? { channel: process.env.BROWSER_CHANNEL }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1536, height: 1050 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(url);
    await page.getByText("Workspace connected", { exact: true }).waitFor();
    assert.equal(await page.locator("#feed tr").count(), 6);
    await page.screenshot({
      path: path.join(output, "dashboard-desktop.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Load suspicious invoice" }).click();
    assert.equal(
      await page.locator('[name="bankAccount"]').inputValue(),
      "XXXX9903",
    );
    await page
      .getByRole("button", { name: "Analyze invoice", exact: true })
      .click();
    await page.locator("#detail-dialog[open]").waitFor();
    assert.match(
      await page.locator("#detail-content").innerText(),
      /80[\s\S]*RISK POINTS/,
    );
    assert.match(
      await page.locator(".callback-box").innerText(),
      /\+1 \(202\) 555-0101/,
    );
    assert.ok(
      !(await page.locator(".callback-box").innerText()).includes("555-0199"),
    );
    assert.equal(await page.locator(".trace-step").count(), 4);
    await page.screenshot({
      path: path.join(output, "review-high-risk.png"),
      fullPage: true,
    });
    await page
      .locator('#resolution-form [name="reviewer"]')
      .fill("Browser Tester");
    await page
      .locator('#resolution-form [name="notes"]')
      .fill(
        "Spoke to the trusted contact. They confirmed this invoice and the new details.",
      );
    await page
      .getByRole("button", { name: "Confirm details · Return to review" })
      .click();
    assert.match(
      await page.locator("#resolution-error").innerText(),
      /Complete the callback/,
    );
    await page.locator('#resolution-form [name="callbackCompleted"]').check();
    await page
      .getByRole("button", { name: "Confirm details · Return to review" })
      .click();
    await page
      .getByText("Callback review confirmed", { exact: true })
      .waitFor();
    assert.match(
      await page.locator(".risk-summary").innerText(),
      /Current state: Ready for review/,
    );
    await page.getByRole("button", { name: "Close invoice details" }).click();

    await page.getByRole("button", { name: "Load normal invoice" }).click();
    await page
      .getByRole("button", { name: "Analyze invoice", exact: true })
      .click();
    await page.locator("#detail-dialog[open]").waitFor();
    assert.match(
      await page.locator(".risk-summary").innerText(),
      /Consistent with the trusted record/,
    );
    assert.equal(await page.locator(".callback-box").count(), 0);
    await page.getByRole("button", { name: "Close invoice details" }).click();

    await page.getByRole("button", { name: /Verification queue/ }).click();
    await page.locator("#verification-list [data-invoice]").first().click();
    await page.locator("#detail-dialog[open]").waitFor();
    await page
      .locator('#resolution-form [name="reviewer"]')
      .fill("Browser Tester");
    await page
      .locator('#resolution-form [name="notes"]')
      .fill("The trusted vendor denied changing their payment account.");
    await page.getByRole("button", { name: "Reject & block" }).click();
    await page.getByText("Callback review rejected", { exact: true }).waitFor();
    assert.match(
      await page.locator(".risk-summary").innerText(),
      /Current state: Blocked/,
    );
    await page.getByRole("button", { name: "Close invoice details" }).click();
    await page.getByRole("button", { name: "Overview", exact: true }).click();

    await page.locator("#risk-filter").selectOption("medium");
    assert.equal(await page.locator("#feed .badge.medium").count(), 1);
    await page.locator("#risk-filter").selectOption("all");
    await page
      .getByRole("searchbox", { name: "Search invoices" })
      .fill("no-such-vendor");
    assert.match(await page.locator("#feed").innerText(), /No invoices match/);
    await page.getByRole("searchbox", { name: "Search invoices" }).fill("");

    // A submission made outside this page appears through live polling.
    const injectedName = "<img src=x onerror=alert(1)>";
    await page.request.post(`${url}/api/invoices`, {
      data: {
        ...low,
        vendorName: injectedName,
        invoiceNumber: "LIVE-POLL-XSS",
      },
    });
    await page
      .locator("#feed")
      .getByText(injectedName, { exact: true })
      .waitFor({ timeout: 10000 });
    assert.equal(await page.locator("#feed img").count(), 0);
    await page
      .locator("#feed")
      .getByText(injectedName, { exact: true })
      .click();
    await page.locator("#detail-dialog[open]").waitFor();
    assert.equal(await page.locator("#detail-content img").count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Confirm details · Return to review" })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");

    await page
      .getByRole("button", { name: "Vendor directory", exact: true })
      .click();
    assert.equal(await page.locator(".vendor-card").count(), 7);
    await page
      .locator(".vendor-card details")
      .first()
      .locator("summary")
      .click();
    await page.screenshot({
      path: path.join(output, "vendor-directory.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "How it works", exact: true })
      .click();
    assert.equal(await page.locator(".guide-card").count(), 4);

    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(output, "dashboard-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "New invoice", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Suspicious example", exact: true })
      .click();
    assert.equal(
      await page.locator('[name="bankAccount"]').inputValue(),
      "XXXX9903",
    );
    await page.screenshot({
      path: path.join(output, "invoice-form-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Analyze invoice", exact: true })
      .click();
    await page.locator("#detail-dialog[open]").waitFor();
    assert.equal(
      await page
        .locator("#detail-dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser: desktop/mobile, low/high submission, full trace, trusted callback, confirm/reject, filters, vendor history, live feed, XSS escaping, unknown vendor, no browser errors.",
    );
    console.log(`Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (
      path.dirname(directory) === os.tmpdir() &&
      path.basename(directory).startsWith("vendorguard-ui-")
    )
      fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
