import { describe, expect, it, vi } from "vitest"

import { resolveInitialRateLimitRouting } from "./retry-fallback-orchestrator"
import type { ManagedAccount } from "./accounts"

function createAccount(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    index: 0,
    addedAt: Date.now(),
    lastUsed: Date.now(),
    parts: { refreshToken: "token" },
    enabled: true,
    rateLimitResetTimes: {},
    touchedForQuota: {},
    ...overrides,
  }
}

describe("resolveInitialRateLimitRouting", () => {
  it("keeps current header style when account is not rate-limited", () => {
    const result = resolveInitialRateLimitRouting({
      accountManager: {
        isRateLimitedForHeaderStyle: vi.fn().mockReturnValue(false),
        hasOtherAccountWithAntigravityAvailable: vi.fn(),
        getAvailableHeaderStyle: vi.fn(),
      },
      account: createAccount(),
      family: "gemini",
      model: "gemini-3.1-pro-preview",
      headerStyle: "antigravity",
      allowQuotaFallback: true,
    })

    expect(result).toEqual({
      shouldSwitchAccount: false,
      headerStyle: "antigravity",
    })
  })

  it("switches accounts when antigravity is limited but available on other accounts", () => {
    const result = resolveInitialRateLimitRouting({
      accountManager: {
        isRateLimitedForHeaderStyle: vi.fn().mockReturnValue(true),
        hasOtherAccountWithAntigravityAvailable: vi.fn().mockReturnValue(true),
        getAvailableHeaderStyle: vi.fn(),
      },
      account: createAccount({ index: 3 }),
      family: "gemini",
      model: "gemini-3.1-pro-preview",
      headerStyle: "antigravity",
      allowQuotaFallback: true,
    })

    expect(result.shouldSwitchAccount).toBe(true)
    expect(result.headerStyle).toBe("antigravity")
    expect(result.debugMessage).toContain("Switching")
  })

  it("falls back from antigravity to gemini-cli when all antigravity accounts are exhausted", () => {
    const result = resolveInitialRateLimitRouting({
      accountManager: {
        isRateLimitedForHeaderStyle: vi.fn().mockReturnValue(true),
        hasOtherAccountWithAntigravityAvailable: vi.fn().mockReturnValue(false),
        getAvailableHeaderStyle: vi.fn().mockReturnValue("gemini-cli"),
      },
      account: createAccount(),
      family: "gemini",
      model: "gemini-3.1-pro-preview",
      headerStyle: "antigravity",
      allowQuotaFallback: true,
    })

    expect(result.shouldSwitchAccount).toBe(false)
    expect(result.headerStyle).toBe("gemini-cli")
    expect(result.toastMessage).toContain("Using Gemini CLI quota")
  })

  it("switches account when no fallback style is available", () => {
    const result = resolveInitialRateLimitRouting({
      accountManager: {
        isRateLimitedForHeaderStyle: vi.fn().mockReturnValue(true),
        hasOtherAccountWithAntigravityAvailable: vi.fn().mockReturnValue(false),
        getAvailableHeaderStyle: vi.fn().mockReturnValue(null),
      },
      account: createAccount(),
      family: "gemini",
      model: "gemini-3.1-pro-preview",
      headerStyle: "gemini-cli",
      allowQuotaFallback: true,
    })

    expect(result).toEqual({
      shouldSwitchAccount: true,
      headerStyle: "gemini-cli",
    })
  })
})
