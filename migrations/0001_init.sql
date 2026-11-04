-- MyPortfelik schema (SQLite / Cloudflare D1).
-- Consolidates the former Supabase migrations. Single owner, so no owner_id columns.
-- Numeric values are stored as TEXT decimal strings to preserve precision (decimal.js).

CREATE TABLE portfolio_imports (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  base_currency TEXT NOT NULL CHECK (base_currency IN ('PLN', 'EUR', 'USD')),
  valuation_date TEXT NOT NULL,
  securities_value TEXT NOT NULL,
  cash_value TEXT NOT NULL,
  total_value TEXT NOT NULL,
  xirr TEXT,
  diagnostics TEXT NOT NULL DEFAULT '[]',
  fx_quotes TEXT NOT NULL DEFAULT '[]',
  deposited_capital TEXT,
  withdrawn_capital TEXT,
  net_invested_capital TEXT,
  total_profit TEXT,
  simple_return TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (fingerprint, base_currency)
);

CREATE TABLE portfolio_accounts (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES portfolio_imports(id) ON DELETE CASCADE,
  account_fingerprint TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('PLN', 'EUR', 'USD')),
  report_from TEXT NOT NULL,
  report_to TEXT NOT NULL,
  UNIQUE (import_id, account_fingerprint)
);

CREATE TABLE portfolio_cash_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id TEXT NOT NULL REFERENCES portfolio_imports(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
  operation_key TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('PLN', 'EUR', 'USD')),
  product TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('external', 'internal', 'transfer', 'unknown')),
  UNIQUE (import_id, account_id, operation_key)
);

CREATE TABLE portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id TEXT NOT NULL REFERENCES portfolio_imports(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES portfolio_accounts(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('PLN', 'EUR', 'USD')),
  valuation_at TEXT NOT NULL,
  securities_value TEXT NOT NULL,
  cash_value TEXT NOT NULL,
  UNIQUE (import_id, account_id, product, valuation_at)
);

CREATE TABLE portfolio_history_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id TEXT NOT NULL REFERENCES portfolio_imports(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  base_currency TEXT NOT NULL CHECK (base_currency IN ('PLN', 'EUR', 'USD')),
  total_value TEXT NOT NULL,
  net_invested_capital TEXT NOT NULL,
  total_profit TEXT NOT NULL,
  benchmark_value TEXT,
  msci_world_value TEXT,
  nasdaq_100_value TEXT,
  emerging_markets_value TEXT,
  semiconductor_value TEXT,
  source TEXT NOT NULL DEFAULT 'RECONSTRUCTED_EOD',
  UNIQUE (date, base_currency)
);

CREATE TABLE portfolio_open_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id TEXT NOT NULL REFERENCES portfolio_imports(id) ON DELETE CASCADE,
  account_currency TEXT NOT NULL CHECK (account_currency IN ('PLN', 'EUR', 'USD')),
  product TEXT NOT NULL,
  ticker TEXT NOT NULL,
  instrument TEXT NOT NULL,
  category TEXT,
  volume TEXT NOT NULL,
  report_value TEXT NOT NULL,
  report_profit TEXT,
  UNIQUE (import_id, account_currency, product, ticker)
);

CREATE TABLE portfolio_open_cfd_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id TEXT NOT NULL REFERENCES portfolio_imports(id) ON DELETE CASCADE,
  account_currency TEXT NOT NULL CHECK (account_currency IN ('PLN', 'EUR', 'USD')),
  ticker TEXT NOT NULL,
  position_key TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  volume TEXT NOT NULL,
  open_price TEXT NOT NULL,
  UNIQUE (import_id, position_key)
);

CREATE INDEX portfolio_open_positions_import_idx ON portfolio_open_positions (import_id);
CREATE INDEX portfolio_open_cfd_lots_import_idx ON portfolio_open_cfd_lots (import_id);
