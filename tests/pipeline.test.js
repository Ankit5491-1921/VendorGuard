const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { createApp } = require("../backend/app");
const { runPipeline } = require("../backend/pipeline");
const vendors = require("../backend/data/vendors.json");
const demo = require("../backend/data/demo-invoices.json");

let server, base, directory;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "vendorguard-test-"));
  const app = await createApp({ dataDir: directory, seedDemo: false, env: {} });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  // Only remove the exact test-owned directory returned by mkdtemp, within OS temp.
  if (
    directory &&
    path.dirname(directory) === os.tmpdir() &&
    path.basename(directory).startsWith("vendorguard-test-")
  ) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
async function request(route, body, expected = 200) {
  const res = await fetch(
    `${base}${route}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await res.json();
  assert.equal(res.status, expected, JSON.stringify(result));
  return result;
}

test("healthy server serves a protected dashboard and seven fully seeded vendor fingerprints", async () => {
  assert.equal((await request("/api/health")).reasoningMode, "rule-based");
  const seed = await request("/api/vendors");
  assert.equal(seed.length, 7);
  assert.ok(
    seed.every((v) => v.invoiceHistory.length === 4 && v.verifiedPhone),
  );
  const res = await fetch(base);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Payment risk overview/);
  assert.match(
    res.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal((await fetch(`${base}/styles.css`)).status, 200);
});
test("LOW demo passes the complete HTTP pipeline and persists an inspectable four-agent trace", async () => {
  const i = await request("/api/invoices", demo.low, 201);
  assert.equal(i.riskLevel, "low");
  assert.equal(i.score, 0);
  assert.equal(i.paymentStatus, "ready_for_review");
  assert.equal(i.verification, null);
  assert.equal(i.signals.length, 0);
  assert.equal(i.checks.filter((c) => c.status === "match").length, 4);
  assert.deepEqual(
    i.trace.map((t) => t.agent),
    ["Extraction", "History", "Reasoning", "Verification"],
  );
  assert.equal((await request(`/api/invoices/${i.id}`)).id, i.id);
  assert.ok((await request("/api/invoices")).some((row) => row.id === i.id));
});
test("HIGH demo holds payment and takes the callback only from the trusted master record", async () => {
  const i = await request(
    "/api/invoices",
    {
      ...demo.high,
      verifiedPhone: "+1 (202) 555-0199",
      riskLevel: "low",
      paymentStatus: "paid",
    },
    201,
  );
  assert.equal(i.riskLevel, "high");
  assert.equal(i.score, 80);
  assert.equal(i.paymentStatus, "held");
  assert.deepEqual(
    i.signals.map((s) => s.type),
    ["NEW_BANK_ACCOUNT", "URGENCY_LANGUAGE"],
  );
  assert.equal(i.verification.callbackNumberUsed, vendors[0].verifiedPhone);
  assert.notEqual(i.verification.callbackNumberUsed, "+1 (202) 555-0199");
  assert.match(i.rationale, /HOLD PAYMENT/);
  assert.equal(i.verification.status, "pending");
});
test("amount-only deviation is MEDIUM and requests manual review", async () => {
  const i = await request("/api/invoices", { ...demo.low, amount: 16000 }, 201);
  assert.equal(i.riskLevel, "medium");
  assert.equal(i.score, 20);
  assert.equal(i.paymentStatus, "manual_review");
  assert.equal(i.verification, null);
});
test("new account alone is HIGH; a same-domain compromised mailbox does not bypass the hold", async () => {
  const i = await request(
    "/api/invoices",
    { ...demo.low, bankAccount: "XXXX9999" },
    201,
  );
  assert.equal(i.riskLevel, "high");
  assert.equal(i.score, 60);
  assert.equal(i.verification.callbackNumberUsed, vendors[0].verifiedPhone);
});
test("domain comparison is exact; case/spacing normalization preserves a legitimate match", async () => {
  const good = await request(
    "/api/invoices",
    {
      ...demo.low,
      vendorName: ` ${demo.low.vendorName.toUpperCase()} `,
      bankAccount: "xxxx-4471",
      requesterEmail: ` ${demo.low.requesterEmail.toUpperCase()} `,
    },
    201,
  );
  assert.equal(good.riskLevel, "low");
  const bad = await request(
    "/api/invoices",
    {
      ...demo.low,
      requesterEmail: "billing@acmefasteners.example.attacker.example",
    },
    201,
  );
  assert.equal(bad.riskLevel, "medium");
  assert.equal(bad.signals[0].type, "DOMAIN_MISMATCH");
});
test("missing email is marked unassessed; tone comparison uses the actual trusted history", async () => {
  const i = await request("/api/invoices", { ...demo.low, emailText: "" }, 201);
  assert.equal(
    i.checks.find((c) => c.label === "Message tone").status,
    "unavailable",
  );
  assert.match(i.rationale, /not assessed/);
  const historicalUrgency = structuredClone(vendors);
  historicalUrgency[0].invoiceHistory.forEach((h) => {
    h.tone = "urgent";
  });
  const result = await runPipeline(
    { ...demo.low, emailText: "Please process today." },
    historicalUrgency,
    { env: {} },
  );
  assert.equal(result.riskLevel, "low");
});
test("UNKNOWN vendor holds with no callback contact and cannot self-confirm", async () => {
  const i = await request(
    "/api/invoices",
    {
      ...demo.high,
      vendorName: "Unregistered Vendor",
      verifiedPhone: "+1 (202) 555-0199",
    },
    201,
  );
  assert.equal(i.riskLevel, "high");
  assert.equal(i.verification.callbackNumberUsed, null);
  await request(
    `/api/invoices/${i.id}/verification`,
    {
      outcome: "confirmed",
      reviewer: "Test Analyst",
      notes: "I used the phone in the invoice.",
      callbackCompleted: true,
    },
    400,
  );
  assert.equal((await request(`/api/invoices/${i.id}`)).paymentStatus, "held");
});
test("malformed invoice data returns useful 400s without inserting records", async () => {
  const count = (await request("/api/invoices")).length;
  const invalid = [
    null,
    [],
    {},
    { ...demo.low, vendorName: {} },
    { ...demo.low, bankAccount: [] },
    { ...demo.low, amount: -1 },
    { ...demo.low, amount: 0 },
    { ...demo.low, amount: "Infinity" },
    { ...demo.low, amount: true },
    { ...demo.low, amount: "1e4" },
    { ...demo.low, amount: 1.234 },
    { ...demo.low, requesterEmail: "bad-email" },
    { ...demo.low, emailText: {} },
    { ...demo.low, emailText: "x".repeat(10001) },
    { ...demo.low, currency: "INR" },
  ];
  for (const body of invalid) await request("/api/invoices", body, 400);
  assert.equal((await request("/api/invoices")).length, count);
  const malformed = await fetch(`${base}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{broken",
  });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /Invalid JSON/);
});
test("callback confirmation is auditable, cannot repeat, and never changes the fingerprint or original risk", async () => {
  const i = await request("/api/invoices", demo.high, 201);
  const route = `/api/invoices/${i.id}/verification`;
  const body = {
    outcome: "confirmed",
    reviewer: "Maya Analyst",
    notes: "Called the on-file contact; invoice details confirmed.",
    callbackCompleted: true,
  };
  await request(route, { ...body, callbackCompleted: false }, 400);
  await request(route, { ...body, notes: "" }, 400);
  const resolved = await request(route, body);
  assert.equal(resolved.paymentStatus, "ready_for_review");
  assert.equal(resolved.riskLevel, "high");
  assert.equal(resolved.verification.status, "confirmed");
  assert.equal(resolved.audit.length, 2);
  assert.equal(resolved.audit[1].reviewer, "Maya Analyst");
  await request(route, body, 409);
  assert.deepEqual((await request("/api/vendors"))[0].knownBankAccounts, [
    "XXXX4471",
  ]);
});
test("rejected callback remains blocked and cannot later be confirmed", async () => {
  const i = await request("/api/invoices", demo.high, 201);
  const route = `/api/invoices/${i.id}/verification`;
  const body = {
    outcome: "rejected",
    reviewer: "Test Analyst",
    notes: "Vendor denied requesting the new bank details.",
  };
  const resolved = await request(route, body);
  assert.equal(resolved.paymentStatus, "blocked");
  assert.equal(resolved.verification.status, "rejected");
  await request(
    route,
    { ...body, outcome: "confirmed", callbackCompleted: true },
    409,
  );
});
test("unknown routes, unsupported types and cross-origin writes fail cleanly", async () => {
  await request("/api/invoices/missing", undefined, 404);
  await request("/api/not-a-route", undefined, 404);
  const crossOrigin = await fetch(`${base}/api/invoices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://untrusted.example",
    },
    body: JSON.stringify(demo.low),
  });
  assert.equal(crossOrigin.status, 403);
  const form = await fetch(`${base}/api/invoices`, {
    method: "POST",
    body: new URLSearchParams(demo.low),
  });
  assert.equal(form.status, 415);
  const oversized = await fetch(`${base}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailText: "x".repeat(40000) }),
  });
  assert.equal(oversized.status, 413);
});
test("concurrent submissions keep distinct IDs and all records survive reopening the data store", async () => {
  const before = (await request("/api/invoices")).length;
  const created = await Promise.all(
    Array.from({ length: 8 }, () => request("/api/invoices", demo.low, 201)),
  );
  assert.equal(new Set(created.map((i) => i.id)).size, 8);
  assert.equal((await request("/api/invoices")).length, before + 8);
  const app = await createApp({ dataDir: directory, env: {}, seedDemo: true });
  const restarted = app.listen(0, "127.0.0.1");
  await once(restarted, "listening");
  try {
    const saved = await (
      await fetch(`http://127.0.0.1:${restarted.address().port}/api/invoices`)
    ).json();
    assert.equal(saved.length, before + 8);
    assert.ok(
      saved.some(
        (i) => i.verification?.status === "confirmed" && i.audit.length === 2,
      ),
    );
    assert.ok(
      saved.some(
        (i) =>
          i.verification?.status === "rejected" &&
          i.paymentStatus === "blocked",
      ),
    );
  } finally {
    await new Promise((resolve) => restarted.close(resolve));
  }
});
