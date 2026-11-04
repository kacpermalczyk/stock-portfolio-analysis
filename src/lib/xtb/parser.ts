import Decimal from "decimal.js";
import { CASH_OPERATION_HEADERS, OPEN_POSITION_HEADERS, REQUIRED_SHEETS, SUPPORTED_CURRENCIES } from "./constants";
import { extractWorkbooks } from "./archive";
import { XtbImportError } from "./errors";
import { excelSerialToIso, normalizeIdentifier, optionalDecimal, parseMoney } from "./normalize";
import type {
  ParsedXtbPortfolio,
  PortfolioCurrency,
  XtbAccountReport,
  XtbCashOperation,
  XtbOpenPosition,
  XtbPositionLot,
  XtbProductSnapshot,
} from "./types";
import { XlsxWorkbook, type SheetRow } from "./workbook";

// XTB exports label the Open Positions summary either as "Value"/"Profit" or "Open position value"/"Open position profit".
const VALUE_METRICS = ["Value", "Open position value"];
const PROFIT_METRICS = ["Profit", "Open position profit"];

type HeaderMap = Map<string, string>;

function rowValues(row: SheetRow): string[] {
  return Object.entries(row)
    .filter(([key]) => key !== "__rowNumber")
    .map(([, value]) => value);
}

function findValue(rows: SheetRow[], label: string): string | undefined {
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (value !== label) continue;
      const nextColumn = String.fromCharCode(column.charCodeAt(0) + 1);
      return row[nextColumn];
    }
  }
  return undefined;
}

function findHeader(rows: SheetRow[], required: readonly string[], file: string, sheet: string): number {
  const index = rows.findIndex((row) => required.every((header) => rowValues(row).includes(header)));
  if (index < 0) {
    throw new XtbImportError("MISSING_HEADER", `Arkusz ${sheet} nie ma wymaganych kolumn.`, { file, sheet });
  }
  return index;
}

function headerMap(row: SheetRow): HeaderMap {
  return new Map(
    Object.entries(row)
      .filter(([column]) => column !== "__rowNumber")
      .map(([column, value]) => [value, column]),
  );
}

function get(row: SheetRow, headers: HeaderMap, name: string): string {
  const column = headers.get(name);
  return column ? (row[column] ?? "") : "";
}

