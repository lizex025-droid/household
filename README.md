# بيت — Household spending

Arabic RTL household-expense application built with HTML, CSS, JavaScript and Supabase.

## Features
- Budgets, expenses, incomes, receipts, member management and reports.
- Supabase Authentication, database and storage in cloud mode.
- Optional local demo with synthetic household data.
- Optional Arab Bank SMS automation using revocable, account-scoped keys, with precision to three decimals in JOD.

## Configuration
Use `.env.example` as a reference. Do not commit `.env`, passwords, personal bank statements, private keys, tokens or receipts.

The browser requires a Supabase **publishable key**, which is intentionally visible to browser users. Enforce authorization using server-side Row Level Security (RLS). Only Edge Function deployment environments may contain service credentials; never use a service-role key in browser `config.js`.

The checked-in `config.js` is limited to browser-public settings. Bank accounts are configured by authorized members in Settings after deployment. Production migrations do not need personally identifiable seed data.

## Development
- Serve the app using `python -m http.server 8000`.
- Run `npm install` then `npm run test:bank`.
- `npm run test:bank:browser` runs offline UI fixtures when Playwright is installed.
- Database migrations: `supabase/migrations/`. Bank SMS Edge Function: `supabase/functions/bank-sms/`.
- iPhone automation documentation: `docs/iphone-bank-automation.md`.

## Security
Anything checked into a public GitHub repository can be read, including historical commits. Use synthetic fixtures only. Rotate or revoke credentials exposed in the past, and follow GitHub's sensitive-data history-removal procedure if necessary.
