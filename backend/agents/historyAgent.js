const { normalizeBank } = require("./extractionAgent");

// Transparent phrase detection, not a trained tone classifier.
const URGENCY_PHRASES = [
  "process today",
  "right away",
  "as soon as possible",
  "urgent",
  "back-to-back meetings",
  "immediately",
  "payment today",
  "within the hour",
];
const money = (amount) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    amount,
  );
const findVendor = (vendors, name) =>
  vendors.find((v) => v.name.toLowerCase() === name.toLowerCase());

/** Agent 2: positive matches AND deviations, with explicit comparisons and weights. */
function checkHistory(invoice, vendor) {
  const signals = [];
  const checks = [];
  function check(type, label, passed, weight, detail, expected, observed) {
    const item = {
      type,
      label,
      status: passed ? "match" : "deviation",
      detail,
      expected,
      observed,
      weight: passed ? 0 : weight,
    };
    checks.push(item);
    if (!passed)
      signals.push({ ...item, severity: weight >= 60 ? "high" : "medium" });
  }
  if (!vendor) {
    check(
      "UNKNOWN_VENDOR",
      "Vendor identity",
      false,
      80,
      "No trusted vendor fingerprint exists. Independently onboard the vendor before any payment.",
      "A registered vendor",
      invoice.vendorName,
    );
    for (const label of [
      "Bank account",
      "Email domain",
      "Invoice amount",
      "Message tone",
    ]) {
      checks.push({
        label,
        status: "unavailable",
        detail: "No trusted baseline available.",
        weight: 0,
      });
    }
    return { signals, checks, vendor: null };
  }
  const known = vendor.knownBankAccounts
    .map(normalizeBank)
    .includes(invoice.bankAccount);
  check(
    "NEW_BANK_ACCOUNT",
    "Bank account",
    known,
    60,
    known
      ? "Bank account matches the trusted vendor record."
      : "This bank account is absent from the trusted vendor record.",
    vendor.knownBankAccounts.join(", "),
    invoice.bankAccount,
  );
  const domain = invoice.requesterEmail.split("@")[1];
  const domainMatch = domain === vendor.domain.toLowerCase();
  check(
    "DOMAIN_MISMATCH",
    "Email domain",
    domainMatch,
    35,
    domainMatch
      ? "Requester domain matches the vendor domain. This does not prove mailbox ownership."
      : "Requester domain differs from the trusted vendor domain.",
    vendor.domain,
    domain,
  );
  const [min, max] = vendor.typicalAmountRange;
  const inRange = invoice.amount >= min && invoice.amount <= max;
  check(
    "AMOUNT_OUTLIER",
    "Invoice amount",
    inRange,
    20,
    inRange
      ? "Invoice is within the established amount range."
      : "Invoice is outside the established amount range.",
    `${money(min)} – ${money(max)}`,
    money(invoice.amount),
  );
  const message = invoice.emailText
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
  const phrases = URGENCY_PHRASES.filter((phrase) => message.includes(phrase));
  // Compare tone against actual trusted history instead of assuming every vendor is calm.
  const urgentHistory = vendor.invoiceHistory.filter(
    (i) => i.tone === "urgent",
  ).length;
  const usualUrgency = urgentHistory / vendor.invoiceHistory.length >= 0.5;
  if (!message) {
    checks.push({
      type: "URGENCY_LANGUAGE",
      label: "Message tone",
      status: "unavailable",
      weight: 0,
      detail: "No message supplied; tone could not be checked.",
      expected: vendor.typicalTone,
      observed: "Not provided",
    });
  } else {
    const toneDeviation = phrases.length > 0 && !usualUrgency;
    check(
      "URGENCY_LANGUAGE",
      "Message tone",
      !toneDeviation,
      20,
      toneDeviation
        ? `Urgency phrases (${phrases.map((p) => `“${p}”`).join(", ")}) differ from the vendor’s usual ${vendor.typicalTone} tone.`
        : "No urgency deviation found by the phrase-based tone check.",
      `${vendor.typicalTone}; ${urgentHistory}/${vendor.invoiceHistory.length} historical messages urgent`,
      phrases.length ? phrases.join(", ") : "Routine language",
    );
  }
  return { signals, checks, vendor };
}
module.exports = { checkHistory, findVendor, URGENCY_PHRASES };
