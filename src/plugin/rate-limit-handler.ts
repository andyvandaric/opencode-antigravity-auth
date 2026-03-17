/**
 * Rate-limit state tracking, backoff calculation, and account failure tracking.
 *
 * Extracted from plugin.ts to make the retry logic independently testable.
 */

// ── Duration / retry-header parsing ──────────────────────────────

/**
 * Parse a Go-style duration string to milliseconds.
 * Supports compound durations: "1h16m0.667s", "1.5s", "200ms", "5m30s"
 */
export function parseDurationToMs(duration: string): number | null {
  // Handle simple formats first
  const simpleMatch = duration.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (simpleMatch) {
    const value = parseFloat(simpleMatch[1]!);
    const unit = (simpleMatch[2] || "s").toLowerCase();
    switch (unit) {
      case "h": return value * 3600 * 1000;
      case "m": return value * 60 * 1000;
      case "s": return value * 1000;
      case "ms": return value;
      default: return value * 1000;
    }
  }

  // Parse compound Go-style durations: "1h16m0.667s", "5m30s", etc.
  const compoundRegex = /(\d+(?:\.\d+)?)(h|m(?!s)|s|ms)/gi;
  let totalMs = 0;
  let matchFound = false;
  let match: RegExpExecArray | null;

  match = compoundRegex.exec(duration);
  while (match !== null) {
    matchFound = true;
    const value = parseFloat(match[1]!);
    const unit = match[2]!.toLowerCase();
    switch (unit) {
      case "h": totalMs += value * 3600 * 1000; break;
      case "m": totalMs += value * 60 * 1000; break;
      case "s": totalMs += value * 1000; break;
      case "ms": totalMs += value; break;
    }
    match = compoundRegex.exec(duration);
  }

  return matchFound ? totalMs : null;
}

export interface RateLimitBodyInfo {
  retryDelayMs: number | null;
  message?: string;
  quotaResetTime?: string;
  reason?: string;
}

export function extractRateLimitBodyInfo(body: unknown): RateLimitBodyInfo {
  if (!body || typeof body !== "object") return { retryDelayMs: null };

  const error = (body as { error?: unknown }).error;
  const message =
    error && typeof error === "object"
      ? (error as { message?: string }).message
      : undefined;

  const details =
    error && typeof error === "object"
      ? (error as { details?: unknown[] }).details
      : undefined;

  let reason: string | undefined;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue;
      const type = (detail as { "@type"?: string })["@type"];
      if (typeof type === "string" && type.includes("google.rpc.ErrorInfo")) {
        const detailReason = (detail as { reason?: string }).reason;
        if (typeof detailReason === "string") { reason = detailReason; break; }
      }
    }

    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue;
      const type = (detail as { "@type"?: string })["@type"];
      if (typeof type === "string" && type.includes("google.rpc.RetryInfo")) {
        const retryDelay = (detail as { retryDelay?: string }).retryDelay;
        if (typeof retryDelay === "string") {
          const retryDelayMs = parseDurationToMs(retryDelay);
          if (retryDelayMs !== null) return { retryDelayMs, message, reason };
        }
      }
    }

    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue;
      const metadata = (detail as { metadata?: Record<string, string> }).metadata;
      if (metadata && typeof metadata === "object") {
        const quotaResetDelay = metadata.quotaResetDelay;
        const quotaResetTime = metadata.quotaResetTimeStamp;
        if (typeof quotaResetDelay === "string") {
          const quotaResetDelayMs = parseDurationToMs(quotaResetDelay);
          if (quotaResetDelayMs !== null) {
            return { retryDelayMs: quotaResetDelayMs, message, quotaResetTime, reason };
          }
        }
      }
    }
  }

  if (message) {
    const afterMatch = message.match(/reset after\s+([0-9hms.]+)/i);
    const rawDuration = afterMatch?.[1];
    if (rawDuration) {
      const parsed = parseDurationToMs(rawDuration);
      if (parsed !== null) return { retryDelayMs: parsed, message, reason };
    }
  }

  return { retryDelayMs: null, message, reason };
}

export async function extractRetryInfoFromBody(
  response: Response,
): Promise<RateLimitBodyInfo> {
  try {
    const text = await response.clone().text();
    try {
      return extractRateLimitBodyInfo(JSON.parse(text) as unknown);
    } catch {
      return { retryDelayMs: null };
    }
  } catch {
    return { retryDelayMs: null };
  }
}

