import { CalendarDays, Landmark, ReceiptText, WalletCards } from "lucide-react";
import type { BaseCurrency, PortfolioImportResult } from "./types";

function money(value: string, currency: BaseCurrency): string {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 2 }).format(
    Number(value),
  );
}

function percent(value: string): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function PortfolioResult({ result }: { result: PortfolioImportResult }) {
  const hasBlockedResult = result.xirr === null;
  const isPartialResult = result.diagnostics.length > 0;
  const profitByCurrency = result.accounts
    .flatMap((account) => account.products)
    .reduce<Partial<Record<BaseCurrency, number>>>((totals, product) => {
      totals[product.currency] = (totals[product.currency] ?? 0) + Number(product.profitValue);
      return totals;
    }, {});

  return (
    <section aria-labelledby="portfolio-result-heading" className="mt-10">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-indigo-700 uppercase">Wynik importu</p>
          <h2 id="portfolio-result-heading" className="text-2xl font-semibold tracking-tight text-slate-950">
            Cały portfel
          </h2>
        </div>
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <CalendarDays aria-hidden="true" className="size-4" />
          Stan na{" "}
          {new Intl.DateTimeFormat("pl-PL", { dateStyle: "long" }).format(
            new Date(`${result.valuationDate}T12:00:00Z`),
          )}
        </p>
      </div>

      <div className="grid gap-8 border-b border-slate-200 py-8 md:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)] md:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <WalletCards aria-hidden="true" className="size-4" /> Łączna wartość portfela
          </p>
          <p className="mt-2 text-4xl font-semibold tracking-tight text-slate-950 tabular-nums sm:text-5xl">
            {money(result.totalValue, result.baseCurrency)}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-600">Wynik całkowity</p>
          <p
            className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${Number(result.totalProfit) >= 0 ? "text-emerald-700" : "text-red-700"}`}
          >
            {money(result.totalProfit, result.baseCurrency)}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-600 tabular-nums">
            {result.simpleReturn === null ? "Brak wyniku procentowego" : `${percent(result.simpleReturn)} od początku`}
          </p>
        </div>
      </div>

      <div className="border-b border-slate-200 py-8">
        <h3 className="text-lg font-semibold text-slate-950">Kapitał i stopa zwrotu</h3>
        <div className="mt-5 grid gap-7 md:grid-cols-3">
          <div>
            <p className="text-sm text-slate-600">Wpłacony kapitał netto</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950 tabular-nums">
              {money(result.netInvestedCapital, result.baseCurrency)}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Wpłaty {money(result.depositedCapital, result.baseCurrency)}, wypłaty{" "}
              {money(result.withdrawnCapital, result.baseCurrency)}.
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Stopa zwrotu od początku</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${hasBlockedResult || isPartialResult ? "text-amber-800" : "text-indigo-800"}`}
            >
              {hasBlockedResult ? "Brak wyniku" : percent(result.xirr ?? "0")}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Roczny MWR/XIRR, uwzględnia daty przepływów.</p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Zysk otwartych pozycji w raporcie</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(profitByCurrency).map(([currency, value]) => (
                <span key={currency} className="text-xl font-semibold text-slate-900 tabular-nums">
                  {money(String(value), currency as BaseCurrency)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isPartialResult && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          <p className="font-semibold">
            {hasBlockedResult
              ? "Wynik stopy zwrotu został wstrzymany"
              : "Wynik stopy zwrotu jest częściowy. Poniższe pozycje nie są w nim uwzględnione"}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {result.diagnostics.map((item, index) => (
              <li key={`${item.code}-${item.operationId ?? index}`}>{item.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-8 border-b border-slate-200 py-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <Landmark aria-hidden="true" className="size-4" /> Instrumenty
          </h3>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 tabular-nums">
            {money(result.securitiesValue, result.baseCurrency)}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Bieżąca wartość akcji i ETF-ów. Ekspozycja CFD nie jest liczona jako posiadany kapitał.
          </p>
        </div>

        <dl className="divide-y divide-slate-200 text-sm">
          <div className="flex items-center justify-between gap-6 py-3 first:pt-0">
            <dt className="flex items-center gap-2 text-slate-600">
              <ReceiptText aria-hidden="true" className="size-4" /> Wolne środki My Trades
            </dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {money(result.cashValue, result.baseCurrency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-6 py-3">
            <dt className="text-slate-600">Gotówka IKE</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {money(result.ikeCashValue, result.baseCurrency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-6 py-3">
            <dt className="text-slate-600">Gotówka w planach</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {money(result.plansCashValue, result.baseCurrency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-6 py-3 last:pb-0">
            <dt className="text-slate-600">Depozyt zabezpieczający</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {money(result.marginValue, result.baseCurrency)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Rachunki i plany</h3>
          <p className="mt-1 text-sm text-slate-600">Wartości w oryginalnej walucie każdego rachunku.</p>
        </div>
        <div className="divide-y divide-slate-200">
          {result.accounts.flatMap((account, accountIndex) =>
            account.products.map((product, productIndex) => (
              <div
                key={`${account.currency}-${product.name}-${accountIndex}-${productIndex}`}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
              >
                <div>
                  <p className="font-medium text-slate-900">{product.name}</p>
                  <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    Rachunek {account.currency}
                  </p>
                </div>
                <p className="text-sm text-slate-700 tabular-nums">
                  Instrumenty: {money(product.securitiesValue, product.currency)}
                </p>
                <div className="text-sm text-slate-700 tabular-nums">
                  <p>
                    {product.name === "My Trades" ? "Wolne środki" : "Gotówka"}:{" "}
                    {money(product.cashValue, product.currency)}
                  </p>
                  <p>Zysk: {money(product.profitValue, product.currency)}</p>
                  {Number(product.marginValue) !== 0 && <p>Depozyt: {money(product.marginValue, product.currency)}</p>}
                </div>
              </div>
            )),
          )}
        </div>
      </div>

      <details className="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm">
        <summary className="cursor-pointer font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600">
          Jak policzono wynik
        </summary>
        <div className="mt-4 max-w-3xl space-y-2 text-slate-600">
          <p>Stopa zwrotu jest annualizowanym MWR/XIRR. Wpłaty i wypłaty uwzględniają datę oraz kwotę.</p>
          <p>
            Transfery pomiędzy własnymi rachunkami zostały wyłączone. Waluty przeliczono średnim kursem NBP z dnia
            operacji lub ostatniego wcześniejszego notowania.
          </p>
          <p>Liczba przepływów zewnętrznych użytych w audycie: {result.externalCashFlows.length}.</p>
        </div>
      </details>

      {result.history.pointsCount > 0 && (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-slate-950">Historia portfela jest gotowa</p>
            <p className="mt-1 text-sm text-slate-600">
              Zapisano {result.history.pointsCount} dziennych punktów wyceny.
            </p>
          </div>
          <a
            href="/history"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-700 px-5 text-sm font-semibold text-white hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700"
          >
            Zobacz wykres
          </a>
        </div>
      )}
      {result.history.unavailableTickers.length > 0 && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-950"
        >
          <p className="font-semibold">Część starszej historii jest przybliżona</p>
          <p className="mt-1 leading-6">
            Źródło notowań nie zwróciło cen dla: {result.history.unavailableTickers.join(", ")}. W okresach, w których
            te instrumenty były w portfelu, użyto ceny zakupu zamiast zerowej wartości. Ostatni punkt pozostaje zgodny z
            raportem XTB.
          </p>
        </div>
      )}
    </section>
  );
}
