# VendorGuard verification report

Tested on Windows with Node.js 24.19.0 and npm 11.6.2. Default application requires Node 22+.

## Executed checks

- `npm install`: successful; 68 packages installed; npm audit reported zero vulnerabilities at installation time.
- `npm start`: Express and the dashboard started successfully on port 4000.
- `npm test`: **17 passed, 0 failed** using Node's built-in test runner and isolated data storage.
- `npm run demo`: both actual HTTP submissions passed: **LOW score 0** and **HIGH score 80**, with the high-risk payment held and trusted callback `+1 (202) 555-0101` selected.
- `node scripts/browser-smoke.js`: passed using Playwright and headless Microsoft Edge at desktop 1536×1050 and mobile 390×844.

## Browser coverage

Seeded feed; normal and suspicious form presets; actual low/high submissions; all four trace stages; trusted callback selection; callback confirmation validation; successful confirmation; rejection and blocked state; risk filter; search and empty state; background feed updates after an external submission; vendor history expansion; pipeline guide; unknown-vendor restrictions; HTML-injection text safely escaped; mobile form and review; no browser exceptions or console errors.

An initial mobile page overflow was detected, fixed by scoping the scroll container and using mobile invoice cards, and the full browser check then passed. Desktop, mobile, form and high-risk trace screenshots were visually inspected.

## Backend coverage

Health/static assets; seven fingerprints/28 trusted invoices; HTTP low/high/medium outcomes; new-account-only hold; exact domain matching; case/spacing normalization; missing email marked unassessed; historical urgency comparison; unknown vendor and no untrusted callback; malformed/negative/oversized input; human review evidence; repeated-resolution conflicts; unchanged master fingerprints; rejected-payment blocking; unsupported content types; cross-origin write rejection; concurrent submissions; saved records and outcomes after reopening storage.

## Azure coverage and limits

The optional Azure path was exercised with injected HTTP response mocks for success, missing/partial configuration, network failure, error status, malformed JSON, missing content, refusal, invalid endpoint, and timeout. Risk and hold states remained deterministic. Tests verify that raw invoice content and API keys are absent from the outward evidence/returned records as appropriate.

No real Azure resource was called, and no OCR was executed. Document Intelligence is a clearly marked example/TODO, as requested. No real phone call or payment took place. Passing tests establishes the demonstrated software behavior, not fraud detection accuracy.
