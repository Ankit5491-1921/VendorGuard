/* Plain browser JavaScript: one Express origin, no bundler, CDN, or frontend API key.
 * Escape every dynamic string before HTML rendering, including optional AI output.
 */
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const dateTime = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const initials = (name) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
const paymentLabels = {
  held: "On hold",
  blocked: "Blocked",
  manual_review: "Manual review",
  ready_for_review: "Ready for review",
};
const badge = (level) =>
  `<span class="badge ${esc(level)}">${esc(level.toUpperCase())} RISK</span>`;
const state = {
  vendors: [],
  invoices: [],
  demos: null,
  selected: null,
  view: "overview",
  busy: false,
  refreshing: false,
};
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(40000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "The request could not be completed.");
  return body;
}
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5000);
}
function displayError(selector, message) {
  $(selector).textContent = message;
  $(selector).hidden = !message;
}
function setConnection(connected) {
  $("#connection").classList.toggle("offline", !connected);
  $("#connection").innerHTML =
    `<span class="online-dot"></span>${connected ? "Workspace connected" : "Connection lost"}`;
}
function pendingInvoices() {
  return state.invoices.filter((i) => i.verification?.status === "pending");
}

function renderStats() {
  const held = state.invoices.filter((i) => i.paymentStatus === "held");
  const low = state.invoices.filter((i) => i.riskLevel === "low");
  const medium = state.invoices.filter((i) => i.riskLevel === "medium");
  const stats = [
    [
      "Invoices reviewed",
      state.invoices.length,
      "Across all submissions",
      "file",
      "",
      "",
    ],
    ["Low risk", low.length, "Ready for standard review", "check", "green", ""],
    [
      "Manual review",
      medium.length,
      "Medium-risk invoices",
      "alert",
      "amber",
      "",
    ],
    [
      "Payment on hold",
      money(held.reduce((sum, i) => sum + i.amount, 0)),
      `${held.length} invoice${held.length === 1 ? "" : "s"} awaiting verification`,
      "shield",
      "coral",
      "held",
    ],
  ];
  $("#stats").innerHTML = stats
    .map(
      ([label, value, note, symbol, color, cls]) =>
        `<article class="stat ${cls}"><div class="stat-top"><span>${label}</span><span class="icon-tile ${color}">${icon(symbol)}</span></div><div class="stat-value">${esc(value)}</div><p class="stat-note">${note}</p></article>`,
    )
    .join("");
  $("#invoice-count").textContent = state.invoices.length;
  $("#nav-pending").textContent = pendingInvoices().length;
}
function renderFeed() {
  const search = $("#search").value.toLowerCase().trim();
  const risk = $("#risk-filter").value;
  const rows = state.invoices.filter(
    (i) =>
      (risk === "all" || i.riskLevel === risk) &&
      `${i.vendorName} ${i.invoiceNumber} ${i.requesterEmail}`
        .toLowerCase()
        .includes(search),
  );
  $("#feed").innerHTML = rows.length
    ? rows
        .map(
          (i, index) =>
            `<tr><td><div class="vendor-cell"><span class="vendor-monogram tone${index % 4}">${esc(initials(i.vendorName))}</span><div><button class="invoice-link" data-invoice="${esc(i.id)}">${esc(i.vendorName)}</button><small>${esc(i.invoiceNumber)}${i.sample ? " · SAMPLE" : ""}</small></div></div></td><td class="money">${money(i.amount)}</td><td>${badge(i.riskLevel)}</td><td><span class="payment-state ${esc(i.paymentStatus)}">${esc(paymentLabels[i.paymentStatus])}</span></td><td><button class="icon-button" data-invoice="${esc(i.id)}" aria-label="Review ${esc(i.invoiceNumber)}">${icon("arrow")}</button></td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="empty"><strong>${state.invoices.length ? "No invoices match your filters." : "Your first review starts here."}</strong>${state.invoices.length ? "Try a different vendor or risk level." : "Submit an invoice or load one of the demo examples."}</td></tr>`;
  $("#feed-caption").textContent =
    `${rows.length} of ${state.invoices.length} invoices · USD`;
}
function taskCard(i, standalone = false) {
  const phone = i.verification.callbackNumberUsed;
  const body = `<div class="attention-body"><div class="attention-vendor"><strong>${esc(i.vendorName)}</strong>${badge(i.riskLevel)}</div><div class="attention-amount">${money(i.amount)}</div><p>${esc(i.signals.map((s) => s.label).join(" + "))}. Payment remains on hold until this review is resolved.</p><div class="phone-card"><small>PRE-VERIFIED VENDOR CONTACT</small><div class="phone-number">${phone ? esc(phone) : "No trusted number on file"}</div><p>${esc(i.verification.contactName || "Independent vendor onboarding required")}</p></div><button class="button primary wide" data-invoice="${esc(i.id)}">Review & verify ${icon("arrow")}</button>${!standalone ? `<div class="attention-footer">${pendingInvoices().length} pending callback task${pendingInvoices().length === 1 ? "" : "s"}</div>` : ""}</div>`;
  return standalone
    ? `<article class="panel"><div class="panel-heading"><h2>${esc(i.invoiceNumber)}</h2><span class="payment-state held">On hold</span></div>${body}</article>`
    : body;
}
function renderTasks() {
  const pending = pendingInvoices();
  const empty = `<div class="empty">${icon("check")}<strong>No callbacks pending.</strong>High-risk invoices will appear here with the trusted vendor contact.</div>`;
  $("#attention").innerHTML = pending.length ? taskCard(pending[0]) : empty;
  $("#verification-list").innerHTML = pending.length
    ? pending.map((i) => taskCard(i, true)).join("")
    : `<div class="panel full">${empty}</div>`;
}
function renderVendors() {
  $("#vendor-options").innerHTML = state.vendors
    .map((v) => `<option value="${esc(v.name)}"></option>`)
    .join("");
  $("#vendor-list").innerHTML = state.vendors
    .map(
      (v, idx) =>
        `<article class="panel vendor-card"><span class="vendor-monogram tone${idx % 4}">${esc(initials(v.name))}</span><h2>${esc(v.name)}</h2><p>${esc(v.category)}</p><dl><dt>Known bank reference</dt><dd>${esc(v.knownBankAccounts.join(", "))}</dd><dt>Typical invoice range</dt><dd>${money(v.typicalAmountRange[0])} – ${money(v.typicalAmountRange[1])}</dd><dt>Trusted email domain</dt><dd>${esc(v.domain)}</dd><dt>Pre-verified callback contact</dt><dd>${esc(v.verifiedContact)}<small>${esc(v.verifiedPhone)} · verified ${esc(v.contactVerifiedAt)}</small></dd></dl><details><summary>${v.invoiceHistory.length} trusted historical invoices</summary>${v.invoiceHistory.map((i) => `<div class="history-row"><span>${esc(i.date)}<small>${esc(i.invoiceNumber)} · ${esc(i.tone)} tone</small></span><strong>${money(i.amount)}</strong></div>`).join("")}</details></article>`,
    )
    .join("");
}
function renderGuide() {
  const agents = [
    [
      "Extraction Agent",
      "Pulls structured fields from your submission, validates the amount and email, and normalizes the bank reference. A documented extension point supports future PDF/OCR integration.",
    ],
    [
      "History Agent",
      "Compares the invoice against a separate trusted vendor fingerprint: bank accounts, domain, typical amount range and historical message tone. It records matches, deviations and missing evidence.",
    ],
    [
      "Reasoning Agent",
      "Adds the signal weights and assigns low, medium or high risk. It writes a factual rationale and an action. Azure can optionally add a summary; failures fall back to local rules.",
    ],
    [
      "Verification Agent",
      "High risk creates a payment hold and callback task. A human uses the pre-verified vendor number and records the outcome. Confirmed invoices return to review; rejected invoices remain blocked.",
    ],
  ];
  $("#agent-guide").innerHTML = agents
    .map(
      ([name, description], idx) =>
        `<article class="panel guide-card"><span>0${idx + 1}</span><h3>${name}</h3><p>${description}</p></article>`,
    )
    .join("");
}
function renderOverview() {
  renderStats();
  renderFeed();
  renderTasks();
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    state.invoices = await api("/api/invoices");
    renderOverview();
    setConnection(true);
    displayError("#global-error", "");
  } catch (error) {
    setConnection(false);
    displayError(
      "#global-error",
      `Unable to refresh the feed. ${error.message} Displayed records may be stale; retrying automatically.`,
    );
  } finally {
    state.refreshing = false;
  }
}

