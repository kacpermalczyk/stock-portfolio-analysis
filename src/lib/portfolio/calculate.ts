import Decimal from "decimal.js";
import type { ParsedXtbPortfolio, PortfolioCurrency } from "@/lib/xtb/types";
import { classifyOperation } from "./classify";
import { convertMoney } from "./fx";
import { pairTransfers } from "./transfers";
import type {
  ClassifiedOperation,
  FxProvider,
  FxQuote,
  MoneyCashFlow,
  PortfolioDiagnostic,
  TransferPair,
} from "./types";
import { calculateXirr, XirrError } from "./xirr";

export interface PortfolioCalculation {
  baseCurrency: PortfolioCurrency;
  valuationDate: string;
  securitiesValue: Decimal;
  cashValue: Decimal;
  ikeCashValue: Decimal;
  plansCashValue: Decimal;
  marginValue: Decimal;
  totalValue: Decimal;
  depositedCapital: Decimal;
  withdrawnCapital: Decimal;
  netInvestedCapital: Decimal;
  totalProfit: Decimal;
  simpleReturn: Decimal | null;
  xirr: Decimal | null;
  cashFlows: MoneyCashFlow[];
  transferPairs: TransferPair[];
  fxQuotes: FxQuote[];
  diagnostics: PortfolioDiagnostic[];
}

function deduplicateQuotes(quotes: FxQuote[]): FxQuote[] {
  return [...new Map(quotes.map((quote) => [`${quote.currency}:${quote.requestedDate}`, quote])).values()];
}

export function calculateCapitalResult(deposits: Decimal, withdrawals: Decimal, currentValue: Decimal) {
  const netInvestedCapital = deposits.minus(withdrawals);
  const totalProfit = currentValue.minus(netInvestedCapital);
  return {
    netInvestedCapital,
    totalProfit,
    simpleReturn: netInvestedCapital.isPositive() ? totalProfit.dividedBy(netInvestedCapital) : null,
  };
}

export async function calculatePortfolio(
  portfolio: ParsedXtbPortfolio,
  baseCurrency: PortfolioCurrency,
  provider: FxProvider,
): Promise<PortfolioCalculation> {
  const diagnostics: PortfolioDiagnostic[] = [];
  const classified = portfolio.accounts.flatMap((account) =>
    account.cashOperations.map((operation) => classifyOperation(operation, account.currency)),
  );
  for (const item of classified.filter((operation) => operation.classification === "unknown")) {
    diagnostics.push({
      code: "UNKNOWN_OPERATION",
      message: `Nieobsługiwany typ operacji: ${item.operation.type}.`,
      operationId: item.operation.operationId,
    });
  }
  for (const account of portfolio.accounts.filter((item) => !item.isFullHistory)) {
    diagnostics.push({
      code: "INCOMPLETE_HISTORY",
      message: `Raport ${account.sourceName} nie obejmuje pełnej historii rachunku.`,
    });
  }

  const transferResult = await pairTransfers(classified, provider);
  for (const item of transferResult.ambiguous) {
    diagnostics.push({
      code: "AMBIGUOUS_TRANSFER",
      message: "Transfer ma więcej niż jedno możliwe dopasowanie.",
      operationId: item.operation.operationId,
    });
  }

  const quoteAudit: FxQuote[] = [];
  const flowByDate = new Map<string, MoneyCashFlow>();
  let depositedCapital = new Decimal(0);
  let withdrawnCapital = new Decimal(0);
  // Transfers with no counterpart among the reported accounts left (or entered) the portfolio: drawdown or deposit.
  const unpairedTransfers: ClassifiedOperation[] = transferResult.unmatched.map((item) => ({
    ...item,
    classification: "external",
    cashFlowSign: item.operation.amount.isNegative() ? 1 : -1,
  }));
  const externalItems = [
    ...classified.filter((operation) => operation.classification === "external"),
    ...unpairedTransfers,
  ];
  for (const item of externalItems) {
    const date = item.operation.occurredAt.slice(0, 10);
    const signedAmount = item.operation.amount.abs().times(item.cashFlowSign);
    const converted = await convertMoney(signedAmount, item.currency, baseCurrency, date, provider);
    if (converted.amount.isNegative()) depositedCapital = depositedCapital.plus(converted.amount.abs());
    else withdrawnCapital = withdrawnCapital.plus(converted.amount);
    quoteAudit.push(...converted.quotes);
    const existing = flowByDate.get(date);
    flowByDate.set(date, {
      date,
      amount: (existing?.amount ?? new Decimal(0)).plus(converted.amount),
      sourceOperationIds: [...(existing?.sourceOperationIds ?? []), item.operation.operationId],
    });
  }

  let securitiesValue = new Decimal(0);
  let cashValue = new Decimal(0);
  let ikeCashValue = new Decimal(0);
  let plansCashValue = new Decimal(0);
  let marginValue = new Decimal(0);
  let valuationDate = "";
  for (const account of portfolio.accounts) {
    for (const snapshot of account.snapshots) {
      const date = snapshot.valuationAt.slice(0, 10);
      if (date > valuationDate) valuationDate = date;
      const securities = await convertMoney(snapshot.securitiesValue, snapshot.currency, baseCurrency, date, provider);
      const freeFunds = await convertMoney(
        snapshot.reconstructedCash.plus(snapshot.cfdProfit).minus(snapshot.marginValue),
        snapshot.currency,
        baseCurrency,
        date,
        provider,
      );
      const margin = await convertMoney(snapshot.marginValue, snapshot.currency, baseCurrency, date, provider);
      securitiesValue = securitiesValue.plus(securities.amount);
      if (snapshot.product === "My Trades") cashValue = cashValue.plus(freeFunds.amount);
      else if (snapshot.product === "IKE") ikeCashValue = ikeCashValue.plus(freeFunds.amount);
      else plansCashValue = plansCashValue.plus(freeFunds.amount);
      marginValue = marginValue.plus(margin.amount);
      quoteAudit.push(...securities.quotes, ...freeFunds.quotes, ...margin.quotes);
    }
  }
  const totalValue = securitiesValue.plus(cashValue).plus(ikeCashValue).plus(plansCashValue).plus(marginValue);
  const { netInvestedCapital, totalProfit, simpleReturn } = calculateCapitalResult(
    depositedCapital,
    withdrawnCapital,
    totalValue,
  );
  const endingFlow: MoneyCashFlow = { date: valuationDate, amount: totalValue, sourceOperationIds: [] };
  const cashFlows = [...flowByDate.values(), endingFlow].sort((left, right) => left.date.localeCompare(right.date));

  // Computed even when diagnostics exist. Unresolved operations contribute no cash flow, so the UI marks the result as partial.
  let xirr: Decimal | null = null;
  try {
    xirr = calculateXirr(cashFlows);
  } catch (error) {
    if (!(error instanceof XirrError)) throw error;
    diagnostics.push({ code: "XIRR_UNAVAILABLE", message: error.message });
  }

  return {
    baseCurrency,
    valuationDate,
    securitiesValue,
    cashValue,
    ikeCashValue,
    plansCashValue,
    marginValue,
    totalValue,
    depositedCapital,
    withdrawnCapital,
    netInvestedCapital,
    totalProfit,
    simpleReturn,
    xirr,
    cashFlows,
    transferPairs: transferResult.pairs,
    fxQuotes: deduplicateQuotes(quoteAudit),
    diagnostics,
  };
}