export function retryAfterMsFromResponse(
  response: Response,
  defaultRetryMs = 60_000,
): number {
  const retryAfterMsHeader = response.headers.get("retry-after-ms");
  if (retryAfterMsHeader) {
    const parsed = Number.parseInt(retryAfterMsHeader, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const parsed = Number.parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed * 1000;
  }

  return defaultRetryMs;
}

export function formatWaitTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

// ── Rate limit state tracking ─────────────────────────────────────

/** Progressive rate limit retry delays */
export const FIRST_RETRY_DELAY_MS = 1000;   // 1s — first 429 quick retry
export const SWITCH_ACCOUNT_DELAY_MS = 5000; // 5s — before switching account

const RATE_LIMIT_DEDUP_WINDOW_MS = 2000;    // concurrent 429s within this window → single event
const RATE_LIMIT_STATE_RESET_MS = 120_000;  // reset consecutive counter after 2 min of no 429s
const RATE_LIMIT_STATE_MAX_ENTRIES = 200;

interface RateLimitState {
  consecutive429: number;
  lastAt: number;
  quotaKey: string;
}

// Key format: `${accountIndex}:${quotaKey}`
const rateLimitStateByAccountQuota = new Map<string, RateLimitState>();

/**
 * Get rate limit backoff with time-window deduplication.
 * Multiple concurrent 429s within RATE_LIMIT_DEDUP_WINDOW_MS are treated as
 * a single event to avoid inflating the exponential backoff counter.
 */
export function getRateLimitBackoff(
  accountIndex: number,
  quotaKey: string,
  serverRetryAfterMs: number | null,
  maxBackoffMs = 60_000,
): { attempt: number; delayMs: number; isDuplicate: boolean } {
  const now = Date.now();
  const stateKey = `${accountIndex}:${quotaKey}`;
  const previous = rateLimitStateByAccountQuota.get(stateKey);

  if (previous && now - previous.lastAt < RATE_LIMIT_DEDUP_WINDOW_MS) {
    const baseDelay = serverRetryAfterMs ?? 1000;
    const backoffDelay = Math.min(
      baseDelay * Math.pow(2, previous.consecutive429 - 1),
      maxBackoffMs,
    );
    return { attempt: previous.consecutive429, delayMs: Math.max(baseDelay, backoffDelay), isDuplicate: true };
  }

  const attempt =
    previous && now - previous.lastAt < RATE_LIMIT_STATE_RESET_MS
      ? previous.consecutive429 + 1
      : 1;

  rateLimitStateByAccountQuota.set(stateKey, { consecutive429: attempt, lastAt: now, quotaKey });

  const baseDelay = serverRetryAfterMs ?? 1000;
  const backoffDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxBackoffMs);
  return { attempt, delayMs: Math.max(baseDelay, backoffDelay), isDuplicate: false };
}

export function resetRateLimitState(accountIndex: number, quotaKey: string): void {
  rateLimitStateByAccountQuota.delete(`${accountIndex}:${quotaKey}`);
}

export function resetAllRateLimitStateForAccount(accountIndex: number): void {
  for (const key of rateLimitStateByAccountQuota.keys()) {
    if (key.startsWith(`${accountIndex}:`)) {
      rateLimitStateByAccountQuota.delete(key);
    }
  }
}

// ── Account failure state tracking ───────────────────────────────

const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_COOLDOWN_MS = 30_000;      // 30s cooldown after max failures
const FAILURE_STATE_RESET_MS = 120_000;  // reset after 2 min of no failures

const accountFailureState = new Map<
  number,
  { consecutiveFailures: number; lastFailureAt: number }
>();

export function trackAccountFailure(accountIndex: number): {
  failures: number;
  shouldCooldown: boolean;
  cooldownMs: number;
} {
  const now = Date.now();
  const previous = accountFailureState.get(accountIndex);

  const failures =
    previous && now - previous.lastFailureAt < FAILURE_STATE_RESET_MS
      ? previous.consecutiveFailures + 1
      : 1;

  accountFailureState.set(accountIndex, { consecutiveFailures: failures, lastFailureAt: now });

  const shouldCooldown = failures >= MAX_CONSECUTIVE_FAILURES;
  return { failures, shouldCooldown, cooldownMs: shouldCooldown ? FAILURE_COOLDOWN_MS : 0 };
}

export function resetAccountFailureState(accountIndex: number): void {
  accountFailureState.delete(accountIndex);
}

// ── Stale-state eviction ──────────────────────────────────────────

/**
 * Evict stale entries to prevent unbounded memory growth.
 * Called at the top of each request retry iteration.
 */
export function cleanupStaleTrackingState(): void {
  const now = Date.now();

  if (rateLimitStateByAccountQuota.size > RATE_LIMIT_STATE_MAX_ENTRIES) {
    for (const [key, state] of rateLimitStateByAccountQuota) {
      if (now - state.lastAt > RATE_LIMIT_STATE_RESET_MS) {
        rateLimitStateByAccountQuota.delete(key);
      }
    }
  }

  for (const [key, state] of accountFailureState) {
    if (now - state.lastFailureAt > FAILURE_STATE_RESET_MS) {
      accountFailureState.delete(key);
    }
  }
}
