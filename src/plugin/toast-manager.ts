/**
 * Toast deduplication manager.
 *
 * Prevents rate-limit toast spam by tracking when each message was last
 * shown and suppressing repeats within a cooldown window.
 */

const RATE_LIMIT_TOAST_COOLDOWN_MS = 5000;
const MAX_TOAST_COOLDOWN_ENTRIES = 100;

// Module-level map persists across requests
const rateLimitToastCooldowns = new Map<string, number>();

// "All accounts blocked" flags — reset when an account becomes available
let softQuotaToastShown = false;
let rateLimitToastShown = false;

function cleanupToastCooldowns(): void {
  if (rateLimitToastCooldowns.size > MAX_TOAST_COOLDOWN_ENTRIES) {
    const now = Date.now();
    for (const [key, time] of rateLimitToastCooldowns) {
      if (now - time > RATE_LIMIT_TOAST_COOLDOWN_MS * 2) {
        rateLimitToastCooldowns.delete(key);
      }
    }
  }
}

/**
 * Returns `true` if the toast should be displayed (not within cooldown).
 * Normalises digit runs in the message so "429 after 3s" and "429 after 7s"
 * share the same cooldown bucket.
 */
export function shouldShowRateLimitToast(message: string): boolean {
  cleanupToastCooldowns();
  const toastKey = message.replace(/\d+/g, "X");
  const lastShown = rateLimitToastCooldowns.get(toastKey) ?? 0;
  const now = Date.now();
  if (now - lastShown < RATE_LIMIT_TOAST_COOLDOWN_MS) {
    return false;
  }
  rateLimitToastCooldowns.set(toastKey, now);
  return true;
}

/** Reset the "all accounts blocked" one-time toast flags. */
export function resetAllAccountsBlockedToasts(): void {
  softQuotaToastShown = false;
  rateLimitToastShown = false;
}

export function getSoftQuotaToastShown(): boolean {
  return softQuotaToastShown;
}

export function setSoftQuotaToastShown(value: boolean): void {
  softQuotaToastShown = value;
}

export function getRateLimitToastShown(): boolean {
  return rateLimitToastShown;
}

export function setRateLimitToastShown(value: boolean): void {
  rateLimitToastShown = value;
}
