/** Agent 4: trust only the separate vendor master record, never submission contacts. */
function buildVerificationTask(vendor, riskLevel, now) {
  if (riskLevel !== "high") return null;
  return {
    status: "pending",
    createdAt: now,
    callbackNumberUsed: vendor?.verifiedPhone || null,
    contactName: vendor?.verifiedContact || null,
    contactSource: vendor ? "trusted-vendor-record" : "unavailable",
    verifiedAt: vendor?.contactVerifiedAt || null,
    instructions: vendor
      ? `Call ${vendor.verifiedContact} at ${vendor.verifiedPhone} from the trusted vendor record. Confirm the invoice and bank details independently. Do not use a phone number or link in the submitted message.`
      : "No pre-verified contact is on file. Keep payment held and independently onboard the vendor. An invoice-supplied contact cannot verify itself.",
  };
}
const paymentState = (risk) =>
  risk === "high"
    ? "held"
    : risk === "medium"
      ? "manual_review"
      : "ready_for_review";
module.exports = { buildVerificationTask, paymentState };
