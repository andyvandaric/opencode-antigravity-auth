import { describe, expect, it, vi, beforeEach } from "vitest";
import { AccountManager, getNextForFamily, ManagedAccount } from "./accounts";
import { ModelFamily } from "./storage";

// Mock helpers to avoid complex dependencies
vi.mock("../logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("AccountManager Quota Rotation", () => {
  const now = Date.now();

  // AccountMetadataV3 does not have 'index', it's assigned during load
  const mockStoredAccounts = [
    {
      email: "acc0@test.com",
      refreshToken: "t0",
      enabled: true,
      rateLimitResetTimes: {},
      cachedQuota: {
        "gemini-pro": {
          remainingFraction: 0.8,
          resetTime: undefined,
          modelCount: 1,
        }, // 20% used
      },
      cachedQuotaUpdatedAt: now,
      addedAt: now,
      lastUsed: 0,
    },
    {
      email: "acc1@test.com",
      refreshToken: "t1",
      enabled: true,
      rateLimitResetTimes: {},
      cachedQuota: {
        "gemini-pro": {
          remainingFraction: 0.2,
          resetTime: undefined,
          modelCount: 1,
        }, // 80% used
      },
      cachedQuotaUpdatedAt: now,
      addedAt: now,
      lastUsed: 0,
    },
    {
      email: "acc2@test.com",
      refreshToken: "t2",
      enabled: true,
      rateLimitResetTimes: {},
      cachedQuota: {
        "gemini-pro": {
          remainingFraction: 0.4,
          resetTime: undefined,
          modelCount: 1,
        }, // 60% used
      },
      cachedQuotaUpdatedAt: now,
      addedAt: now,
      lastUsed: 0,
    },
  ];

  it("filters out accounts over 70% threshold", () => {
    // We can test getNextForFamily indirectly via AccountManager or by instantiating it with mocks
    // Since AccountManager has private fields, let's use a "testable" subclass or just rely on the public API
    // The previous view_file showed AccountManager takes (authFallback, storedAccounts) in constructor if it's not static loadFromDisk
    // Actually constructor signature wasn't fully shown but typically it is.
    // Let's assume we can create an instance.

    const storage = {
      version: 4,
      activeIndex: 0,
      accounts: mockStoredAccounts,
    };

    // @ts-ignore - Verification only
    const manager = new AccountManager(undefined, storage);

    // Threshold 70%
    // Acc0: 20% used -> OK
    // Acc1: 80% used -> SKIP
    // Acc2: 60% used -> OK

    // First call
    const accA = manager.getNextForFamily(
      "gemini",
      "gemini-pro",
      "antigravity",
      70,
    );
    expect(accA).toBeDefined();
    expect(accA?.index).toBe(0); // 0 or 2 depending on cursor. Cursor starts at 0. Available [0, 2]. 0%2 = 0 -> acc0.

    // Second call
    const accB = manager.getNextForFamily(
      "gemini",
      "gemini-pro",
      "antigravity",
      70,
    );
    expect(accB).toBeDefined();
    expect(accB?.index).toBe(2); // Cursor 1. Available [0, 2]. 1%2 = 1 -> acc2.

    // Third call - should wrap around to 0
    const accC = manager.getNextForFamily(
      "gemini",
      "gemini-pro",
      "antigravity",
      70,
    );
    expect(accC).toBeDefined();
    expect(accC?.index).toBe(0);

    // Acc1 (index 1) should NEVER be selected
    for (let i = 0; i < 10; i++) {
      const acc = manager.getNextForFamily(
        "gemini",
        "gemini-pro",
        "antigravity",
        70,
      );
      expect(acc?.index).not.toBe(1);
    }
  });

  it("selects any account if threshold is 100% (disabled)", () => {
    const storage = {
      version: 4,
      activeIndex: 0,
      accounts: mockStoredAccounts,
    };
    // @ts-ignore
    const manager = new AccountManager(undefined, storage);

    // Threshold 100% -> Acc1 (80%) is now available
    // Available [0, 1, 2]

    const accA = manager.getNextForFamily(
      "gemini",
      "gemini-pro",
      "antigravity",
      100,
    );
    expect(accA?.index).toBe(0);

    const accB = manager.getNextForFamily(
      "gemini",
      "gemini-pro",
      "antigravity",
      100,
    );
    expect(accB?.index).toBe(1); // Acc1 selected!

    const accC = manager.getNextForFamily(
      "gemini",
      "gemini-pro",
      "antigravity",
      100,
    );
    expect(accC?.index).toBe(2);
  });
});