function nullable(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function currencyFrom(value: string | undefined, product: string, sourceName: string): PortfolioCurrency {
  const normalized = value?.trim().toUpperCase();
  if (SUPPORTED_CURRENCIES.some((currency) => currency === normalized)) return normalized as PortfolioCurrency;
  if (product === "IKE") return "PLN";
  const filenameCurrency = /(?:^|[\\/_-])(PLN|EUR|USD)(?:[\\/_-]|$)/.exec(sourceName.toUpperCase())?.[1];
  if (filenameCurrency && SUPPORTED_CURRENCIES.some((currency) => currency === filenameCurrency)) {
    return filenameCurrency as PortfolioCurrency;
  }
  throw new XtbImportError("UNSUPPORTED_CURRENCY", "Nie można rozpoznać waluty rachunku.", { file: sourceName });
}

function parseCashOperations(rows: SheetRow[], accountNumber: string, sourceName: string): XtbCashOperation[] {
  const index = findHeader(rows, CASH_OPERATION_HEADERS, sourceName, "Cash Operations");
  const headers = headerMap(rows[index]);
  return rows.slice(index + 1).flatMap((row) => {
    const type = get(row, headers, "Type");
    if (!type || type === "Total") return [];
    const location = { file: sourceName, sheet: "Cash Operations", row: Number(row.__rowNumber) };
    return [
      {
        accountNumber,
        type,
        instrument: nullable(get(row, headers, "Instrument")),
        ticker: nullable(get(row, headers, "Ticker")),
        category: nullable(get(row, headers, "Category")),
        occurredAt: excelSerialToIso(get(row, headers, "Time"), location),
        amount: parseMoney(get(row, headers, "Amount"), location),
        operationId: normalizeIdentifier(get(row, headers, "ID")),
        comment: nullable(get(row, headers, "Comment")),
        product: get(row, headers, "Product"),
        positionId: nullable(normalizeIdentifier(get(row, headers, "Position ID"))),
        sourceRow: Number(row.__rowNumber),
      },
    ];
  });
}

function parseOpenPositions(rows: SheetRow[], accountNumber: string, sourceName: string): XtbOpenPosition[] {
  const index = findHeader(rows, OPEN_POSITION_HEADERS, sourceName, "Open Positions");
  const headers = headerMap(rows[index]);
  return rows.slice(index + 1).flatMap((row) => {
    const product = get(row, headers, "Product");
    const instrument = get(row, headers, "Instrument/Position");
    const value = get(row, headers, "Value");
    if (!product || !instrument || !value || product === "Total") return [];

    const ticker = nullable(get(row, headers, "Ticker"));
    const category = nullable(get(row, headers, "Category"));
    const isAggregateInstrument = !/^\d+(?:\.0+)?$/.test(instrument) && Boolean(ticker ?? category);
    if (!isAggregateInstrument) return [];
    const location = { file: sourceName, sheet: "Open Positions", row: Number(row.__rowNumber) };
    return [
      {
        accountNumber,
        product,
        instrument,
        ticker,
        category,
        volume: parseMoney(get(row, headers, "Volume"), location),
        value: parseMoney(value, location),
        openPrice: optionalDecimal(get(row, headers, "Open price")),
        netProfitPercent: optionalDecimal(get(row, headers, "Net Profit %")),
        netProfit: optionalDecimal(get(row, headers, "Net Profit")),
        margin: optionalDecimal(get(row, headers, "Margin")),
        positionId: null,
        sourceRow: Number(row.__rowNumber),
      },
    ];
  });
}

function parseOpenPositionLots(rows: SheetRow[], accountNumber: string, sourceName: string): XtbPositionLot[] {
  const index = findHeader(rows, OPEN_POSITION_HEADERS, sourceName, "Open Positions");
  const headers = headerMap(rows[index]);
  let parent: { product: string; instrument: string; ticker: string; category: string } | null = null;
  const lots: XtbPositionLot[] = [];
  for (const row of rows.slice(index + 1)) {
    const instrumentOrPosition = get(row, headers, "Instrument/Position");
    if (!instrumentOrPosition) continue;
    if (!/^\d+(?:\.0+)?$/.test(instrumentOrPosition)) {
      const ticker = get(row, headers, "Ticker");
      const category = get(row, headers, "Category");
      const product = get(row, headers, "Product");
      if (ticker && category && product) parent = { product, instrument: instrumentOrPosition, ticker, category };
      continue;
    }
    if (!parent) continue;
    const location = { file: sourceName, sheet: "Open Positions", row: Number(row.__rowNumber) };
    lots.push({
      accountNumber,
      ...parent,
      type: get(row, headers, "Type"),
      volume: parseMoney(get(row, headers, "Volume"), location),
      openPrice: parseMoney(get(row, headers, "Open price"), location),
      openAt: excelSerialToIso(get(row, headers, "Open time (UTC)"), location),
      closePrice: null,
      closeAt: null,
      positionId: normalizeIdentifier(instrumentOrPosition),
      sourceRow: Number(row.__rowNumber),
    });
  }
  return lots;
}

function parseClosedPositionLots(rows: SheetRow[], accountNumber: string, sourceName: string): XtbPositionLot[] {
  const index = findHeader(rows, ["Instrument", "Open Time (UTC)", "Close Time (UTC)"], sourceName, "Closed Positions");
  const headers = headerMap(rows[index]);
  return rows.slice(index + 1).flatMap((row) => {
    const instrument = get(row, headers, "Instrument");
    const ticker = get(row, headers, "Ticker");
    const product = get(row, headers, "Product");
    const positionId = normalizeIdentifier(get(row, headers, "Position ID"));
    if (!instrument || instrument === "Profit/loss" || !ticker || !product || !positionId) return [];
    const location = { file: sourceName, sheet: "Closed Positions", row: Number(row.__rowNumber) };
    return [
      {
        accountNumber,
        product,
        instrument,
        ticker,
        category: get(row, headers, "Category"),
        type: get(row, headers, "Type"),
        volume: parseMoney(get(row, headers, "Volume"), location),
        openPrice: parseMoney(get(row, headers, "Open Price"), location),
        openAt: excelSerialToIso(get(row, headers, "Open Time (UTC)"), location),
        closePrice: parseMoney(get(row, headers, "Close Price"), location),
        closeAt: excelSerialToIso(get(row, headers, "Close Time (UTC)"), location),
        positionId,
        sourceRow: Number(row.__rowNumber),
      },
    ];
  });
}

function parseSnapshots(
  rows: SheetRow[],
  cashOperations: XtbCashOperation[],
  openPositions: XtbOpenPosition[],
  accountNumber: string,
  sourceName: string,
): XtbProductSnapshot[] {
  const summaryIndex = findHeader(rows, ["Product", "Metric", "Amount", "Currency"], sourceName, "Open Positions");
  const headers = headerMap(rows[summaryIndex]);
  const valuationSerial = findValue(rows.slice(0, summaryIndex), "Data as of report generated");
  if (!valuationSerial) {
    throw new XtbImportError("INVALID_CELL", "Brak daty wyceny raportu.", {
      file: sourceName,
      sheet: "Open Positions",
    });
  }
  const valuationAt = excelSerialToIso(valuationSerial, { file: sourceName, sheet: "Open Positions" });
  const cashByProduct = new Map<string, Decimal>();
  for (const operation of cashOperations) {
    cashByProduct.set(
      operation.product,
      (cashByProduct.get(operation.product) ?? new Decimal(0)).plus(operation.amount),
    );
  }
  const profitByProduct = new Map<string, Decimal>();
  for (const row of rows.slice(summaryIndex + 1)) {
    if (!PROFIT_METRICS.includes(get(row, headers, "Metric") ?? "")) continue;
    const product = get(row, headers, "Product");
    if (!product) continue;
    profitByProduct.set(
      product,
      parseMoney(get(row, headers, "Amount"), {
        file: sourceName,
        sheet: "Open Positions",
        row: Number(row.__rowNumber),
      }),
    );
  }

  return rows.slice(summaryIndex + 1).flatMap((row) => {
    if (!VALUE_METRICS.includes(get(row, headers, "Metric") ?? "")) return [];
    const product = get(row, headers, "Product");
    if (!product) return [];
    const currency = currencyFrom(get(row, headers, "Currency"), product, sourceName);
    const reportedValue = parseMoney(get(row, headers, "Amount"), {
      file: sourceName,
      sheet: "Open Positions",
      row: Number(row.__rowNumber),
    });
    const cfdPositions = openPositions.filter(
      (position) => position.product === product && position.category?.trim().toUpperCase() === "CFD",
    );
    let securitiesValue = reportedValue;
    let cfdProfit = new Decimal(0);
    let marginValue = new Decimal(0);
    for (const position of cfdPositions) {
      if (!position.netProfit || !position.margin) {
        throw new XtbImportError("INVALID_CELL", "Pozycja CFD nie zawiera bieżącego wyniku lub depozytu.", {
          file: sourceName,
          sheet: "Open Positions",
          row: position.sourceRow,
        });
      }
      // CFD exposure is not owned capital. Equity consists of non-CFD assets, balance and CFD P/L.
      securitiesValue = securitiesValue.minus(position.value);
      cfdProfit = cfdProfit.plus(position.netProfit);
      marginValue = marginValue.plus(position.margin);
    }
    return [
      {
        accountNumber,
        product,
        currency,
        securitiesValue,
        reconstructedCash: cashByProduct.get(product) ?? new Decimal(0),
        cfdProfit,
        marginValue,
        profitValue: profitByProduct.get(product) ?? new Decimal(0),
        valuationAt,
      },
    ];
  });
}

function parseWorkbook(bytes: Uint8Array, sourceName: string): XtbAccountReport {
  const workbook = new XlsxWorkbook(bytes, sourceName);
  for (const sheet of REQUIRED_SHEETS) {
    if (!workbook.sheetNames().includes(sheet)) {
      throw new XtbImportError("MISSING_SHEET", `Brak arkusza ${sheet}.`, { file: sourceName, sheet });
    }
  }

  const cashRows = workbook.rows("Cash Operations");
  const openRows = workbook.rows("Open Positions");
  const accountNumber = findValue(cashRows, "Account number") ?? findValue(openRows, "Account number");
  if (!accountNumber) {
    throw new XtbImportError("INVALID_CELL", "Brak numeru rachunku w raporcie.", { file: sourceName });
  }
  const reportFromSerial = findValue(cashRows, "Date from (UTC)");
  const reportToSerial = findValue(cashRows, "Date to (UTC)");
  if (!reportFromSerial || !reportToSerial) {
    throw new XtbImportError("INVALID_CELL", "Brak zakresu dat raportu.", {
      file: sourceName,
      sheet: "Cash Operations",
    });
  }
  const reportFrom = excelSerialToIso(reportFromSerial, { file: sourceName, sheet: "Cash Operations" });
  const reportTo = excelSerialToIso(reportToSerial, { file: sourceName, sheet: "Cash Operations" });
  const cashOperations = parseCashOperations(cashRows, accountNumber, sourceName);
  const openPositions = parseOpenPositions(openRows, accountNumber, sourceName);
  const openPositionLots = parseOpenPositionLots(openRows, accountNumber, sourceName);
  const snapshots = parseSnapshots(openRows, cashOperations, openPositions, accountNumber, sourceName);
  const currency = snapshots[0]?.currency ?? currencyFrom(undefined, "", sourceName);
  const firstOperation = cashOperations.reduce<string | null>(
    (earliest, operation) => (!earliest || operation.occurredAt < earliest ? operation.occurredAt : earliest),
    null,
  );
  const isFullHistory = !firstOperation || reportFrom <= firstOperation;

  let closedPositionLots: XtbPositionLot[] = [];
  if (workbook.sheetNames().includes("Closed Positions")) {
    const closedRows = workbook.rows("Closed Positions");
    closedPositionLots = parseClosedPositionLots(closedRows, accountNumber, sourceName);
  }

  return {
    sourceName,
    accountNumber,
    currency,
    reportFrom,
    reportTo,
    isFullHistory,
    cashOperations,
    openPositions,
    positionLots: [...closedPositionLots, ...openPositionLots],
    snapshots,
    closedPositionsCount: closedPositionLots.length,
  };
}

export function parseXtbPortfolio(bytes: Uint8Array, sourceName: string): ParsedXtbPortfolio {
  const entries = extractWorkbooks(bytes, sourceName);
  const accounts = entries.map((entry) => parseWorkbook(entry.bytes, entry.name));
  const accountNumbers = new Set<string>();
  for (const account of accounts) {
    if (accountNumbers.has(account.accountNumber)) {
      throw new XtbImportError("INVALID_WORKBOOK", "Archiwum zawiera ten sam rachunek więcej niż raz.", {
        file: account.sourceName,
      });
    }
    accountNumbers.add(account.accountNumber);
  }
  return { accounts };
}
