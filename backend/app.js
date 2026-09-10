const express = require("express");
const path = require("node:path");
const vendors = require("./data/vendors.json");
const demos = require("./data/demo-invoices.json");
const { Store } = require("./store");
const { runPipeline } = require("./pipeline");
const { ValidationError } = require("./agents/extractionAgent");

async function createApp(options = {}) {
  const env = options.env || process.env;
  const store = new Store(
    options.dataDir || path.resolve(__dirname, "..", env.DATA_DIR || "runtime"),
  );
  if (store.fresh) {
    const initial = [];
    if (options.seedDemo ?? env.SEED_DEMO !== "false") {
      // Bootstrap examples never call Azure; every sample still goes through all four agents.
      for (const input of demos.initial) {
        const record = await runPipeline(input, vendors, { env: {} });
        initial.unshift({ ...record, sample: true });
      }
    }
    store.commit(initial);
  }
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    next();
  });
  // Same-origin JSON API. No permissive CORS; external web pages cannot post forms here.
  app.use("/api", (req, res, next) => {
    if (req.method === "POST") {
      if (!req.is("application/json"))
        return res
          .status(415)
          .json({ error: "Use Content-Type: application/json." });
      if (
        req.headers.origin &&
        req.headers.origin !== `${req.protocol}://${req.get("host")}`
      ) {
        return res
          .status(403)
          .json({ error: "Cross-origin writes are not allowed." });
      }
    }
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (req, res) =>
    res.json({
      status: "ok",
      version: "1.0.0",
      reasoningMode: [
        env.AZURE_OPENAI_ENDPOINT,
        env.AZURE_OPENAI_KEY,
        env.AZURE_OPENAI_DEPLOYMENT,
      ].every((v) => v?.trim())
        ? "azure-configured"
        : "rule-based",
      storage: "local-json",
    }),
  );
  app.get("/api/vendors", (req, res) => res.json(vendors));
  app.get("/api/demo", (req, res) =>
    res.json({ low: demos.low, high: demos.high }),
  );
  app.get("/api/invoices", (req, res) => res.json(store.list()));
  app.get("/api/invoices/:id", (req, res) => {
    const record = store.get(req.params.id);
    if (!record) return res.status(404).json({ error: "Invoice not found." });
    res.json(record);
  });
  app.post("/api/invoices", async (req, res) => {
    const record = await runPipeline(req.body, vendors, {
      env,
      fetchImpl: options.fetchImpl,
    });
    store.insert(record);
    res.status(201).json(record);
  });
  app.post("/api/invoices/:id/verification", (req, res) => {
    const record = store.get(req.params.id);
    if (!record?.verification)
      return res.status(404).json({ error: "Verification task not found." });
    if (record.verification.status !== "pending")
      return res
        .status(409)
        .json({ error: "This callback task has already been resolved." });
    const { outcome, reviewer, notes, callbackCompleted } = req.body || {};
    if (!["confirmed", "rejected"].includes(outcome))
      throw new ValidationError("Choose confirmed or rejected.");
    if (
      typeof reviewer !== "string" ||
      reviewer.trim().length < 2 ||
      reviewer.trim().length > 80
    ) {
      throw new ValidationError("Provide a reviewer name (2–80 characters).");
    }
    if (
      typeof notes !== "string" ||
      notes.trim().length < 10 ||
      notes.trim().length > 2000
    ) {
      throw new ValidationError(
        "Provide callback findings (10–2,000 characters).",
      );
    }
    if (
      outcome === "confirmed" &&
      (!record.verification.callbackNumberUsed || callbackCompleted !== true)
    ) {
      throw new ValidationError(
        "Confirmation requires a completed callback to the pre-verified number. Unknown vendors must be independently onboarded first.",
      );
    }
    const at = new Date().toISOString();
    record.verification = {
      ...record.verification,
      status: outcome,
      resolvedAt: at,
      reviewer: reviewer.trim(),
      notes: notes.trim(),
      callbackCompleted: callbackCompleted === true,
    };
    record.paymentStatus =
      outcome === "confirmed" ? "ready_for_review" : "blocked";
    // Retain the original risk, trace, and immutable vendor fingerprint.
    record.audit.push({
      action: `verification_${outcome}`,
      at,
      reviewer: reviewer.trim(),
      detail: notes.trim(),
    });
    store.update(record);
    res.json(record);
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use(express.static(path.join(__dirname, "..", "frontend")));
  app.use((req, res) => res.status(404).send("Page not found."));
  app.use((error, req, res, next) => {
    const status = error.status || 500;
    const message =
      status === 413
        ? "Submission is too large (maximum 32 KB)."
        : error.type === "entity.parse.failed"
          ? "Invalid JSON body."
          : status >= 500
            ? "Unable to save or process this invoice. Check the server console and retry."
            : error.message;
    if (status >= 500)
      console.error("VendorGuard request failed:", error.message);
    res.status(status).json({ error: message });
  });
  return app;
}
module.exports = { createApp };
