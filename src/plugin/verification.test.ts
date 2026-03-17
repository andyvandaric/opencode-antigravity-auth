import { describe, expect, it } from "vitest";
import { clearStoredAccountVerificationRequired } from "./verification";

describe("clearStoredAccountVerificationRequired", () => {
  it("removes verificationRequiredType when clearing a blocked account", () => {
    const account = {
      enabled: false,
      verificationRequired: true,
      verificationRequiredAt: 123,
      verificationRequiredReason: "verify account",
      verificationRequiredType: "google-account" as const,
      verificationUrl: "https://accounts.google.com/signin/continue",
    };

    const result = clearStoredAccountVerificationRequired(account);

    expect(result).toEqual({ changed: true, wasVerificationRequired: true });
    expect(account.verificationRequiredType).toBeUndefined();
  });

  it("reports changed when only verificationRequiredType was stale", () => {
    const account = {
      enabled: true,
      verificationRequired: false,
      verificationRequiredType: "unknown" as const,
    };

    const result = clearStoredAccountVerificationRequired(account);

    expect(result).toEqual({ changed: true, wasVerificationRequired: false });
    expect(account.verificationRequiredType).toBeUndefined();
  });

  it("keeps enableIfRequired behavior unchanged", () => {
    const account = {
      enabled: false,
      verificationRequired: true,
      verificationRequiredType: "api-enable" as const,
    };

    const result = clearStoredAccountVerificationRequired(account, true);

    expect(result).toEqual({ changed: true, wasVerificationRequired: true });
    expect(account.enabled).toBe(true);
    expect(account.verificationRequiredType).toBeUndefined();
  });

  it("is a no-op for an already clean account", () => {
    const account = {
      enabled: true,
      verificationRequired: false,
    };

    const result = clearStoredAccountVerificationRequired(account);

    expect(result).toEqual({ changed: false, wasVerificationRequired: false });
    expect(account).toEqual({
      enabled: true,
      verificationRequired: false,
    });
  });
});
