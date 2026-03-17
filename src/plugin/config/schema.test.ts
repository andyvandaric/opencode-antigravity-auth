import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "./schema";

describe("cli_first config", () => {
  it("includes cli_first default in DEFAULT_CONFIG", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("cli_first", false);
  });

  it("documents cli_first in the JSON schema", () => {
    const schemaPath = new URL("../../../assets/antigravity.schema.json", import.meta.url);
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      properties?: Record<string, { type?: string; default?: unknown; description?: string }>;
    };

    const cliFirst = schema.properties?.cli_first;
    expect(cliFirst).toBeDefined();
    expect(cliFirst).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(typeof cliFirst?.description).toBe("string");
    expect(cliFirst?.description?.length ?? 0).toBeGreaterThan(0);
  });

  it("includes allow_ai_credit_overages default in DEFAULT_CONFIG", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("allow_ai_credit_overages", false);
  });

  it("includes auto_resume default in DEFAULT_CONFIG", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("auto_resume", false);
  });

  it("documents allow_ai_credit_overages in the JSON schema", () => {
    const schemaPath = new URL("../../../assets/antigravity.schema.json", import.meta.url);
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      properties?: Record<string, { type?: string; default?: unknown; description?: string }>;
    };

    const allowAiCreditOverages = schema.properties?.allow_ai_credit_overages;
    expect(allowAiCreditOverages).toBeDefined();
    expect(allowAiCreditOverages).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(typeof allowAiCreditOverages?.description).toBe("string");
    expect(allowAiCreditOverages?.description?.length ?? 0).toBeGreaterThan(0);
  });

  it("documents auto_resume in the JSON schema", () => {
    const schemaPath = new URL("../../../assets/antigravity.schema.json", import.meta.url);
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      properties?: Record<string, { type?: string; default?: unknown; description?: string }>;
    };

    const autoResume = schema.properties?.auto_resume;
    expect(autoResume).toBeDefined();
    expect(autoResume).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(typeof autoResume?.description).toBe("string");
    expect(autoResume?.description?.length ?? 0).toBeGreaterThan(0);
  });
});
