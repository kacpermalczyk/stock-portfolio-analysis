import Decimal from "decimal.js";
import type { ParsedXtbPortfolio } from "@/lib/xtb/types";
import { classifyOperation } from "./classify";
import type { PortfolioCalculation } from "./calculate";
import type { HistoryPoint } from "./history";
import { sha256Hex } from "./fingerprint";

type Value = string | number | null;

// D1 limits bound parameters per statement and statements per batch; stay well under both.
const MAX_PARAMS_PER_STATEMENT = 90;
const MAX_STATEMENTS_PER_BATCH = 100;

const HISTORY_COLUMNS = [
  "import_id",
  "date",
  "base_currency",
  "total_value",
  "net_invested_capital",
  "total_profit",
  "benchmark_value",
  "msci_world_value",
  "nasdaq_100_value",
  "emerging_markets_value",
  "semiconductor_value",
];
const HISTORY_UPSERT_SUFFIX = ` ON CONFLICT (date, base_currency) DO UPDATE SET
  import_id = excluded.import_id,
  total_value = excluded.total_value,
  net_invested_capital = excluded.net_invested_capital,
  total_profit = excluded.total_profit,
  benchmark_value = excluded.benchmark_value,
  msci_world_value = excluded.msci_world_value,
  nasdaq_100_value = excluded.nasdaq_100_value,
  emerging_markets_value = excluded.emerging_markets_value,
  semiconductor_value = excluded.semiconductor_value`;
const POSITION_COLUMNS = [
  "import_id",
  "account_currency",
  "product",
  "ticker",
  "instrument",
  "category",
  "volume",
  "report_value",
  "report_profit",
];
const CFD_LOT_COLUMNS = [
  "import_id",
  "account_currency",
  "ticker",
  "position_key",
  "direction",
  "volume",
  "open_price",
];

