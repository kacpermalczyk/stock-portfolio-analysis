# MyPortfelik

![](./public/template.png)

A private web application for analysing an XTB investment portfolio. The MVP supports one owner account, configured through environment variables; public registration does not exist.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [SQLite](https://www.sqlite.org/) via [Cloudflare D1](https://developers.cloudflare.com/d1/) - Local database, no separate server
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Create local environment files and fill in the owner login (see [Owner login](#owner-login)):

```bash
cp .env.example .env
cp .env.example .dev.vars
```

4. Create the local SQLite database schema:

```bash
npm run db:migrate
```

The database file is stored under `.wrangler/state/` and is created on first use. Nothing needs to run in the background.

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run db:migrate` - Apply SQL migrations to the local SQLite (D1) database
- `npm run db:reset` - Delete all local data and recreate an empty database
- `npm run auth:hash-password` - Print an `OWNER_PASSWORD_HASH` (reads the password from stdin)
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm test` - Run unit tests

## Project Structure

```md
.
├── migrations/ # SQL schema applied to the D1/SQLite database
├── scripts/ # Maintenance scripts (password hashing)
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── lib/ # Server logic: auth, database access, portfolio calculations
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config (includes the D1 binding `DB`)
```

## Owner login

Login uses a single owner account defined by environment variables. Values are read through Astro's `astro:env` schema and are **server-only secrets**; they are never exposed to client code.

| Variable              | Description                                                                        |
| --------------------- | ---------------------------------------------------------------------------------- |
| `OWNER_EMAIL`         | The owner's e-mail address                                                         |
| `OWNER_PASSWORD_HASH` | PBKDF2 hash of the owner's password, produced by `auth:hash-password`              |
| `SESSION_SECRET`      | Random string used to sign session cookies (for example `openssl rand -base64 32`) |

Generate the password hash without putting the password in your shell history:

```bash
read -rs PW && printf '%s' "$PW" | npm run -s auth:hash-password
```

Copy the printed line into `OWNER_PASSWORD_HASH` in `.env` and `.dev.vars`. Changing `SESSION_SECRET` signs everyone out.

### Owner access policy

- Only a valid signed session cookie, issued after a correct email and password, can open private routes.
- Sessions last 7 days and are stored as signed, HTTP-only cookies. No session data is kept in the database.
- Missing or incorrect configuration fails closed and blocks all private access.
- Do not prefix these variables with `PUBLIC_` or expose them to client code.

### Auth routes

| Route          | Description                                                                    |
| -------------- | ------------------------------------------------------------------------------ |
| `/auth/signin` | Owner email/password sign-in form                                              |
| `/dashboard`   | Private owner area; requests without a valid session are redirected to sign-in |
| `/history`     | Portfolio history chart with benchmark comparisons                             |

Route protection is handled in `src/middleware.ts`. New portfolio pages must be covered by `PROTECTED_ROUTES` before they store or display private data.

## Importing an XTB report

Export the account history from XTB for the **full period since each account was opened**, for every account you want included (for example PLN, IKE, USD, EUR). Put all the account `.xlsx` files into one ZIP and upload it on the dashboard. A single `.xlsx` also works, but then the result covers only that account.

- **Full history is required.** Cash balances are reconstructed from every cash operation, and the return (XIRR) needs every deposit and withdrawal. If a report starts after a position was opened, it is flagged as incomplete and the result is shown as partial.
- **Re-importing the same file** reuses the stored import instead of creating a duplicate.
- **History accumulates.** Each import rebuilds daily history and upserts it by date. Days that are no longer in the new report stay in the database, so if you want a clean history, reset the database first (see below).

### How cash operations are counted in the return

- `Deposit`, `Withdrawal` (including XTB card payments and withdrawals to your bank) and `IKE cash transfer in` (an IKE moved in from another institution) are money entering or leaving the portfolio.
- Transfers between your own reported accounts and products (currency conversions, IKE deposits, subaccount transfers) are internal and do not change the result. A transfer whose counterpart is not in the report is treated as money entering or leaving.
- Trades, dividends, taxes, fees, interest and corrections are internal results of investing.
- Any unrecognised operation type is listed as a warning and the return is shown as partial.

## Portfolio history and benchmarks

The **Historia** page shows the portfolio's daily value, reconstructed from the report, historical prices and NBP exchange rates. The return is flow-adjusted (deposits and withdrawals are not counted as gains) and can be compared with S&P 500 (total return), Nasdaq-100, MSCI World, emerging markets, semiconductors and Polish inflation.

Choose a preset range (1M, 6M, 1R, YTD, MAX) or pick a custom start date in the **Od** field. Everything, including benchmarks and inflation, is rebased to the first day shown. This changes only the chart view; the "Stopa zwrotu od początku" XIRR on the dashboard always covers the full history.

Historical prices come from Yahoo Finance. In production they are fetched through the `myportfelik-market-data` worker (`wrangler.market-data.jsonc`); when that worker is not running, for example in local development, prices are fetched directly. Instruments without price data are listed after the import.

## Database

Data lives in a local SQLite database accessed through the Cloudflare D1 binding `DB`. The schema is in `migrations/0001_init.sql`. Numeric values are stored as decimal text to keep full precision.

To delete all imported data and start over, stop the dev server and run:

```bash
npm run db:reset
```

This removes the local database under `.wrangler/state/v3/d1` and recreates the empty schema. It cannot be undone, but everything can be rebuilt by importing your XTB report again.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Create the remote D1 database and put its ID into the `database_id` field of `wrangler.jsonc`:

```bash
npx wrangler d1 create myportfelik
```

2. Apply the schema to the remote database:

```bash
npx wrangler d1 migrations apply DB --remote
```

3. Set the secrets (`OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `SESSION_SECRET`) for the Worker in the Cloudflare dashboard or with `npx wrangler secret put <NAME>`. Do not commit their real values.

4. Build and deploy:

```bash
npm run build
npx wrangler deploy
```

Cloudflare D1 is hosted by Cloudflare. If you want the database to run only on your own machine, use the local setup above and do not deploy.

## CI

GitHub Actions runs lint + build on every push and PR. The build does not need any runtime secrets.

## License

MIT
