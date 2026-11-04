interface PendingRequest {
  url: string;
  init?: RequestInit;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
}

interface BatchResult {
  status: number;
  body: string;
  contentType: string | null;
}

/**
 * Batches price requests through the market-data worker. If that worker is unavailable
 * (for example it is not started in local dev), requests fall back to a direct fetch.
 */
export function createMarketDataFetcher(
  service: Fetcher,
  fallback: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  let pending: PendingRequest[] = [];
  let scheduled = false;

  const flush = async () => {
    scheduled = false;
    const batch = pending;
    pending = [];
    try {
      const response = await service.fetch("https://market-data.internal/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: batch.map((item) => item.url) }),
      });
      if (!response.ok) throw new Error(`Usługa notowań zwróciła błąd ${response.status}.`);
      const results = await response.json<BatchResult[]>();
      if (results.length !== batch.length) throw new Error("Usługa notowań zwróciła niepełną paczkę.");
      results.forEach((result, index) => {
        batch[index].resolve(
          new Response(result.body, {
            status: result.status,
            headers: result.contentType ? { "Content-Type": result.contentType } : undefined,
          }),
        );
      });
    } catch {
      await Promise.all(
        batch.map(async (item) => {
          try {
            item.resolve(await fallback(item.url, item.init));
          } catch (fallbackError) {
            item.reject(fallbackError);
          }
        }),
      );
    }
  };

  return (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    return new Promise<Response>((resolve, reject) => {
      pending.push({ url, init, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => void flush());
      }
    });
  };
}
