import { useEffect, useMemo, useRef, useState } from "react";
import type { BusinessDay, IChartApi, MouseEventParams, Time } from "lightweight-charts";

interface Point {
  date: string;
  totalValue: number;
  netInvestedCapital: number;
  totalProfit: number;
  benchmarkValue: number | null;
  msciWorldValue: number | null;
  nasdaq100Value: number | null;
  emergingMarketsValue: number | null;
  semiconductorValue: number | null;
  inflationValue?: number | null;
}
interface PerformancePoint extends Point {
  periodProfit: number;
  periodReturn: number;
}
type Range = "1M" | "6M" | "1R" | "YTD" | "MAX";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function percentage(value: number): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value / 100);
}

function startDate(range: Range, last: string): string {
  const date = new Date(`${last}T00:00:00Z`);
  if (range === "1M") date.setUTCMonth(date.getUTCMonth() - 1);
  if (range === "6M") date.setUTCMonth(date.getUTCMonth() - 6);
  if (range === "1R") date.setUTCFullYear(date.getUTCFullYear() - 1);
  if (range === "YTD") return `${date.getUTCFullYear()}-01-01`;
  return range === "MAX" ? "0000-01-01" : date.toISOString().slice(0, 10);
}

function toBusinessDay(date: string): BusinessDay {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function dateFromTime(time: Time): string {
  if (typeof time === "string") return time;
  if (typeof time === "number") return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

export function calculatePeriodPerformance(visible: Point[]): PerformancePoint[] {
  const first = visible[0];
  let cumulativeFlows = 0;
  return visible.map((point, index) => {
    if (index > 0) {
      const previous = visible[index - 1];
      const flow = point.netInvestedCapital - previous.netInvestedCapital;
      cumulativeFlows += flow;
    }
    const periodProfit = point.totalValue - first.totalValue - cumulativeFlows;
    const workingCapital = first.totalValue + cumulativeFlows;
    return {
      ...point,
      periodProfit,
      periodReturn: workingCapital > 0 ? (periodProfit / workingCapital) * 100 : 0,
    };
  });
}

export default function PortfolioHistoryChart({ points, currency }: { points: Point[]; currency: string }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<Range>("MAX");
  // A custom start date overrides the preset range; everything is rebased to the first visible day.
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showSp500, setShowSp500] = useState(true);
  const [showMsciWorld, setShowMsciWorld] = useState(true);
  const [showNasdaq100, setShowNasdaq100] = useState(false);
  const [showEmergingMarkets, setShowEmergingMarkets] = useState(false);
  const [showSemiconductor, setShowSemiconductor] = useState(false);
  const [showInflation, setShowInflation] = useState(true);
  const visible = useMemo(() => {
    const from = customFrom ?? startDate(range, points.at(-1)?.date ?? "1970-01-01");
    return points.filter((point) => point.date >= from && point.netInvestedCapital !== 0);
  }, [points, range, customFrom]);
  const performance = useMemo(() => calculatePeriodPerformance(visible), [visible]);
  const active = performance.find((point) => point.date === selectedDate) ?? performance.at(-1);
  const activeReturn = active?.periodReturn ?? 0;
  const firstBenchmark = performance.find((point) => point.benchmarkValue !== null)?.benchmarkValue ?? null;
  const activeBenchmarkReturn =
    active?.benchmarkValue != null && firstBenchmark ? (active.benchmarkValue / firstBenchmark - 1) * 100 : null;
  const firstMsciWorld = performance.find((point) => point.msciWorldValue !== null)?.msciWorldValue ?? null;
  const activeMsciWorldReturn =
    active?.msciWorldValue != null && firstMsciWorld ? (active.msciWorldValue / firstMsciWorld - 1) * 100 : null;
  const benchmarkReturn = (
    key: "nasdaq100Value" | "emergingMarketsValue" | "semiconductorValue" | "inflationValue",
  ) => {
    const start = performance.find((point) => point[key] !== null)?.[key];
    const current = active?.[key];
    return current != null && start ? (current / start - 1) * 100 : null;
  };
  const activeNasdaq100Return = benchmarkReturn("nasdaq100Value");
  const activeEmergingMarketsReturn = benchmarkReturn("emergingMarketsValue");
  const activeSemiconductorReturn = benchmarkReturn("semiconductorValue");
  const firstInflation = performance.find((point) => point.inflationValue != null)?.inflationValue ?? null;
  const activeInflation =
    active?.inflationValue != null && firstInflation != null && firstInflation !== 0
      ? (active.inflationValue / firstInflation - 1) * 100
      : null;

  useEffect(() => {
    const element = container.current;
    if (!element || performance.length < 2) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;

    void import("lightweight-charts").then(({ BaselineSeries, ColorType, CrosshairMode, LineSeries, createChart }) => {
      if (disposed) return;
      const chart = createChart(element, {
        width: element.clientWidth,
        height: 430,
        autoSize: false,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#64748b",
          attributionLogo: false,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 13,
        },
        grid: {
          vertLines: { color: "#f1f5f9" },
          horzLines: { color: "#e2e8f0" },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "#cbd5e1", minimumWidth: 72, scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderColor: "#cbd5e1", timeVisible: false, rightOffset: 1, barSpacing: 6 },
        localization: { locale: "pl-PL" },
      });
      chartRef.current = chart;
      const series = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        topLineColor: "#047857",
        topFillColor1: "rgba(4, 120, 87, 0.24)",
        topFillColor2: "rgba(4, 120, 87, 0.03)",
        bottomLineColor: "#b91c1c",
        bottomFillColor1: "rgba(185, 28, 28, 0.03)",
        bottomFillColor2: "rgba(185, 28, 28, 0.22)",
        lineWidth: 3,
        priceLineVisible: true,
        priceLineColor: "#64748b",
        priceLineWidth: 1,
        lastValueVisible: true,
        priceFormat: { type: "custom", formatter: (value: number) => percentage(value), minMove: 0.01 },
      });
      series.setData(
        performance.map((point) => ({
          time: toBusinessDay(point.date),
          value: point.periodReturn,
        })),
      );
      const benchmarkStart = performance.find((point) => point.benchmarkValue !== null)?.benchmarkValue ?? null;
      if (benchmarkStart && showSp500) {
        const benchmark = chart.addSeries(LineSeries, {
          color: "#2563eb",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: "custom", formatter: (value: number) => percentage(value), minMove: 0.01 },
        });
        benchmark.setData(
          performance.flatMap((point) =>
            point.benchmarkValue === null
              ? []
              : [{ time: toBusinessDay(point.date), value: (point.benchmarkValue / benchmarkStart - 1) * 100 }],
          ),
        );
      }
      const msciWorldStart = performance.find((point) => point.msciWorldValue !== null)?.msciWorldValue ?? null;
      if (msciWorldStart && showMsciWorld) {
        const msciWorld = chart.addSeries(LineSeries, {
          color: "#7c3aed",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: "custom", formatter: (value: number) => percentage(value), minMove: 0.01 },
        });
        msciWorld.setData(
          performance.flatMap((point) =>
            point.msciWorldValue === null
              ? []
              : [{ time: toBusinessDay(point.date), value: (point.msciWorldValue / msciWorldStart - 1) * 100 }],
          ),
        );
      }
      const addBenchmark = (key: "nasdaq100Value" | "emergingMarketsValue" | "semiconductorValue", color: string) => {
        const start = performance.find((point) => point[key] !== null)?.[key];
        if (!start) return;
        const benchmark = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: "custom", formatter: (value: number) => percentage(value), minMove: 0.01 },
        });
        benchmark.setData(
          performance.flatMap((point) =>
            point[key] === null ? [] : [{ time: toBusinessDay(point.date), value: (point[key] / start - 1) * 100 }],
          ),
        );
      };
      if (showNasdaq100) addBenchmark("nasdaq100Value", "#0891b2");
      if (showEmergingMarkets) addBenchmark("emergingMarketsValue", "#b45309");
      if (showSemiconductor) addBenchmark("semiconductorValue", "#be185d");
      if (showInflation && firstInflation != null) {
        const inflationSeries = chart.addSeries(LineSeries, {
          color: "#78716c",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: "custom", formatter: (value: number) => percentage(value), minMove: 0.01 },
        });
        inflationSeries.setData(
          performance.flatMap((point) =>
            point.inflationValue == null
              ? []
              : [{ time: toBusinessDay(point.date), value: (point.inflationValue / firstInflation - 1) * 100 }],
          ),
        );
      }
      chart.timeScale().fitContent();
      const move = (event: MouseEventParams) => {
        setSelectedDate(event.time ? dateFromTime(event.time) : null);
      };
      chart.subscribeCrosshairMove(move);
      observer = new ResizeObserver(() => {
        chart.applyOptions({ width: element.clientWidth });
      });
      observer.observe(element);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [
    firstInflation,
    performance,
    showEmergingMarkets,
    showInflation,
    showMsciWorld,
    showNasdaq100,
    showSemiconductor,
    showSp500,
  ]);

  return (
    <section aria-labelledby="history-chart-title">
      <div className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-600">
            Stan na{" "}
            {active
              ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "long" }).format(new Date(`${active.date}T12:00:00Z`))
              : "brak danych"}
          </p>
          <h2
            id="history-chart-title"
            className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 tabular-nums"
          >
            {active ? money(active.totalValue, currency) : "Brak danych"}
          </h2>
          {active && (
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold tabular-nums">
              <p className={activeReturn >= 0 ? "text-emerald-700" : "text-red-700"}>
                Portfel: {money(active.periodProfit, currency)} ({percentage(activeReturn)})
              </p>
              {showSp500 && activeBenchmarkReturn !== null && (
                <p className="text-blue-700">S&amp;P 500 TR: {percentage(activeBenchmarkReturn)}</p>
              )}
              {showMsciWorld && activeMsciWorldReturn !== null && (
                <p className="text-violet-700">MSCI World: {percentage(activeMsciWorldReturn)}</p>
              )}
              {showNasdaq100 && activeNasdaq100Return !== null && (
                <p className="text-cyan-700">Nasdaq 100: {percentage(activeNasdaq100Return)}</p>
              )}
              {showEmergingMarkets && activeEmergingMarketsReturn !== null && (
                <p className="text-amber-700">Emerging Markets: {percentage(activeEmergingMarketsReturn)}</p>
              )}
              {showSemiconductor && activeSemiconductorReturn !== null && (
                <p className="text-pink-700">Semiconductor: {percentage(activeSemiconductorReturn)}</p>
              )}
              {showInflation && activeInflation !== null && (
                <p className="text-stone-700">Inflacja skumulowana: {percentage(activeInflation)}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Zakres wykresu">
          {(["1M", "6M", "1R", "YTD", "MAX"] as Range[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setRange(item);
                setCustomFrom(null);
                setSelectedDate(null);
              }}
              aria-pressed={customFrom === null && range === item}
              className={`min-h-10 rounded-lg px-3 text-sm font-medium ${customFrom === null && range === item ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {item}
            </button>
          ))}
          <label className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-600">
            Od
            <input
              type="date"
              value={customFrom ?? ""}
              min={points[0]?.date}
              max={points.at(-1)?.date}
              onChange={(event) => {
                setCustomFrom(event.target.value || null);
                setSelectedDate(null);
              }}
              className={`min-h-10 rounded-lg border px-2 text-sm tabular-nums ${customFrom ? "border-slate-900 text-slate-950" : "border-slate-300 text-slate-700"}`}
            />
          </label>
        </div>
      </div>

      {visible.length > 1 ? (
        <div className="mt-7">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Prosty wynik za wybrany okres</p>
            <fieldset className="flex flex-wrap gap-4" aria-label="Serie porównawcze">
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium text-blue-800 hover:bg-blue-50">
                <input
                  type="checkbox"
                  checked={showSp500}
                  onChange={(event) => {
                    setShowSp500(event.target.checked);
                  }}
                  className="size-4 accent-blue-600"
                />
                <span className="h-0 w-5 border-t-2 border-blue-600" /> S&amp;P 500 TR
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium text-violet-800 hover:bg-violet-50">
                <input
                  type="checkbox"
                  checked={showMsciWorld}
                  onChange={(event) => {
                    setShowMsciWorld(event.target.checked);
                  }}
                  className="size-4 accent-violet-600"
                />
                <span className="h-0 w-5 border-t-2 border-violet-700" /> MSCI World
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium text-cyan-800 hover:bg-cyan-50">
                <input
                  type="checkbox"
                  checked={showNasdaq100}
                  onChange={(event) => {
                    setShowNasdaq100(event.target.checked);
                  }}
                  className="size-4 accent-cyan-600"
                />
                <span className="h-0 w-5 border-t-2 border-cyan-600" /> Nasdaq 100
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium text-amber-800 hover:bg-amber-50">
                <input
                  type="checkbox"
                  checked={showEmergingMarkets}
                  onChange={(event) => {
                    setShowEmergingMarkets(event.target.checked);
                  }}
                  className="size-4 accent-amber-600"
                />
                <span className="h-0 w-5 border-t-2 border-amber-700" /> Emerging Markets
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium text-pink-800 hover:bg-pink-50">
                <input
                  type="checkbox"
                  checked={showSemiconductor}
                  onChange={(event) => {
                    setShowSemiconductor(event.target.checked);
                  }}
                  className="size-4 accent-pink-600"
                />
                <span className="h-0 w-5 border-t-2 border-pink-700" /> Semiconductor
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
                <input
                  type="checkbox"
                  checked={showInflation}
                  onChange={(event) => {
                    setShowInflation(event.target.checked);
                  }}
                  className="size-4 accent-stone-600"
                />
                <span className="h-0 w-5 border-t-2 border-stone-500" /> Inflacja (GUS)
              </label>
            </fieldset>
          </div>
          <div
            ref={container}
            className="h-[430px] w-full"
            role="img"
            aria-label="Interaktywny wykres procentowego wyniku portfela. Zielony obszar oznacza wynik powyżej zera, czerwony poniżej zera."
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-emerald-700" /> Zysk, powyżej 0%
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-red-700" /> Strata, poniżej 0%
            </span>
            <span className="text-xs">Oś X: data · Oś Y: wynik procentowy</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Wynik uwzględnia zmianę wartości portfela oraz wpłaty i wypłaty wykonane w wybranym okresie. Inflacja to
            skumulowany polski CPI GUS. MSCI World jest reprezentowany przez akumulujący iShares Core MSCI World UCITS
            ETF w USD (IWDA).
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Wykres wykorzystuje{" "}
            <a
              href="https://www.tradingview.com"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-slate-800"
            >
              TradingView Lightweight Charts™
            </a>
            .
          </p>
        </div>
      ) : (
        <p className="py-16 text-center text-slate-600">Za mało danych, aby narysować wykres.</p>
      )}
    </section>
  );
}