function showView(view) {
  state.view = view;
  const headings = {
    overview: [
      "Overview",
      "Payment risk overview",
      "Catch the change. Verify the source. Protect the payment.",
    ],
    verification: [
      "Verification queue",
      "A trusted callback comes first",
      "Resolve high-risk invoices with evidence from a verified vendor contact.",
    ],
    vendors: [
      "Vendor directory",
      "Know who you pay",
      "The trusted fingerprints behind every invoice review.",
    ],
    pipeline: [
      "How it works",
      "From invoice to informed decision",
      "A clear, four-agent pipeline you can inspect and explain.",
    ],
  };
  const [crumb, title, subtitle] = headings[view];
  $("#breadcrumb").textContent = crumb;
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden = el.id !== `${view}-view`;
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
    if (button.dataset.view === view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}
function openForm(preset) {
  if (state.busy) return;
  const form = $("#invoice-form");
  form.reset();
  displayError("#form-error", "");
  if (preset) {
    if (!state.demos) {
      notify("Demo examples are still loading. Try again shortly.");
      return;
    }
    for (const [key, value] of Object.entries(state.demos[preset]))
      if (form.elements.namedItem(key))
        form.elements.namedItem(key).value = value;
  }
  if (!$("#invoice-dialog").open) $("#invoice-dialog").showModal();
}

function renderCheck(c) {
  return `<div class="check-row ${esc(c.status)}"><div class="check-top">${icon(c.status === "deviation" ? "alert" : c.status === "match" ? "check" : "file")}<span>${esc(c.label)}</span><span>${c.status === "deviation" ? `+${c.weight} points` : c.status === "match" ? "MATCH" : "NOT ASSESSED"}</span></div><p>${esc(c.detail)}</p>${c.expected ? `<div class="check-compare"><div><b>TRUSTED BASELINE</b>${esc(c.expected)}</div><div><b>SUBMITTED / OBSERVED</b>${esc(c.observed)}</div></div>` : ""}</div>`;
}
function renderCallback(i) {
  const v = i.verification;
  if (!v) return "";
  const pending = v.status === "pending";
  return `<section class="callback-box"><h3>${icon("phone")}${pending ? "Payment on hold · Callback required" : `Callback review ${esc(v.status)}`}</h3><p>${esc(v.instructions)}</p><div class="phone-card"><small>TRUSTED VENDOR RECORD · ${esc(v.verifiedAt || "NO VERIFIED CONTACT")}</small><div class="phone-number">${esc(v.callbackNumberUsed || "No trusted phone number available")}</div><p>${esc(v.contactName || "Independently onboard this vendor before considering approval.")}</p></div>${pending ? `<form id="resolution-form" class="resolution-form"><label>Reviewer name<input name="reviewer" required minlength="2" maxlength="80" placeholder="Your name"></label><label>Review / callback findings<textarea name="notes" required minlength="10" maxlength="2000" rows="3" placeholder="Record who you spoke to and what they confirmed…"></textarea></label><label class="checkbox-label"><input name="callbackCompleted" type="checkbox" ${v.callbackNumberUsed ? "" : "disabled"}>I completed an independent callback using the trusted number shown above.</label><p id="resolution-error" class="inline-error" role="alert" hidden></p><div class="resolution-actions"><button class="button primary" type="submit" name="outcome" value="confirmed" ${v.callbackNumberUsed ? "" : "disabled"}>Confirm details · Return to review</button><button class="button coral-soft" type="submit" name="outcome" value="rejected">Reject & block</button></div><span class="status-note">Records a human decision in this demo. It does not send a payment or modify the vendor fingerprint.</span></form>` : `<p><strong>${esc(v.reviewer)}</strong> · ${esc(dateTime(v.resolvedAt))}<br>${esc(v.notes)}</p><span class="badge ${v.status === "confirmed" ? "low" : "high"}">${v.status === "confirmed" ? "RETURNED TO REVIEW" : "PAYMENT BLOCKED"}</span>`}</section>`;
}
function renderDetail(i) {
  const titles = {
    high: "A closer look before money moves.",
    medium: "Some details need a second look.",
    low: "Consistent with the trusted record.",
  };
  const summaries = {
    high: `${i.signals.length} deviation signal(s) triggered a mandatory verification task.`,
    medium: `${i.signals.length} deviation signal(s) require manual review.`,
    low: "No deviations were detected in the available fields. Continue with your standard approval process.",
  };
  $("#detail-content").innerHTML =
    `<div class="dialog-heading"><div><p class="eyebrow">INVOICE REVIEW · ${esc(i.invoiceNumber)}</p><h2>${esc(i.vendorName)}</h2><div class="detail-heading-meta">${badge(i.riskLevel)}<span>${esc(dateTime(i.submittedAt))}</span>${i.sample ? "<span>SAMPLE DATA</span>" : ""}</div></div><button class="icon-button" data-close="detail-dialog" aria-label="Close invoice details">${icon("close")}</button></div><div class="detail-body"><div class="risk-summary ${esc(i.riskLevel)}"><div class="score-block"><strong>${i.score}</strong><small>RISK POINTS / 100</small><progress max="100" value="${i.score}" aria-label="Risk points"></progress></div><div><h3>${titles[i.riskLevel]}</h3><p>${summaries[i.riskLevel]}<br><strong>Current state: ${esc(paymentLabels[i.paymentStatus])}.</strong></p></div></div><dl class="detail-facts"><div><dt>Invoice amount</dt><dd class="money">${money(i.amount)} USD</dd></div><div><dt>Submitted bank account</dt><dd>${esc(i.bankAccount)}</dd></div><div><dt>Requester</dt><dd>${esc(i.requesterEmail)}</dd></div></dl><h3 class="section-title">Four-agent evidence trace</h3>${i.trace.map((step, index) => `<section class="trace-step"><span class="step-number">0${index + 1}</span><div class="step-content"><h3>${esc(step.agent)} Agent <span>${esc(step.title)}</span></h3><p>${esc(step.summary)}</p>${step.checks ? `<div class="checks">${step.checks.map(renderCheck).join("")}</div>` : ""}${step.agent === "Reasoning" && i.aiSummary ? `<div class="ai-note"><strong>Azure advisory summary</strong><p>${esc(i.aiSummary)}</p><p>The policy decision above remains authoritative.</p></div>` : ""}${step.agent === "Reasoning" && i.fallbackReason ? `<p class="status-note">${esc(i.fallbackReason)}</p>` : ""}</div></section>`).join("")}<p class="status-note">${esc(i.mode)} · ${i.durationMs} ms · Scores are policy weights, not probabilities. Trace records the original analysis.</p>${renderCallback(i)}<h3 class="section-title">Submitted email message</h3><div class="message-box">${esc(i.emailText || "No email message was provided. Tone was not assessed.")}</div><h3 class="section-title">Review activity</h3>${i.audit.map((a) => `<div class="audit-row"><strong>${esc(a.action.replaceAll("_", " "))}</strong> · ${esc(dateTime(a.at))}${a.reviewer ? ` · ${esc(a.reviewer)}` : ""}<br>${esc(a.detail)}</div>`).join("")}</div>`;
  $("#resolution-form")?.addEventListener("submit", resolveVerification);
}
async function openDetail(id) {
  try {
    const i = await api(`/api/invoices/${encodeURIComponent(id)}`);
    state.selected = id;
    renderDetail(i);
    if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
  } catch (error) {
    notify(`Could not load invoice: ${error.message}`);
  }
}
async function resolveVerification(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const outcome = event.submitter?.value;
  if (!outcome) return;
  const body = {
    ...values,
    outcome,
    callbackCompleted: form.elements.callbackCompleted.checked,
  };
  if (outcome === "confirmed" && !body.callbackCompleted) {
    displayError(
      "#resolution-error",
      "Complete the callback to the trusted number and tick the confirmation box first.",
    );
    return;
  }
  const buttons = [...form.querySelectorAll("button")];
  buttons.forEach((b) => {
    b.disabled = true;
  });
  try {
    const record = await api(
      `/api/invoices/${encodeURIComponent(state.selected)}/verification`,
      { method: "POST", body: JSON.stringify(body) },
    );
    renderDetail(record);
    await refresh();
    notify(
      outcome === "confirmed"
        ? "Callback recorded. Invoice returned to standard review."
        : "Review recorded. Payment is blocked.",
    );
  } catch (error) {
    displayError("#resolution-error", error.message);
    buttons.forEach((b) => {
      b.disabled = false;
    });
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) showView(button.dataset.view);
  if (button.dataset.demo) openForm(button.dataset.demo);
  if (button.dataset.invoice) openDetail(button.dataset.invoice);
  if (
    button.dataset.close &&
    !(button.dataset.close === "invoice-dialog" && state.busy)
  )
    $(`#${button.dataset.close}`).close();
});
$("#new-invoice").addEventListener("click", () => openForm());
$("#search").addEventListener("input", renderFeed);
$("#risk-filter").addEventListener("change", renderFeed);
$("#invoice-dialog").addEventListener("cancel", (event) => {
  if (state.busy) event.preventDefault();
});
$("#invoice-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  state.busy = true;
  const body = Object.fromEntries(new FormData(event.currentTarget));
  const button = $("#submit-invoice");
  button.disabled = true;
  button.textContent = "Running four-agent review…";
  displayError("#form-error", "");
  try {
    const invoice = await api("/api/invoices", {
      method: "POST",
      body: JSON.stringify(body),
    });
    $("#invoice-dialog").close();
    state.selected = invoice.id;
    renderDetail(invoice);
    $("#detail-dialog").showModal();
    showView("overview");
    await refresh();
    notify(`Review complete · ${invoice.riskLevel.toUpperCase()} risk`);
  } catch (error) {
    displayError("#form-error", `Submission failed: ${error.message}`);
  } finally {
    state.busy = false;
    button.disabled = false;
    button.innerHTML = `${icon("shield")}Analyze invoice`;
  }
});

async function initialize() {
  renderGuide();
  try {
    const [vendors, demos, health] = await Promise.all([
      api("/api/vendors"),
      api("/api/demo"),
      api("/api/health"),
    ]);
    state.vendors = vendors;
    state.demos = demos;
    renderVendors();
    $("#mode-label").textContent =
      health.reasoningMode === "azure-configured"
        ? "Azure configured · Local policy always active"
        : "Local rule-based reasoning · No API key needed";
    await refresh();
  } catch (error) {
    setConnection(false);
    displayError(
      "#global-error",
      `Could not load workspace: ${error.message} Retrying shortly.`,
    );
    setTimeout(initialize, 4000);
  }
}
initialize();
setInterval(() => {
  if (!document.hidden && state.demos) refresh();
}, 4000);
