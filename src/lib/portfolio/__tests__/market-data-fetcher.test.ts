import { describe, expect, it, vi } from "vitest";
import { createMarketDataFetcher } from "../market-data-fetcher";

describe("createMarketDataFetcher", () => {
  it("batches requests through the market-data service", async () => {
    const serviceFetch = vi.fn(() =>
      Promise.resolve(
        Response.json([
          { status: 200, contentType: "application/json", body: '{"a":1}' },
          { status: 404, contentType: null, body: "" },
        ]),
      ),
    );
    const service = { fetch: serviceFetch } as unknown as Fetcher;
    const fallback = vi.fn<typeof fetch>();
    const fetcher = createMarketDataFetcher(service, fallback);
    const [first, second] = await Promise.all([fetcher("https://example.test/a"), fetcher("https://example.test/b")]);
    expect(await first.json()).toEqual({ a: 1 });
    expect(second.status).toBe(404);
    expect(serviceFetch).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to direct fetches when the service is unavailable", async () => {
    const service = { fetch: vi.fn(() => Promise.reject(new Error("no local dev session"))) } as unknown as Fetcher;
    const fallback = vi.fn<typeof fetch>((input) => Promise.resolve(new Response(input as string)));
    const fetcher = createMarketDataFetcher(service, fallback);
    const response = await fetcher("https://example.test/a", { headers: { Accept: "application/json" } });
    expect(await response.text()).toBe("https://example.test/a");
    expect(fallback).toHaveBeenCalledWith("https://example.test/a", { headers: { Accept: "application/json" } });
  });
});