/** Builds multi-row INSERT statements, each within the bound-parameter limit. */
function insertStatements(
  db: D1Database,
  table: string,
  columns: string[],
  rows: Value[][],
  suffix = "",
): D1PreparedStatement[] {
  const rowsPerStatement = Math.max(1, Math.floor(MAX_PARAMS_PER_STATEMENT / columns.length));
  const placeholder = `(${columns.map(() => "?").join(", ")})`;
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < rows.length; start += rowsPerStatement) {
    const chunk = rows.slice(start, start + rowsPerStatement);
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => placeholder).join(", ")}${suffix}`;
    statements.push(db.prepare(sql).bind(...chunk.flat()));
  }
  return statements;
}

/** Executes statements in order. Each batch is atomic; a failure stops further batches. */
async function runStatements(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let start = 0; start < statements.length; start += MAX_STATEMENTS_PER_BATCH) {
    await db.batch(statements.slice(start, start + MAX_STATEMENTS_PER_BATCH));
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "unknown database error";
}

export async function savePortfolioImport(
  db: D1Database,
  fingerprint: string,
  portfolio: ParsedXtbPortfolio,
  calculation: PortfolioCalculation,
): Promise<string> {
  const capital = [
    calculation.depositedCapital.toString(),
    calculation.withdrawnCapital.toString(),
    calculation.netInvestedCapital.toString(),
    calculation.totalProfit.toString(),
    calculation.simpleReturn?.toString() ?? null,
  ];

  // The same statement (fingerprint + base currency) is idempotent: reuse the stored import and refresh its metrics.
  const existing = await db
    .prepare("SELECT id FROM portfolio_imports WHERE fingerprint = ? AND base_currency = ?")
    .bind(fingerprint, calculation.baseCurrency)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        `UPDATE portfolio_imports SET deposited_capital = ?, withdrawn_capital = ?, net_invested_capital = ?,
           total_profit = ?, simple_return = ? WHERE id = ?`,
      )
      .bind(...capital, existing.id)
      .run();
    return existing.id;
  }

  const importId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO portfolio_imports (id, fingerprint, base_currency, valuation_date, securities_value, cash_value,
           total_value, xirr, diagnostics, fx_quotes, deposited_capital, withdrawn_capital, net_invested_capital,
           total_profit, simple_return)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        importId,
        fingerprint,
        calculation.baseCurrency,
        calculation.valuationDate,
        calculation.securitiesValue.toString(),
        calculation.cashValue.toString(),
        calculation.totalValue.toString(),
        calculation.xirr?.toString() ?? null,
        JSON.stringify(calculation.diagnostics),
        JSON.stringify(
          calculation.fxQuotes.map((quote) => ({
            currency: quote.currency,
            rateToPln: quote.rateToPln.toString(),
            requestedDate: quote.requestedDate,
            effectiveDate: quote.effectiveDate,
            tableNo: quote.tableNo,
            source: quote.source,
          })),
        ),
        ...capital,
      ),
  ];

  for (const account of portfolio.accounts) {
    const accountId = crypto.randomUUID();
    statements.push(
      ...insertStatements(
        db,
        "portfolio_accounts",
        ["id", "import_id", "account_fingerprint", "currency", "report_from", "report_to"],
        [
          [
            accountId,
            importId,
            await sha256Hex(account.accountNumber),
            account.currency,
            account.reportFrom,
            account.reportTo,
          ],
        ],
      ),
    );
    statements.push(
      ...insertStatements(
        db,
        "portfolio_cash_operations",
        [
          "import_id",
          "account_id",
          "operation_key",
          "operation_type",
          "occurred_at",
          "amount",
          "currency",
          "product",
          "classification",
        ],
        account.cashOperations.map((operation) => [
          importId,
          accountId,
          operation.operationId,
          operation.type,
          operation.occurredAt,
          operation.amount.toString(),
          account.currency,
          operation.product,
          classifyOperation(operation, account.currency).classification,
        ]),
      ),
    );
    statements.push(
      ...insertStatements(
        db,
        "portfolio_snapshots",
        ["import_id", "account_id", "product", "currency", "valuation_at", "securities_value", "cash_value"],
        account.snapshots.map((snapshot) => [
          importId,
          accountId,
          snapshot.product,
          snapshot.currency,
          snapshot.valuationAt,
          snapshot.securitiesValue.toString(),
          snapshot.reconstructedCash.toString(),
        ]),
      ),
    );
  }

  try {
    await runStatements(db, statements);
  } catch (error) {
    // Foreign keys cascade, so deleting the parent removes any partially written children.
    await db
      .prepare("DELETE FROM portfolio_imports WHERE id = ?")
      .bind(importId)
      .run()
      .catch(() => undefined);
    throw new Error(`Nie udało się zapisać importu portfela: ${errorDetail(error)}`);
  }
  return importId;
}

export async function savePortfolioHistory(
  db: D1Database,
  importId: string,
  baseCurrency: string,
  points: HistoryPoint[],
): Promise<void> {
  const rows: Value[][] = points.map((point) => [
    importId,
    point.date,
    baseCurrency,
    point.totalValue.toString(),
    point.netInvestedCapital.toString(),
    point.totalProfit.toString(),
    point.benchmarkValue?.toString() ?? null,
    point.msciWorldValue?.toString() ?? null,
    point.nasdaq100Value?.toString() ?? null,
    point.emergingMarketsValue?.toString() ?? null,
    point.semiconductorValue?.toString() ?? null,
  ]);
  try {
    await runStatements(
      db,
      insertStatements(db, "portfolio_history_points", HISTORY_COLUMNS, rows, HISTORY_UPSERT_SUFFIX),
    );
  } catch (error) {
    throw new Error(`Nie udało się zapisać historii portfela: ${errorDetail(error)}`);
  }
}

export async function saveOpenPositions(
  db: D1Database,
  importId: string,
  portfolio: ParsedXtbPortfolio,
): Promise<void> {
  // The table is unique per (account currency, product, ticker). XTB lists each CFD position separately,
  // so aggregate rows with the same key: summed volume and values give the same totals used by live valuation.
  const positionsByKey = new Map<
    string,
    {
      currency: string;
      product: string;
      ticker: string;
      instrument: string;
      category: string | null;
      volume: Decimal;
      value: Decimal;
      profit: Decimal | null;
    }
  >();
  for (const account of portfolio.accounts) {
    for (const position of account.openPositions) {
      if (position.ticker === null) continue;
      const key = `${account.currency}|${position.product}|${position.ticker}`;
      const existing = positionsByKey.get(key);
      if (!existing) {
        positionsByKey.set(key, {
          currency: account.currency,
          product: position.product,
          ticker: position.ticker,
          instrument: position.instrument,
          category: position.category,
          volume: position.volume,
          value: position.value,
          profit: position.netProfit,
        });
        continue;
      }
      existing.volume = existing.volume.plus(position.volume);
      existing.value = existing.value.plus(position.value);
      if (position.netProfit !== null) existing.profit = (existing.profit ?? new Decimal(0)).plus(position.netProfit);
    }
  }
  const positionRows: Value[][] = [...positionsByKey.values()].map((position) => [
    importId,
    position.currency,
    position.product,
    position.ticker,
    position.instrument,
    position.category,
    position.volume.toString(),
    position.value.toString(),
    position.profit?.toString() ?? null,
  ]);
  const cfdRows: Value[][] = portfolio.accounts.flatMap((account) =>
    account.positionLots
      .filter((lot) => lot.closeAt === null && lot.category.trim().toUpperCase() === "CFD")
      .map((lot) => [
        importId,
        account.currency,
        lot.ticker,
        lot.positionId,
        lot.type.trim().toUpperCase().includes("SELL") ? "SELL" : "BUY",
        lot.volume.toString(),
        lot.openPrice.toString(),
      ]),
  );

  try {
    await runStatements(db, [
      db.prepare("DELETE FROM portfolio_open_positions WHERE import_id = ?").bind(importId),
      ...insertStatements(db, "portfolio_open_positions", POSITION_COLUMNS, positionRows),
      db.prepare("DELETE FROM portfolio_open_cfd_lots WHERE import_id = ?").bind(importId),
      ...insertStatements(db, "portfolio_open_cfd_lots", CFD_LOT_COLUMNS, cfdRows),
    ]);
  } catch (error) {
    throw new Error(`Nie udało się zapisać otwartych pozycji: ${errorDetail(error)}`);
  }
}
