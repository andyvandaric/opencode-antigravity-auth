import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountManager } from "./accounts";
import type { AccountStorage } from "./storage";
import type { OAuthAuthDetails } from "./types";

describe("AccountManager", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("treats on-disk storage as source of truth, even when empty", () => {
    const fallback: OAuthAuthDetails = {
      type: "oauth",
      refresh: "r1|p1",
      access: "access",
      expires: 123,
    };

    const stored: AccountStorage = {
      version: 1,
      accounts: [],
      activeIndex: 0,
    };

    const manager = new AccountManager(fallback, stored);
    expect(manager.getAccountCount()).toBe(0);
  });

  it("rotates accounts round-robin", () => {
    const stored: AccountStorage = {
      version: 1,
      accounts: [
        { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
      ],
      activeIndex: 0,
    };

    const manager = new AccountManager(undefined, stored);

    expect(manager.pickNext()?.parts.refreshToken).toBe("r1");
    expect(manager.pickNext()?.parts.refreshToken).toBe("r2");
    expect(manager.pickNext()?.parts.refreshToken).toBe("r1");
  });

  it("attaches fallback access tokens only to the matching stored account", () => {
    const fallback: OAuthAuthDetails = {
      type: "oauth",
      refresh: "r2|p2",
      access: "access-2",
      expires: 123,
    };

    const stored: AccountStorage = {
      version: 1,
      accounts: [
        { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
      ],
      activeIndex: 0,
    };

    const manager = new AccountManager(fallback, stored);
    const snapshot = manager.getAccountsSnapshot();

    expect(snapshot[0]?.access).toBeUndefined();
    expect(snapshot[0]?.expires).toBeUndefined();
    expect(snapshot[1]?.access).toBe("access-2");
    expect(snapshot[1]?.expires).toBe(123);
  });

  it("does not attach fallback access tokens to an unrelated account", () => {
    const fallback: OAuthAuthDetails = {
      type: "oauth",
      refresh: "r3|p3",
      access: "access-3",
      expires: 456,
    };

    const stored: AccountStorage = {
      version: 1,
      accounts: [
        { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
      ],
      activeIndex: 0,
    };

    const manager = new AccountManager(fallback, stored);
    const snapshot = manager.getAccountsSnapshot();

    expect(snapshot.some((account) => !!account.access)).toBe(false);
    expect(snapshot.some((account) => typeof account.expires === "number")).toBe(false);
  });

  it("skips rate-limited accounts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const stored: AccountStorage = {
      version: 1,
      accounts: [
        { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
      ],
      activeIndex: 0,
    };

    const manager = new AccountManager(undefined, stored);

    const first = manager.pickNext();
    expect(first?.parts.refreshToken).toBe("r1");

    manager.markRateLimited(first!, 60_000);

    const next = manager.pickNext();
    expect(next?.parts.refreshToken).toBe("r2");
  });

  it("returns minimum wait time and re-enables after cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const stored: AccountStorage = {
      version: 1,
      accounts: [
        { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
      ],
      activeIndex: 0,
    };

    const manager = new AccountManager(undefined, stored);

    const acc1 = manager.pickNext()!;
    const acc2 = manager.pickNext()!;

    manager.markRateLimited(acc1, 10_000);
    manager.markRateLimited(acc2, 5_000);

    expect(manager.pickNext()).toBeNull();
    expect(manager.getMinWaitTimeMs()).toBe(5_000);

    vi.setSystemTime(new Date(6_000));

    const available = manager.pickNext();
    expect(available?.parts.refreshToken).toBe("r2");
  });

  it("removes an account and keeps cursor consistent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const stored: AccountStorage = {
      version: 1,
      accounts: [
        { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
        { refreshToken: "r3", projectId: "p3", addedAt: 1, lastUsed: 0 },
      ],
      activeIndex: 1,
    };

    const manager = new AccountManager(undefined, stored);

    const picked = manager.pickNext();
    expect(picked?.parts.refreshToken).toBe("r2");

    manager.removeAccount(picked!);
    expect(manager.getAccountCount()).toBe(2);

    const next = manager.pickNext();
    expect(next?.parts.refreshToken).toBe("r3");
  });
});
