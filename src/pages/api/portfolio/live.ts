import Decimal from "decimal.js";
import type { APIRoute } from "astro";
import { convertMoney } from "@/lib/portfolio/fx";
import { NbpClient } from "@/lib/portfolio/nbp-client";
import { YahooPriceClient } from "@/lib/portfolio/yahoo-client";
import { getDb } from "@/lib/db";
import type { PortfolioCurrency } from "@/lib/xtb/types";

function previousDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

type Row = Record<string, string | number | null>;

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) return Response.json({ error: "Brak dostępu." }, { status: 403 });
  const db = getDb();

  let latest: Row | null;
  let positions: Row[];
  let cfdLots: Row[];
  try {
    latest = await db
      .prepare(
        "SELECT id, base_currency, valuation_date, total_value FROM portfolio_imports ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .first<Row>();
  } catch {
    return Response.json({ error: "Nie udało się odczytać ostatniego importu." }, { status: 500 });
  }
  if (!latest?.valuation_date) return Response.json({ available: false });
  const latestImport = latest;

  try {
    positions = (
      await db
        .prepare(
          "SELECT ticker, category, volume, report_value, report_profit, account_currency FROM portfolio_open_positions WHERE import_id = ?",
        )
        .bind(latestImport.id)
        .all<Row>()
    ).results;
  } catch {
    return Response.json({ error: "Nie udało się odczytać pozycji." }, { status: 500 });
  }
  if (positions.length === 0) {
    return Response.json({
      available: false,
      requiresImport: true,
      valuationDate: String(latestImport.valuation_date),
    });
  }
  try {
    cfdLots = (
      await db
        .prepare(
          "SELECT ticker, direction, volume, open_price, account_currency FROM portfolio_open_cfd_lots WHERE import_id = ?",
        )
        .bind(latestImport.id)
        .all<Row>()
    ).results;
  } catch {
    return Response.json({ error: "Nie udało się odczytać pozycji CFD." }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const priceClient = new YahooPriceClient();
  const tickers = [...new Set(positions.map((position) => String(position.ticker)))];
  const fetched = await Promise.allSettled(
    tickers.map((ticker) => priceClient.getDaily(ticker, previousDate(10), today)),
  );
  const prices = new Map<string, { currency: string; latest: { date: string; close: Decimal } }>();
  for (const result of fetched) {
    if (result.status !== "fulfilled") continue;
    const latestPrice = result.value.prices.at(-1);
    if (latestPrice) prices.set(result.value.ticker, { currency: result.value.currency, latest: latestPrice });
  }
  const unavailableTickers: string[] = [];
  const nbp = new NbpClient();
  const baseCurrency = latestImport.base_currency as PortfolioCurrency;
  let delta = new Decimal(0);
  let marketDate = today;
  for (const position of positions) {
    if (String(position.category).trim().toUpperCase() === "CFD") continue;
    const ticker = String(position.ticker);
    const price = prices.get(ticker);
    if (!price || !["PLN", "EUR", "USD"].includes(price.currency)) {
      unavailableTickers.push(ticker);
      continue;
    }
    if (price.latest.date < marketDate) marketDate = price.latest.date;
    const liveValue = price.latest.close.times(new Decimal(String(position.volume)));
    const liveConverted = await convertMoney(
      liveValue,
      price.currency as PortfolioCurrency,
      baseCurrency,
      price.latest.date,
      nbp,
    );
    const reportConverted = await convertMoney(
      new Decimal(String(position.report_value)),
      position.account_currency as PortfolioCurrency,
      baseCurrency,
      String(latestImport.valuation_date),
      nbp,
    );
    delta = delta.plus(liveConverted.amount.minus(reportConverted.amount));
  }
  for (const position of positions.filter((item) => String(item.category).trim().toUpperCase() === "CFD")) {
    const ticker = String(position.ticker);
    const price = prices.get(ticker);
    const lots = cfdLots.filter((lot) => String(lot.ticker) === ticker);
    if (!price || !["PLN", "EUR", "USD"].includes(price.currency) || lots.length === 0) {
      unavailableTickers.push(ticker);
      continue;
    }
    let liveProfit = new Decimal(0);
    for (const lot of lots) {
      const direction = String(lot.direction) === "SELL" ? -1 : 1;
      liveProfit = liveProfit.plus(
        price.latest.close
          .minus(new Decimal(String(lot.open_price)))
          .times(new Decimal(String(lot.volume)))
          .times(direction),
      );
    }
    const liveConverted = await convertMoney(
      liveProfit,
      price.currency as PortfolioCurrency,
      baseCurrency,
      price.latest.date,
      nbp,
    );
    const reportConverted = await convertMoney(
      new Decimal(String(position.report_profit ?? 0)),
      position.account_currency as PortfolioCurrency,
      baseCurrency,
      String(latestImport.valuation_date),
      nbp,
    );
    delta = delta.plus(liveConverted.amount.minus(reportConverted.amount));
  }
  const totalValue = new Decimal(String(latestImport.total_value)).plus(delta);
  return Response.json({
    available: true,
    baseCurrency,
    totalValue: totalValue.toString(),
    changeSinceImport: delta.toString(),
    reportValue: String(latestImport.total_value),
    reportDate: String(latestImport.valuation_date),
    marketDate,
    unavailableTickers: [...new Set(unavailableTickers)],
    cfdLive: cfdLots.length > 0,
  });
};
