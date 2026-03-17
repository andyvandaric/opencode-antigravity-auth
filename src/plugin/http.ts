/**
 * Shared HTTP utilities.
 *
 * Houses helpers used by multiple modules so we don't duplicate them.
 */

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch with an automatic abort-on-timeout.
 *
 * The caller can optionally override the default timeout (10 s).
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const onUpstreamAbort = (): void => {
    controller.abort(upstreamSignal?.reason);
  };
  const timeout = setTimeout(() => {
    controller.abort(new Error("Fetch timeout"));
  }, timeoutMs);

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
    }
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", onUpstreamAbort);
  }
}
