import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortfolioResult } from "../PortfolioResult";
import type { PortfolioImportResult } from "../types";

const result: PortfolioImportResult = {
  importId: "import-1",
  baseCurrency: "PLN",
  valuationDate: "2026-08-01",
  securitiesValue: "22211.58",
  cashValue: "0",
  ikeCashValue: "71.20",
  plansCashValue: "0",
  marginValue: "0",
  totalValue: "22282.78",
  depositedCapital: "20000",
  withdrawnCapital: "0",
  netInvestedCapital: "20000",
  totalProfit: "2282.78",
  simpleReturn: "0.114139",
  xirr: "0.1234",
  diagnostics: [],
  history: { pointsCount: 0, unavailableTickers: [] },
  accounts: [
    {
      currency: "PLN",
      products: [
        {
          name: "IKE",
          currency: "PLN",
          securitiesValue: "22211.58",
          cashValue: "71.20",
          marginValue: "0",
          profitValue: "4112.91",
        },
      ],
    },
  ],
  externalCashFlows: [{ date: "2025-01-01", amount: "-10000" }],
};

describe("PortfolioResult", () => {
  it("renders the portfolio total, rate of return and product split", () => {
    const html = renderToStaticMarkup(<PortfolioResult result={result} />);

    expect(html).toContain("22 282,78");
    expect(html).toContain("12,34");
    expect(html).toContain("IKE");
    expect(html).toContain("Gotówka IKE");
    expect(html).toContain("Rachunek PLN");
  });

  it("shows the XIRR as partial when diagnostics are present but XIRR was computed", () => {
    const html = renderToStaticMarkup(
      <PortfolioResult
        result={{
          ...result,
          xirr: "0.1234",
          diagnostics: [{ code: "UNKNOWN_OPERATION", message: "Nieznana operacja" }],
        }}
      />,
    );

    expect(html).not.toContain("Brak wyniku");
    expect(html).toContain("jest częściowy");
    expect(html).toContain("Nieznana operacja");
  });

  it("shows a blocked result when diagnostics are present", () => {
    const html = renderToStaticMarkup(
      <PortfolioResult
        result={{ ...result, xirr: null, diagnostics: [{ code: "UNKNOWN_OPERATION", message: "Nieznana operacja" }] }}
      />,
    );

    expect(html).toContain("Brak wyniku");
    expect(html).toContain("Nieznana operacja");
  });
});
