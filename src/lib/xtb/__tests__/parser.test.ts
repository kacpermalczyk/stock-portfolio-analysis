import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "../constants";
import { XtbImportError } from "../errors";
import { parseXtbPortfolio } from "../parser";
import { excelSerialToIso, normalizeIdentifier } from "../normalize";
import { createPortfolioZip, createWorkbook } from "./fixture";

describe("XTB parser", () => {
  it("marks a report as incomplete when positions were opened before its start date", () => {
    const full = parseXtbPortfolio(createWorkbook(), "full.xlsx");
    expect(full.accounts[0].isFullHistory).toBe(true);

    // 46023 is 2026-01-01, after the fixture's positions were opened in 2025.
    const partial = parseXtbPortfolio(createWorkbook({ dateFrom: "46023" }), "partial.xlsx");
    expect(partial.accounts[0].isFullHistory).toBe(false);
  });

  it("parses a single IKE workbook and reconstructs cash", () => {
    const parsed = parseXtbPortfolio(createWorkbook(), "IKE_report.xlsx");
    const account = parsed.accounts[0];

    expect(account.currency).toBe("PLN");
    expect(account.cashOperations).toHaveLength(3);
    expect(account.cashOperations[0].operationId).toBe("1234567890");
    expect(account.openPositions).toHaveLength(1);
    expect(account.openPositions.every((position) => !/^\d+$/.test(position.instrument))).toBe(true);
    expect(account.openPositions[0].instrument).toBe("mWIG40TR");
    expect(account.openPositions[0].volume.toString()).toBe("132.7967");
    expect(account.openPositions[0].value.toFixed(2)).toBe("22211.58");
    expect(account.snapshots[0].currency).toBe("PLN");
    expect(account.snapshots[0].reconstructedCash.toFixed(2)).toBe("2920.00");
    expect(account.snapshots[0].profitValue.toFixed(2)).toBe("4112.91");
    expect(account.closedPositionsCount).toBe(1);
  });

  it("parses a ZIP with an active IKE and empty USD account", () => {
    const parsed = parseXtbPortfolio(createPortfolioZip(), "portfolio.zip");

    expect(parsed.accounts).toHaveLength(2);
    const usd = parsed.accounts.find((account) => account.currency === "USD");
    expect(usd?.cashOperations).toHaveLength(0);
    expect(usd?.openPositions).toHaveLength(0);
    expect(usd?.snapshots[0].securitiesValue.isZero()).toBe(true);
  });

  it("uses CFD profit instead of CFD exposure in portfolio value", () => {
    const parsed = parseXtbPortfolio(createWorkbook({ cfd: true }), "PLN_report.xlsx");

    expect(parsed.accounts[0].openPositions[0].value.toFixed(2)).toBe("4748.10");
    expect(parsed.accounts[0].openPositions[0].netProfit?.toFixed(2)).toBe("-726.94");
    expect(parsed.accounts[0].snapshots[0].securitiesValue.toFixed(2)).toBe("0.00");
    expect(parsed.accounts[0].snapshots[0].cfdProfit.toFixed(2)).toBe("-726.94");
    expect(parsed.accounts[0].snapshots[0].marginValue.toFixed(2)).toBe("2591.70");
  });

  it("rejects path traversal in an outer ZIP", () => {
    const unsafe = zipSync({ "../report.xlsx": createWorkbook() });
    expect(() => parseXtbPortfolio(unsafe, "unsafe.zip")).toThrow(XtbImportError);
    try {
      parseXtbPortfolio(unsafe, "unsafe.zip");
    } catch (error) {
      expect((error as XtbImportError).code).toBe("UNSAFE_ARCHIVE");
    }
  });

  it("rejects unsupported and oversized input", () => {
    expect(() => parseXtbPortfolio(strToU8("not a workbook"), "report.txt")).toThrow(XtbImportError);
    expect(() => parseXtbPortfolio(new Uint8Array(MAX_UPLOAD_BYTES + 1), "large.zip")).toThrow(XtbImportError);
  });
});

describe("XTB normalization", () => {
  it("converts Excel serial dates in UTC without local-time drift", () => {
    expect(excelSerialToIso("45658.5")).toBe("2025-01-01T12:00:00.000Z");
  });

  it("normalizes scientific notation identifiers as text", () => {
    expect(normalizeIdentifier("2.133272838E9")).toBe("2133272838");
    expect(normalizeIdentifier("preserve")).toBe("preserve");
  });
});
