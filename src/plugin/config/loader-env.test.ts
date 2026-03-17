import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { loadConfig } from "./loader";

describe("Config Loader Environment Overrides", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCODE_CONFIG_DIR = join(
      "/tmp",
      `opencode-loader-env-${process.pid}-${Date.now()}`,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults soft_quota_threshold_percent to 70", () => {
    // Ensure no env var
    delete process.env.OPENCODE_ANTIGRAVITY_SOFT_QUOTA_THRESHOLD_PERCENT;

    // We can't easily mock loadConfig's internal DEFAULT_CONFIG usage without more complex mocking,
    // but we can check the result of loadConfig with an empty dir (simulating no config files)
    const config = loadConfig("/tmp/nonexistent");
    expect(config.soft_quota_threshold_percent).toBe(70);
  });

  it("defaults auto_resume to false", () => {
    delete process.env.OPENCODE_ANTIGRAVITY_AUTO_RESUME;
    const config = loadConfig("/tmp/nonexistent");
    expect(config.auto_resume).toBe(false);
  });

  it("overrides soft_quota_threshold_percent via env var", () => {
    process.env.OPENCODE_ANTIGRAVITY_SOFT_QUOTA_THRESHOLD_PERCENT = "50";
    const config = loadConfig("/tmp/nonexistent");
    expect(config.soft_quota_threshold_percent).toBe(50);
  });

  it("defaults allow_ai_credit_overages to false", () => {
    delete process.env.OPENCODE_ANTIGRAVITY_ALLOW_AI_CREDIT_OVERAGES;
    const config = loadConfig("/tmp/nonexistent");
    expect(config.allow_ai_credit_overages).toBe(false);
  });

  it("overrides allow_ai_credit_overages via env var", () => {
    process.env.OPENCODE_ANTIGRAVITY_ALLOW_AI_CREDIT_OVERAGES = "true";
    const config = loadConfig("/tmp/nonexistent");
    expect(config.allow_ai_credit_overages).toBe(true);
  });

  it("ignores invalid soft_quota_threshold_percent env var", () => {
    process.env.OPENCODE_ANTIGRAVITY_SOFT_QUOTA_THRESHOLD_PERCENT = "abc";
    const config = loadConfig("/tmp/nonexistent");
    expect(config.soft_quota_threshold_percent).toBe(70);
  });
});
