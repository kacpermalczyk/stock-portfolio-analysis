import { describe, expect, it } from "vitest";
import type { XtbCashOperation } from "@/lib/xtb/types";
import { classifyOperation } from "../classify";

function operation(type: string): XtbCashOperation {
  return {
    operationId: "1",
    type,
    occurredAt: "2025-01-02 10:00:00",
    amount: {} as never,
    product: "My Trades",
  } as unknown as XtbCashOperation;
}

describe("classifyOperation", () => {
  it.each(["Fractional shares", "Commission", "Stock purchase"])("treats %s as an internal cash effect", (type) => {
    expect(classifyOperation(operation(type), "EUR").classification).toBe("internal");
  });

  it("treats IKE cash transfer in as an external deposit", () => {
    const result = classifyOperation(operation("IKE cash transfer in"), "PLN");
    expect(result.classification).toBe("external");
    expect(result.cashFlowSign).toBe(-1);
  });

  it("keeps unknown types unclassified so they surface as diagnostics", () => {
    expect(classifyOperation(operation("Something new"), "EUR").classification).toBe("unknown");
  });
});
