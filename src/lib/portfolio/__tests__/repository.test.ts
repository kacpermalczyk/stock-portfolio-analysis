import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import Decimal from "decimal.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedXtbPortfolio } from "@/lib/xtb/types";
import type { PortfolioCalculation } from "../calculate";
import type { HistoryPoint } from "../history";
import { saveOpenPositions, savePortfolioHistory, savePortfolioImport } from "../repository";

// Exercises the real migration and SQL against SQLite, through a minimal D1-compatible adapter.
const MIGRATION = new URL("../../../../migrations/0001_init.sql", import.meta.url);

type Params = (string | number | null)[];

function createTestD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync(MIGRATION, "utf8"));

  class Statement {
    constructor(
      readonly sql: string,
      readonly params: Params = [],
    ) {}
    bind(...values: Params): Statement {
      return new Statement(this.sql, values);
    }
    first<T>(): Promise<T | null> {
      return Promise.resolve((sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null);
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors D1's generic signature
    all<T>(): Promise<{ results: T[] }> {
      return Promise.resolve({ results: sqlite.prepare(this.sql).all(...this.params) as T[] });
    }
    run(): Promise<void> {
      sqlite.prepare(this.sql).run(...this.params);
      return Promise.resolve();
    }
  }

  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        for (const statement of statements) sqlite.prepare(statement.sql).run(...statement.params);
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      return Promise.resolve([]);
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}

function calculation(overrides: Partial<PortfolioCalculation> = {}): PortfolioCalculation {
  const zero = new Decimal(0);
  return {
    baseCurrency: "PLN",
    valuationDate: "2026-01-02",
    securitiesValue: new Decimal(100),
    cashValue: zero,
    ikeCashValue: zero,
    plansCashValue: zero,
    marginValue: zero,
    totalValue: new Decimal(100),
    depositedCapital: new Decimal(80),
    withdrawnCapital: zero,
    netInvestedCapital: new Decimal(80),
    totalProfit: new Decimal(20),
    simpleReturn: new Decimal(0.25),
    xirr: null,
    diagnostics: [],
    fxQuotes: [],
    cashFlows: [],
    ...overrides,
  } as unknown as PortfolioCalculation;
}

const portfolio = {
  accounts: [
    {
      accountNumber: "12345",
      currency: "PLN",
      reportFrom: "2025-01-01",
      reportTo: "2026-01-02",
      cashOperations: [],
      snapshots: [],
      positionLots: [],
      openPositions: [
        {
          ticker: "AAPL.US",
          product: "STOCK",
          instrument: "Apple",
          category: "STK",
          volume: new Decimal(2),
          value: new Decimal(400),
          netProfit: new Decimal(10),
        },
        {
          ticker: null,
          product: "STOCK",
          instrument: "Unknown",
          category: null,
          volume: new Decimal(1),
          value: new Decimal(1),
          netProfit: null,
        },
      ],
    },
  ],
} as unknown as ParsedXtbPortfolio;

function historyPoints(count: number): HistoryPoint[] {
  return Array.from({ length: count }, (_, index): HistoryPoint => {
    const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
    return {
      date,
      totalValue: new Decimal(100 + index),
      netInvestedCapital: new Decimal(80),
      totalProfit: new Decimal(20 + index),
      benchmarkValue: null,
      msciWorldValue: new Decimal(50),
      nasdaq100Value: null,
      emergingMarketsValue: null,
      semiconductorValue: null,
    };
  });
}

describe("portfolio repository (SQLite via D1 adapter)", () => {
  let db: D1Database;
  let sqlite: DatabaseSync;

  beforeEach(() => {
    ({ db, sqlite } = createTestD1());
  });

  const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("saves an import and reuses it for the same fingerprint without duplicating rows", async () => {
    const first = await savePortfolioImport(db, "fp-1", portfolio, calculation());
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(count("portfolio_imports")).toBe(1);
    expect(count("portfolio_accounts")).toBe(1);

    const again = await savePortfolioImport(db, "fp-1", portfolio, calculation({ totalProfit: new Decimal(99) }));
    expect(again).toBe(first);
    expect(count("portfolio_imports")).toBe(1);
    const row = sqlite.prepare("SELECT total_profit FROM portfolio_imports WHERE id = ?").get(first) as {
      total_profit: string;
    };
    expect(row.total_profit).toBe("99");
  });

  it("stores numeric values as exact decimal text", async () => {
    await savePortfolioImport(db, "fp-2", portfolio, calculation({ securitiesValue: new Decimal("0.1") }));
    const row = sqlite.prepare("SELECT securities_value, base_currency FROM portfolio_imports").get() as {
      securities_value: string;
      base_currency: string;
    };
    expect(row).toEqual({ securities_value: "0.1", base_currency: "PLN" });
  });

  it("replaces open positions on re-save and skips rows without a ticker", async () => {
    const importId = await savePortfolioImport(db, "fp-3", portfolio, calculation());
    await saveOpenPositions(db, importId, portfolio);
    await saveOpenPositions(db, importId, portfolio);
    expect(count("portfolio_open_positions")).toBe(1);
    const row = sqlite.prepare("SELECT ticker, report_profit FROM portfolio_open_positions").get();
    expect(row).toEqual({ ticker: "AAPL.US", report_profit: "10" });
  });

  it("aggregates duplicate open positions (same currency, product, ticker) into one row", async () => {
    const duplicated = {
      accounts: [
        {
          ...portfolio.accounts[0],
          openPositions: [
            {
              ticker: "CFD.US",
              product: "CFD",
              instrument: "X",
              category: "CFD",
              volume: new Decimal(1),
              value: new Decimal(10),
              netProfit: new Decimal(2),
            },
            {
              ticker: "CFD.US",
              product: "CFD",
              instrument: "X",
              category: "CFD",
              volume: new Decimal(3),
              value: new Decimal(30),
              netProfit: new Decimal(-5),
            },
          ],
        },
      ],
    } as unknown as ParsedXtbPortfolio;
    const importId = await savePortfolioImport(db, "fp-6", duplicated, calculation());
    await saveOpenPositions(db, importId, duplicated);
    const rows = sqlite.prepare("SELECT volume, report_value, report_profit FROM portfolio_open_positions").all();
    expect(rows).toEqual([{ volume: "4", report_value: "40", report_profit: "-3" }]);
  });

  it("upserts history points by date and currency, across multiple batches", async () => {
    const importId = await savePortfolioImport(db, "fp-4", portfolio, calculation());
    const points = historyPoints(1000);
    await savePortfolioHistory(db, importId, "PLN", points);
    expect(count("portfolio_history_points")).toBe(1000);

    await savePortfolioHistory(db, importId, "PLN", [{ ...points[0], totalValue: new Decimal(555) }]);
    expect(count("portfolio_history_points")).toBe(1000);
    const first = sqlite
      .prepare("SELECT total_value FROM portfolio_history_points WHERE date = ? AND base_currency = 'PLN'")
      .get(points[0].date) as { total_value: string };
    expect(first.total_value).toBe("555");
  });

  it("cascades child rows when an import is deleted", async () => {
    const importId = await savePortfolioImport(db, "fp-5", portfolio, calculation());
    await saveOpenPositions(db, importId, portfolio);
    sqlite.prepare("DELETE FROM portfolio_imports WHERE id = ?").run(importId);
    expect(count("portfolio_accounts")).toBe(0);
    expect(count("portfolio_open_positions")).toBe(0);
  });
});
