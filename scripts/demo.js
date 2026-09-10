// Run npm start in another terminal, then npm run demo. Uses real HTTP endpoints.
const assert = require("node:assert/strict");
const { low, high } = require("../backend/data/demo-invoices.json");
const vendors = require("../backend/data/vendors.json");
const base = process.env.VENDORGUARD_URL || "http://127.0.0.1:4000";

async function submit(invoice) {
  const response = await fetch(`${base}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(invoice),
    signal: AbortSignal.timeout(40000),
  });
  const record = await response.json();
  assert.equal(response.status, 201, JSON.stringify(record));
  assert.equal(record.trace.length, 4);
  return record;
}
(async () => {
  const normal = await submit(low);
  assert.equal(normal.riskLevel, "low");
  assert.equal(normal.verification, null);
  console.log(
    `PASS LOW: ${normal.invoiceNumber} | score ${normal.score} | ${normal.paymentStatus}`,
  );
  const suspicious = await submit(high);
  assert.equal(suspicious.riskLevel, "high");
  assert.equal(suspicious.paymentStatus, "held");
  assert.equal(
    suspicious.verification.callbackNumberUsed,
    vendors[0].verifiedPhone,
  );
  console.log(
    `PASS HIGH: ${suspicious.invoiceNumber} | score ${suspicious.score} | ${suspicious.paymentStatus}`,
  );
  console.log(
    `Trusted callback: ${suspicious.verification.callbackNumberUsed}`,
  );
  console.log(`Signals: ${suspicious.signals.map((s) => s.type).join(", ")}`);
  console.log(
    "Both records are now in the dashboard. Open either row to inspect the complete trace.",
  );
})().catch((error) => {
  console.error(
    `Demo failed: ${error.message}\nStart the server with npm start first.`,
  );
  process.exitCode = 1;
});
