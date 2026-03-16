/**
 * Warmup session tracker.
 *
 * Tracks which sessions have had a thinking warmup attempted/succeeded so we
 * don't retry more than MAX_WARMUP_RETRIES times per session.
 */

const MAX_WARMUP_SESSIONS = 1000;
export const MAX_WARMUP_RETRIES = 2;

const warmupAttemptedSessionIds = new Set<string>();
const warmupSucceededSessionIds = new Set<string>();

/**
 * Returns `true` if a warmup attempt should be made for this session.
 * Automatically evicts the oldest entry when the set is full.
 */
export function trackWarmupAttempt(sessionId: string): boolean {
  if (warmupSucceededSessionIds.has(sessionId)) {
    return false;
  }
  if (warmupAttemptedSessionIds.size >= MAX_WARMUP_SESSIONS) {
    const first = warmupAttemptedSessionIds.values().next().value;
    if (first) {
      warmupAttemptedSessionIds.delete(first);
      warmupSucceededSessionIds.delete(first);
    }
  }
  const attempts = getWarmupAttemptCount(sessionId);
  if (attempts >= MAX_WARMUP_RETRIES) {
    return false;
  }
  warmupAttemptedSessionIds.add(sessionId);
  return true;
}

export function getWarmupAttemptCount(sessionId: string): number {
  return warmupAttemptedSessionIds.has(sessionId) ? 1 : 0;
}

export function markWarmupSuccess(sessionId: string): void {
  warmupSucceededSessionIds.add(sessionId);
  if (warmupSucceededSessionIds.size >= MAX_WARMUP_SESSIONS) {
    const first = warmupSucceededSessionIds.values().next().value;
    if (first) warmupSucceededSessionIds.delete(first);
  }
}

export function clearWarmupAttempt(sessionId: string): void {
  warmupAttemptedSessionIds.delete(sessionId);
}
