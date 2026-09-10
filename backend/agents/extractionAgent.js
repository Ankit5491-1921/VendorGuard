/** Agent 1: validate and normalize the structured invoice form / JSON submission.
 * Deliberately allowlist fields: an invoice cannot set its risk, hold, or trusted phone.
 * This demo extracts structured fields, not arbitrary PDFs or unstructured email.
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function text(input, key, max, required = true) {
  const value = input[key];
  if (!required && value === undefined) return "";
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  ) {
    throw new ValidationError(
      `${key} must be ${required ? "non-empty " : ""}text, up to ${max} characters.`,
    );
  }
  return value.trim();
}

const normalizeBank = (value) => value.replace(/[\s-]/g, "").toUpperCase();

function extract(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError(
      "Submit a JSON object containing invoice fields.",
    );
  }
  const vendorName = text(input, "vendorName", 120);
  const bankAccount = normalizeBank(text(input, "bankAccount", 50));
  const requesterEmail = text(input, "requesterEmail", 254).toLowerCase();
  if (!/^[A-Z0-9]{4,34}$/.test(bankAccount)) {
    throw new ValidationError(
      "bankAccount must contain 4–34 letters or digits (spaces and hyphens are allowed).",
    );
  }
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(
      requesterEmail,
    )
  ) {
    throw new ValidationError(
      "Enter a valid requesterEmail, for example billing@vendor.example.",
    );
  }
  if (
    !["number", "string"].includes(typeof input.amount) ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(input.amount).trim())
  ) {
    throw new ValidationError(
      "amount must be a positive decimal with at most two decimal places.",
    );
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    throw new ValidationError(
      "amount must be greater than 0 and no more than 100,000,000.",
    );
  }
  if (input.currency !== undefined && input.currency !== "USD") {
    throw new ValidationError("This demo supports USD invoices only.");
  }
  return {
    vendorName,
    amount,
    currency: "USD",
    bankAccount,
    requesterEmail,
    invoiceNumber: text(input, "invoiceNumber", 50, false),
    emailText: text(input, "emailText", 10000, false),
  };
}

module.exports = { extract, normalizeBank, ValidationError };

/* TODO: AZURE AI DOCUMENT INTELLIGENCE / REAL PDF EXTRACTION
 * Integration point: a future PDF upload route should run analyzePdf() BEFORE
 * calling runPipeline(). Map OCR fields into this same extract() validation path.
 * Example only; upload handling and this optional SDK are not installed or wired.
 * npm install @azure-rest/ai-document-intelligence
 *
 * async function analyzePdf(pdfBuffer, reviewedBankAccount, requesterEmail, emailText) {
 *   const { default: DocumentIntelligence, isUnexpected, getLongRunningPoller } =
 *     await import('@azure-rest/ai-document-intelligence');
 *   const client = DocumentIntelligence(process.env.DOCUMENT_INTELLIGENCE_ENDPOINT,
 *     { key: process.env.DOCUMENT_INTELLIGENCE_KEY });
 *   const response = await client.path('/documentModels/{modelId}:analyze', 'prebuilt-invoice')
 *     .post({ contentType: 'application/json', body: { base64Source: pdfBuffer.toString('base64') } });
 *   if (isUnexpected(response)) throw new Error('Invoice OCR failed');
 *   const result = (await getLongRunningPoller(client, response).pollUntilDone()).body;
 *   const fields = result.analyzeResult?.documents?.[0]?.fields;
 *   // Inspect OCR confidence; have a human review missing/low-confidence fields.
 *   // Bank details may require PaymentDetails mapping or a custom model and review.
 *   // Requester must come from email metadata; never use OCR to establish trusted contacts.
 *   return extract({ vendorName: fields?.VendorName?.valueString,
 *     amount: fields?.InvoiceTotal?.valueCurrency?.amount,
 *     currency: fields?.InvoiceTotal?.valueCurrency?.currencyCode,
 *     invoiceNumber: fields?.InvoiceId?.valueString || '',
 *     bankAccount: reviewedBankAccount, requesterEmail, emailText });
 * }
 * Documentation: https://learn.microsoft.com/en-us/javascript/api/overview/azure/ai-document-intelligence-rest-readme
 */
