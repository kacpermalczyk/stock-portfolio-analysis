import { strToU8, zipSync } from "fflate";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function columnName(index: number): string {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function worksheet(rows: string[][]): Uint8Array {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => {
            const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
            const numeric = value !== "" && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value);
            return numeric
              ? `<c r="${reference}"><v>${value}</v></c>`
              : `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  return strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
  );
}

export function createWorkbook(options?: {
  account?: string;
  currency?: string;
  empty?: boolean;
  cfd?: boolean;
  /** Excel serial of the report start date; defaults to 2006-01-01. */
  dateFrom?: string;
}): Uint8Array {
  const dateFrom = options?.dateFrom ?? "38718";
  const account = options?.account ?? "10001";
  const currency = options?.currency ?? "PLN";
  const product = options?.cfd ? "My Trades" : currency === "PLN" ? "IKE" : "My Trades";
  const empty = options?.empty ?? false;
  const cashRows = [
    ["Account number", account],
    ["Cash Operations", ""],
    ["Date from (UTC)", dateFrom],
    ["Date to (UTC)", "46235.5"],
    ["Type", "Instrument", "Ticker", "Category", "Time", "Amount", "ID", "Comment", "Product", "Position ID"],
    ...(empty
      ? [["Total"]]
      : [
          ["Deposit", "", "", "", "45658.5", "25000", "1.23456789E9", "", product, ""],
          ["Stock purchase", "mWIG40TR", "ETFBM40TR.PL", "ETF", "45659.5", "-22100", "123456790", "", product, "200"],
          ["Dividend", "mWIG40TR", "ETFBM40TR.PL", "ETF", "45660.5", "20", "123456791", "", product, "200"],
        ]),
  ];
  const openRows = [
    ["Account number", account],
    ["Open Positions", ""],
    ["Data as of report generated", "46235.5"],
    ["Product", "Metric", "Amount", "Currency"],
    [product, "Value", empty ? "0" : options?.cfd ? "4748.10" : "22211.58", product === "IKE" ? "" : currency],
    [product, "Profit", empty ? "0" : options?.cfd ? "-726.94" : "4112.91", product === "IKE" ? "" : currency],
    ["Note", "Summary values and open positions are shown as of the report generation time", "", ""],
    [
      "Product",
      "Instrument/Position",
      "Ticker",
      "Category",
      "Type",
      "Volume",
      "Value",
      "Current price",
      "Open price",
      "Open time (UTC)",
      "Stop Loss",
      "Take Profit",
      "Net Profit %",
      "Net Profit",
      "Gross Profit",
      "Margin",
      "Open Commission",
      "Swap",
      "Rollover",
    ],
    ...(empty
      ? []
      : [
          [
            product,
            options?.cfd ? "CFD position" : "mWIG40TR",
            options?.cfd ? "CFD.TEST" : "ETFBM40TR.PL",
            options?.cfd ? "CFD" : "ETF",
            "",
            options?.cfd ? "1" : "132.7967",
            options?.cfd ? "4748.10" : "22211.58",
            "",
            "136.29",
            "",
            "",
            "",
            options?.cfd ? "-15.31" : "22.72",
            options?.cfd ? "-726.94" : "4112.91",
            options?.cfd ? "-726.94" : "4112.91",
            options?.cfd ? "2591.70" : "0",
          ],
          [product, "2395604932", "", "", "BUY", "10", "5000", "", "100", "45600"],
        ]),
  ];
  const closedRows = [
    ["Account number", account],
    ["Closed Positions", ""],
    ["Date from (UTC)", dateFrom],
    ["Date to (UTC)", "46235.5"],
    [
      "Instrument",
      "Ticker",
      "Category",
      "Type",
      "Volume",
      "Open Price",
      "Open Time (UTC)",
      "Close Price",
      "Close Time (UTC)",
      "Product",
      "Position ID",
    ],
    ...(empty
      ? [["Profit/loss"]]
      : [["Example ETF", "EXAMPLE.PL", "ETF", "BUY", "10", "100", "45600", "110", "45610", product, "300"]]),
  ];

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Closed Positions" sheetId="1" r:id="rId1"/><sheet name="Cash Operations" sheetId="2" r:id="rId2"/><sheet name="Open Positions" sheetId="3" r:id="rId3"/></sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "xl/workbook.xml": strToU8(workbookXml),
    "xl/_rels/workbook.xml.rels": strToU8(relationships),
    "xl/worksheets/sheet1.xml": worksheet(closedRows),
    "xl/worksheets/sheet2.xml": worksheet(cashRows),
    "xl/worksheets/sheet3.xml": worksheet(openRows),
  });
}

export function createPortfolioZip(): Uint8Array {
  return zipSync({
    "PLN/IKE_10001.xlsx": createWorkbook(),
    "USD/USD_10002.xlsx": createWorkbook({ account: "10002", currency: "USD", empty: true }),
  });
}
