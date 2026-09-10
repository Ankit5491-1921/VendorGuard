const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runPipeline } = require("../backend/pipeline");
const vendors = require("../backend/data/vendors.json");
const { high } = require("../backend/data/demo-invoices.json");
const env = {
  AZURE_OPENAI_ENDPOINT: "https://unit-test.openai.azure.com/",
  AZURE_OPENAI_KEY: "test-key",
  AZURE_OPENAI_DEPLOYMENT: "test-deployment",
};

test("no credentials or partial configuration makes no network call", async () => {
  for (const config of [{}, { AZURE_OPENAI_KEY: "partial" }]) {
    const record = await runPipeline(high, vendors, {
      env: config,
      fetchImpl: () => {
        throw new Error("Must not call");
      },
    });
    assert.equal(record.mode, "rule-based");
    assert.equal(record.paymentStatus, "held");
  }
});
test("Azure success adds a summary without sharing invoice text or overriding the fixed policy", async () => {
  let called = false;
  const result = await runPipeline(high, vendors, {
    env,
    fetchImpl: async (url, options) => {
      called = true;
      assert.equal(
        String(url),
        "https://unit-test.openai.azure.com/openai/v1/chat/completions",
      );
      assert.equal(options.headers["api-key"], "test-key");
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, "test-deployment");
      assert.ok(!options.body.includes(high.bankAccount));
      assert.ok(!options.body.includes(high.emailText));
      assert.ok(!options.body.includes(high.requesterEmail));
      assert.equal(options.redirect, "error");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  "The new bank account and unusual urgency need independent verification.",
              },
            },
          ],
        }),
      };
    },
  });
  assert.equal(called, true);
  assert.equal(result.mode, "azure-assisted");
  assert.ok(result.aiSummary);
  assert.equal(result.riskLevel, "high");
  assert.equal(result.paymentStatus, "held");
  assert.match(result.rationale, /HOLD PAYMENT/);
});
test("provider errors, malformed JSON, missing content, refusal and invalid endpoint fall back gracefully", async () => {
  const failures = [
    async () => {
      throw new Error("Network down");
    },
    async () => ({ ok: false, status: 429 }),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error("Bad JSON");
      },
    }),
    async () => ({ ok: true, json: async () => ({ choices: [] }) }),
    async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: null, refusal: "refused" } }],
      }),
    }),
    async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 42 } }] }),
    }),
  ];
  for (const fetchImpl of failures) {
    const i = await runPipeline(high, vendors, { env, fetchImpl });
    assert.equal(i.mode, "rule-based-fallback");
    assert.equal(i.aiSummary, null);
    assert.equal(i.paymentStatus, "held");
    assert.match(i.rationale, /HOLD PAYMENT/);
    assert.ok(!JSON.stringify(i).includes("test-key"));
  }
  const invalid = await runPipeline(high, vendors, {
    env: { ...env, AZURE_OPENAI_ENDPOINT: "http://insecure.example" },
    fetchImpl: () => {
      throw new Error("Must not call");
    },
  });
  assert.equal(invalid.mode, "rule-based-fallback");
});
test("a stalled Azure request times out and still completes the hold and verification pipeline", async () => {
  const start = Date.now();
  const record = await runPipeline(high, vendors, {
    env: { ...env, AZURE_OPENAI_TIMEOUT_MS: "30" },
    fetchImpl: async () => new Promise(() => {}),
  });
  assert.equal(record.mode, "rule-based-fallback");
  assert.ok(Date.now() - start < 1000);
  assert.equal(
    record.verification.callbackNumberUsed,
    vendors[0].verifiedPhone,
  );
});
