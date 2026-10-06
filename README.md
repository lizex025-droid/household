# بيت — Household spending

## Current cloud version

The current frontend connects to Supabase Auth, the household database and receipt storage. The older local-only notes below describe the optional `mode: local` version and do not describe the current production default.

Arab Bank purchase SMS automation is available under Settings. Account `0119*600` is mapped to Ahed bseiso. An iPhone Shortcuts automation posts messages to the authenticated `bank-sms` Edge Function using a revocable, account-scoped key. Imports are atomic and deduplicated, use JOD precision of three decimals, and create editable expenses. See [the Arabic iPhone guide](docs/iphone-bank-automation.md). No iPhone automation is installed by deploying this repository; complete the guide on the phone.

The additive SQL migration is in `supabase/migrations/`; function source is in `supabase/functions/bank-sms/`. `npm run test:bank` checks parser, permissions, precision and idempotency in disposable PGlite. Run `npm run test:bank:browser` with Playwright installed for offline UI fixtures; the test starts its own temporary server.

## Historical local version notes

A responsive Arabic RTL household expense application made with HTML, CSS and vanilla JavaScript. Open `index.html` directly, or serve this folder with `python -m http.server 8000` and visit `http://localhost:8000`.

The Supabase database is ready in [supabase/setup.sql](supabase/setup.sql). See the [Arabic setup guide](supabase/README.md). This is a tested SQL setup artifact; it has not been deployed to the cloud. The current frontend still uses localStorage until the authentication/data integration is connected.

Includes a dashboard, month/year comparison charts, expense creation/editing/deletion, Arabic quick entry with editable previews, receipt images, learned and pinned favorites, search and advanced filters, household/member/category budgets, local budget alerts, member management, custom categories, printable reports (choose **Save as PDF** in the print dialog), CSV export, report sharing, and JSON backup/restore.

The initial configuration is عائلة بسيسو with a 1,400 JOD monthly budget. Allocations are rent 275, food 600, internet 50, electricity/water 50, Tatiana's gym 135 and Ahed's gym 50: 1,160 JOD allocated and 240 JOD unallocated. Other category budgets and all recorded expenses start at zero. Family members are هاني، انس، نجوى، تتيانا، ناهض، عاهد. Ahed is the local admin; only his profile has the supplied email. Tatiana and Ahed have member limits of 135 and 50 respectively, matching their gym allocations; the other member limits are zero. These are overlapping member/category limits, not additional household allocations.

Additional income records have an amount, date, source/person, recipient, payment method and optional note, and can be edited or deleted. Available balance = selected month's base budget + additional income − expenses. Budget edits do not create income transactions. Income belongs only to its recorded month; there is no automatic rollover.

The **تعديل الميزانية** button defaults to changing only the selected month. The optional default setting applies to months without an override, including past months. Category/member limits remain independent recurring limits. Existing family data and older backups remain compatible; missing income/monthly override fields default to empty. Amounts use JOD. The localStorage key remains `bayt-household-bseiso-v1`.

## Local storage and accounts

Data stays in this browser's localStorage. Export backups regularly; clearing site/browser data removes local records. Receipt images have a 2 MB limit, and the browser's total storage quota may be smaller than a collection of receipts. A failed write is reported and rolled back.

The account switcher demonstrates admin/member views. **It is not authentication or a security boundary.** A production multi-user service requires a backend, authenticated sessions, server-enforced household isolation and permissions, HTTPS, secure receipt storage and backup infrastructure. No passwords are collected. There is no remote synchronization, device logout, or biometric login in this local version.

The interface uses IBM Plex Sans Arabic from Google Fonts when available, with local system fallbacks. No JavaScript libraries or build tools are required.

## Validation

`node --check app.js` checks JavaScript syntax. `tests/browser-smoke.mjs` runs real browser integration checks using Chrome's DevTools protocol and Node 22 (no npm dependencies). Start the local server at port 8000 and a dedicated test Chrome with remote debugging on port 9222, then run `node tests/browser-smoke.mjs`. Use a disposable browser profile: this test resets that browser's app data. It checks expense CRUD, quick entry, persistence, filtering, budgets, categories, member views, receipt persistence, HTML escaping, storage-quota rollback, JSON restoration, PDF generation and mobile layout. Screenshots and a sample PDF are written to `artifacts/`.

