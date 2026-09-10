const { randomUUID } = require("node:crypto");
const { extract } = require("./agents/extractionAgent");
const { findVendor, checkHistory } = require("./agents/historyAgent");
const { reason } = require("./agents/reasoningAgent");
const {
  buildVerificationTask,
  paymentState,
} = require("./agents/verificationAgent");

/** The complete four-agent orchestration. Trace contains observable results and policy evidence. */
async function runPipeline(rawInput, vendors, options = {}) {
  const start = performance.now();
  const invoice = extract(rawInput);
  const { vendor, signals, checks } = checkHistory(
    invoice,
    findVendor(vendors, invoice.vendorName),
  );
  const reasoning = await reason(invoice, vendor, signals, checks, options);
  const now = new Date().toISOString();
  const verification = buildVerificationTask(vendor, reasoning.riskLevel, now);
  const id = randomUUID();
  return {
    id,
    ...invoice,
    invoiceNumber:
      invoice.invoiceNumber || `VG-${id.slice(0, 8).toUpperCase()}`,
    vendorId: vendor?.id || null,
    ...reasoning,
    signals,
    checks,
    verification,
    paymentStatus: paymentState(reasoning.riskLevel),
    submittedAt: now,
    durationMs: Math.round(performance.now() - start),
    trace: [
      {
        agent: "Extraction",
        title: "Invoice fields normalized",
        summary:
          "Validated vendor, amount, bank account and requester. Extracted optional reference and email text from the structured submission.",
      },
      {
        agent: "History",
        title: vendor
          ? `${vendor.invoiceHistory.length} trusted invoices compared`
          : "No trusted fingerprint found",
        summary: `${signals.length} deviation signal(s); ${checks.filter((c) => c.status === "match").length} matching checks.`,
        checks,
      },
      {
        agent: "Reasoning",
        title: `${reasoning.riskLevel.toUpperCase()} risk · ${reasoning.score}/100`,
        summary: reasoning.rationale,
        mode: reasoning.mode,
      },
      {
        agent: "Verification",
        title: verification
          ? "Payment held for verification"
          : reasoning.riskLevel === "medium"
            ? "Queued for manual review"
            : "Ready for standard review",
        summary:
          verification?.instructions ||
          "No high-risk callback task was created. This app does not execute payments.",
      },
    ],
    audit: [
      {
        action: "analyzed",
        at: now,
        detail: `Policy assigned ${reasoning.riskLevel} risk.`,
      },
    ],
  };
}
module.exports = { runPipeline };
