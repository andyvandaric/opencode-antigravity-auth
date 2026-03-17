import { describe, it, expect, beforeEach } from "vitest";
import { AccountManager } from "./accounts";
import type { OAuthAuthDetails } from "./types";

describe("Model-specific Gemini quota", () => {
  let manager: AccountManager;
  const auth: OAuthAuthDetails = {
    type: "oauth",
    refresh: "test-refresh",
    access: "test-access",
    expires: Date.now() + 3600000,
  };

  beforeEach(() => {
    manager = new AccountManager(auth);
  });

  it("blocks only the specific Gemini model when markRateLimited is called with a model", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!;
    const modelPro = "gemini-2.5-pro";
    const modelFlash = "gemini-2.5-flash";

    manager.markRateLimited(account, 60000, "gemini", "antigravity", modelPro);

    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity", modelPro)).toBe(true);

    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity", modelFlash)).toBe(false);

    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity")).toBe(false);
  });

  it("falls back to gemini-cli only for the specific model", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!;
    const modelPro = "gemini-2.5-pro";
    const modelFlash = "gemini-2.5-flash";

    manager.markRateLimited(account, 60000, "gemini", "antigravity", modelPro);

    expect(manager.getAvailableHeaderStyle(account, "gemini", modelPro)).toBe("gemini-cli");

    expect(manager.getAvailableHeaderStyle(account, "gemini", modelFlash)).toBe("antigravity");
  });

  it("returns null when all header styles are exhausted for the specific model on a single account", () => {
    const manager2 = new AccountManager(auth);
    
    const account = manager2.getCurrentAccountForFamily("gemini")!;
    const modelPro = "gemini-2.5-pro";
    const modelFlash = "gemini-2.5-flash";

    manager2.markRateLimited(account, 60000, "gemini", "antigravity", modelPro);
    manager2.markRateLimited(account, 60000, "gemini", "gemini-cli", modelPro);

    expect(manager2.getCurrentOrNextForFamily("gemini", modelPro)).toBeNull();
    
    const flashAccount = manager2.getCurrentOrNextForFamily("gemini", modelFlash);
    expect(flashAccount).toBe(account);
  });

  it("base family rate limit blocks all models in that family", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!;
    const modelPro = "gemini-2.5-pro";

    manager.markRateLimited(account, 60000, "gemini", "antigravity");

    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity", modelPro)).toBe(true);
    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity", "gemini-2.5-flash")).toBe(true);
  });
});
