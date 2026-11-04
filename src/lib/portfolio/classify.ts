import type { PortfolioCurrency, XtbCashOperation } from "@/lib/xtb/types";
import type { ClassifiedOperation } from "./types";

const INTERNAL_TYPES = new Set([
  "Stock purchase",
  "Stock sell",
  "Dividend",
  "Withholding tax",
  "Free funds interest",
  "Free funds interest tax",
  "SEC fee",
  "IKE tax",
  "Fractional shares",
  "Commission",
  "Close trade",
  "Swap",
  "Tax IFTT",
  "Dividend from foreign company on PL market",
  "Correction",
]);
const TRANSFER_TYPES = new Set(["Transfer", "Subaccount transfer", "IKE deposit", "IKE return partial"]);

export function classifyOperation(operation: XtbCashOperation, currency: PortfolioCurrency): ClassifiedOperation {
  // IKE cash transfer in: money topped up from an outside bank into the IKE account, so it is a deposit.
  if (operation.type === "Deposit" || operation.type === "IKE cash transfer in") {
    return { operation, currency, classification: "external", cashFlowSign: -1 };
  }
  if (operation.type === "Withdrawal") {
    return { operation, currency, classification: "external", cashFlowSign: 1 };
  }
  if (TRANSFER_TYPES.has(operation.type)) {
    return { operation, currency, classification: "transfer", cashFlowSign: 0 };
  }
  if (INTERNAL_TYPES.has(operation.type)) {
    return { operation, currency, classification: "internal", cashFlowSign: 0 };
  }
  return { operation, currency, classification: "unknown", cashFlowSign: 0 };
}
