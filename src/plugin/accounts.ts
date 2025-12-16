import { formatRefreshParts, parseRefreshParts } from "./auth";
import { loadAccounts, saveAccounts, type AccountStorage } from "./storage";
import type { OAuthAuthDetails, RefreshParts } from "./types";

export interface ManagedAccount {
  index: number;
  email?: string;
  addedAt: number;
  lastUsed: number;
  parts: RefreshParts;
  access?: string;
  expires?: number;
  isRateLimited: boolean;
  rateLimitResetTime: number;
}

function nowMs(): number {
  return Date.now();
}

function clampNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value < 0 ? 0 : Math.floor(value);
}

/**
 * In-memory multi-account manager for round-robin routing.
 *
 * Source of truth for the pool is `antigravity-accounts.json`.
 */
export class AccountManager {
  private accounts: ManagedAccount[] = [];
  private cursor = 0;

  static async loadFromDisk(authFallback?: OAuthAuthDetails): Promise<AccountManager> {
    const stored = await loadAccounts();
    return new AccountManager(authFallback, stored);
  }

  constructor(authFallback?: OAuthAuthDetails, stored?: AccountStorage | null) {
    const authParts = authFallback ? parseRefreshParts(authFallback.refresh) : null;

    if (stored && stored.accounts.length === 0) {
      this.accounts = [];
      this.cursor = 0;
      return;
    }

    if (stored && stored.accounts.length > 0) {
      const baseNow = nowMs();
      this.accounts = stored.accounts
        .map((acc, index): ManagedAccount | null => {
          if (!acc.refreshToken || typeof acc.refreshToken !== "string") {
            return null;
          }
          const matchesFallback = !!(
            authFallback &&
            authParts &&
            authParts.refreshToken &&
            acc.refreshToken === authParts.refreshToken
          );

          return {
            index,
            email: acc.email,
            addedAt: clampNonNegativeInt(acc.addedAt, baseNow),
            lastUsed: clampNonNegativeInt(acc.lastUsed, 0),
            parts: {
              refreshToken: acc.refreshToken,
              projectId: acc.projectId,
              managedProjectId: acc.managedProjectId,
            },
            access: matchesFallback ? authFallback?.access : undefined,
            expires: matchesFallback ? authFallback?.expires : undefined,
            isRateLimited: !!acc.isRateLimited,
            rateLimitResetTime: clampNonNegativeInt(acc.rateLimitResetTime, 0),
          };
        })
        .filter((a): a is ManagedAccount => a !== null);

      this.cursor = clampNonNegativeInt(stored.activeIndex, 0);
      if (this.accounts.length > 0) {
        this.cursor = this.cursor % this.accounts.length;
      }

      return;
    }

    if (authFallback) {
      const parts = parseRefreshParts(authFallback.refresh);
      if (parts.refreshToken) {
        const now = nowMs();
        this.accounts = [
          {
            index: 0,
            email: undefined,
            addedAt: now,
            lastUsed: 0,
            parts,
            access: authFallback.access,
            expires: authFallback.expires,
            isRateLimited: false,
            rateLimitResetTime: 0,
          },
        ];
        this.cursor = 0;
      }
    }
  }

  getAccountCount(): number {
    return this.accounts.length;
  }

  getAccountsSnapshot(): ManagedAccount[] {
    return this.accounts.map((a) => ({ ...a, parts: { ...a.parts } }));
  }

  /**
   * Picks the next available account (round-robin), skipping accounts in cooldown.
   */
  pickNext(): ManagedAccount | null {
    const total = this.accounts.length;
    if (total === 0) {
      return null;
    }

    const now = nowMs();

    // Clear expired cooldowns.
    for (const acc of this.accounts) {
      if (acc.isRateLimited && acc.rateLimitResetTime > 0 && now > acc.rateLimitResetTime) {
        acc.isRateLimited = false;
        acc.rateLimitResetTime = 0;
      }
    }

    for (let i = 0; i < total; i++) {
      const idx = (this.cursor + i) % total;
      const candidate = this.accounts[idx];
      if (!candidate) {
        continue;
      }
      if (candidate.isRateLimited) {
        continue;
      }
      this.cursor = (idx + 1) % total;
      candidate.lastUsed = now;
      return candidate;
    }

    return null;
  }

  markRateLimited(account: ManagedAccount, retryAfterMs: number): void {
    const duration = clampNonNegativeInt(retryAfterMs, 0);
    account.isRateLimited = true;
    account.rateLimitResetTime = nowMs() + duration;
  }

  removeAccount(account: ManagedAccount): boolean {
    const idx = this.accounts.indexOf(account);
    if (idx < 0) {
      return false;
    }

    this.accounts.splice(idx, 1);
    this.accounts.forEach((acc, index) => {
      acc.index = index;
    });

    if (this.accounts.length === 0) {
      this.cursor = 0;
      return true;
    }

    if (this.cursor > idx) {
      this.cursor -= 1;
    }
    this.cursor = this.cursor % this.accounts.length;

    return true;
  }

  updateFromAuth(account: ManagedAccount, auth: OAuthAuthDetails): void {
    const parts = parseRefreshParts(auth.refresh);
    account.parts = parts;
    account.access = auth.access;
    account.expires = auth.expires;
  }

  toAuthDetails(account: ManagedAccount): OAuthAuthDetails {
    return {
      type: "oauth",
      refresh: formatRefreshParts(account.parts),
      access: account.access,
      expires: account.expires,
    };
  }

  getMinWaitTimeMs(): number {
    const now = nowMs();
    const available = this.accounts.some(
      (a) => !a.isRateLimited || (a.rateLimitResetTime > 0 && now > a.rateLimitResetTime),
    );
    if (available) {
      return 0;
    }

    const waits = this.accounts
      .filter((a) => a.isRateLimited && a.rateLimitResetTime > 0)
      .map((a) => Math.max(0, a.rateLimitResetTime - now));

    return waits.length > 0 ? Math.min(...waits) : 0;
  }

  async saveToDisk(): Promise<void> {
    const storage: AccountStorage = {
      version: 1,
      accounts: this.accounts.map((a) => ({
        email: a.email,
        refreshToken: a.parts.refreshToken,
        projectId: a.parts.projectId,
        managedProjectId: a.parts.managedProjectId,
        addedAt: a.addedAt,
        lastUsed: a.lastUsed,
        isRateLimited: a.isRateLimited,
        rateLimitResetTime: a.rateLimitResetTime,
      })),
      activeIndex: this.cursor,
    };

    await saveAccounts(storage);
  }
}
