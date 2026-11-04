import Decimal from "decimal.js";
import { convertMoney } from "./fx";
import type { ClassifiedOperation, FxProvider, TransferPair } from "./types";

const MAX_TIME_DIFFERENCE_MS = 24 * 60 * 60 * 1000;

function operationKey(operation: ClassifiedOperation): string {
  return `${operation.operation.accountNumber}:${operation.operation.operationId}`;
}

function withinTimeWindow(left: ClassifiedOperation, right: ClassifiedOperation): boolean {
  return (
    Math.abs(Date.parse(left.operation.occurredAt) - Date.parse(right.operation.occurredAt)) <= MAX_TIME_DIFFERENCE_MS
  );
}

/** Prefers the candidate closest in time, then closest in amount. Returns null only on an exact tie. */
function pickBestMatch(
  outgoing: ClassifiedOperation,
  matches: { incoming: ClassifiedOperation; difference: Decimal }[],
): { incoming: ClassifiedOperation; difference: Decimal } | null {
  if (matches.length === 0) return null;
  const ranked = matches
    .map((match) => ({
      ...match,
      timeGap: Math.abs(Date.parse(outgoing.operation.occurredAt) - Date.parse(match.incoming.operation.occurredAt)),
    }))
    .sort((left, right) => left.timeGap - right.timeGap || left.difference.comparedTo(right.difference));
  const [first, second] = ranked;
  if (second && second.timeGap === first.timeGap && second.difference.equals(first.difference)) return null;
  return first;
}

export async function pairTransfers(
  operations: ClassifiedOperation[],
  provider: FxProvider,
): Promise<{ pairs: TransferPair[]; unmatched: ClassifiedOperation[]; ambiguous: ClassifiedOperation[] }> {
  const transfers = operations.filter((item) => item.classification === "transfer");
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  const ambiguous: ClassifiedOperation[] = [];

  const commentGroups = new Map<string, ClassifiedOperation[]>();
  for (const operation of transfers) {
    const comment = operation.operation.comment?.trim();
    if (!comment) continue;
    commentGroups.set(comment, [...(commentGroups.get(comment) ?? []), operation]);
  }
  for (const group of commentGroups.values()) {
    const outgoing = group.filter((item) => item.operation.amount.isNegative());
    const incoming = group.filter((item) => item.operation.amount.isPositive());
    if (outgoing.length !== 1 || incoming.length !== 1 || !withinTimeWindow(outgoing[0], incoming[0])) continue;
    const outgoingPln = await convertMoney(
      outgoing[0].operation.amount.abs(),
      outgoing[0].currency,
      "PLN",
      outgoing[0].operation.occurredAt,
      provider,
    );
    const incomingPln = await convertMoney(
      incoming[0].operation.amount,
      incoming[0].currency,
      "PLN",
      incoming[0].operation.occurredAt,
      provider,
    );
    used.add(operationKey(outgoing[0]));
    used.add(operationKey(incoming[0]));
    pairs.push({
      outgoing: outgoing[0],
      incoming: incoming[0],
      differencePln: outgoingPln.amount.minus(incomingPln.amount).abs(),
    });
  }

  for (const outgoing of transfers.filter((item) => item.operation.amount.isNegative())) {
    if (used.has(operationKey(outgoing))) continue;
    const outgoingPln = await convertMoney(
      outgoing.operation.amount.abs(),
      outgoing.currency,
      "PLN",
      outgoing.operation.occurredAt,
      provider,
    );
    const matches: { incoming: ClassifiedOperation; difference: Decimal }[] = [];
    for (const incoming of transfers.filter((item) => item.operation.amount.isPositive())) {
      if (used.has(operationKey(incoming)) || !withinTimeWindow(outgoing, incoming)) continue;
      const incomingPln = await convertMoney(
        incoming.operation.amount,
        incoming.currency,
        "PLN",
        incoming.operation.occurredAt,
        provider,
      );
      const difference = outgoingPln.amount.minus(incomingPln.amount).abs();
      const tolerance = Decimal.max(new Decimal("0.01"), outgoingPln.amount.times("0.001"));
      if (difference.lte(tolerance)) matches.push({ incoming, difference });
    }
    const best = pickBestMatch(outgoing, matches);
    if (best) {
      used.add(operationKey(outgoing));
      used.add(operationKey(best.incoming));
      pairs.push({ outgoing, incoming: best.incoming, differencePln: best.difference });
    } else if (matches.length > 1) {
      ambiguous.push(outgoing);
    }
  }

  const ambiguousIds = new Set(ambiguous.map((item) => item.operation.operationId));
  const unmatched = transfers.filter(
    (item) => !used.has(operationKey(item)) && !ambiguousIds.has(item.operation.operationId),
  );
  return { pairs, unmatched, ambiguous };
}
