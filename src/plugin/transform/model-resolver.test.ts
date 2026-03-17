import { describe, it, expect } from "vitest";
import { resolveModelWithTier, resolveModelWithVariant, resolveModelForHeaderStyle } from "./model-resolver";

describe("resolveModelWithTier", () => {
  describe("Gemini 3 flash models (Issue #109)", () => {
    it("antigravity-gemini-3-flash gets default thinkingLevel 'low'", () => {
      const result = resolveModelWithTier("antigravity-gemini-3-flash");
      expect(result.actualModel).toBe("gemini-3-flash");
      expect(result.thinkingLevel).toBe("low");
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("gemini-3-flash gets default thinkingLevel 'low'", () => {
      const result = resolveModelWithTier("gemini-3-flash");
      expect(result.actualModel).toBe("gemini-3-flash");
      expect(result.thinkingLevel).toBe("low");
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("gemini-3-flash-preview gets default thinkingLevel 'low' with antigravity quota", () => {
      const result = resolveModelWithTier("gemini-3-flash-preview");
      expect(result.actualModel).toBe("gemini-3-flash-preview");
      expect(result.thinkingLevel).toBe("low");
      // All Gemini models now default to antigravity
      expect(result.quotaPreference).toBe("antigravity");
    });
  });

  describe("Gemini 3 preview models (Issue #115)", () => {
    it("gemini-3.1-pro-preview gets default thinkingLevel 'low' with antigravity quota", () => {
      const result = resolveModelWithTier("gemini-3.1-pro-preview");
      expect(result.actualModel).toBe("gemini-3.1-pro-preview");
      expect(result.thinkingLevel).toBe("low");
      // All Gemini models now default to antigravity
      expect(result.quotaPreference).toBe("antigravity");
    });
  });

  describe("All Gemini models default to antigravity quota", () => {
    it("gemini-2.5-flash defaults to antigravity", () => {
      const result = resolveModelWithTier("gemini-2.5-flash");
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("gemini-2.5-pro defaults to antigravity", () => {
      const result = resolveModelWithTier("gemini-2.5-pro");
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("rejects unsupported legacy gemini-2.0 models", () => {
      expect(() => resolveModelWithTier("gemini-2.0-flash")).toThrow(
        /Unsupported Gemini text model/i,
      );
    });
  });

  describe("cli_first quota preference", () => {
    it("prefers gemini-cli when cli_first is true and no prefix is set", () => {
      const result = resolveModelWithTier("gemini-3-flash", { cli_first: true });
      expect(result.quotaPreference).toBe("gemini-cli");
      expect(result.explicitQuota).toBe(false);
    });

    it("keeps antigravity when antigravity prefix is explicit", () => {
      const result = resolveModelWithTier("antigravity-gemini-3-flash", { cli_first: true });
      expect(result.quotaPreference).toBe("antigravity");
      expect(result.explicitQuota).toBe(true);
    });

    it("keeps antigravity for Claude models when cli_first is true", () => {
      const result = resolveModelWithTier("claude-sonnet-4-6", { cli_first: true });
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("rejects image models even when cli_first is true", () => {
      expect(() => resolveModelWithTier("gemini-3.1-flash-image-preview", { cli_first: true })).toThrow(
        /Image generation models are not supported via the Antigravity proxy endpoint/i,
      );
    });

    it("defaults to antigravity when cli_first is false", () => {
      const result = resolveModelWithTier("gemini-3-flash", { cli_first: false });
      expect(result.quotaPreference).toBe("antigravity");
    });
  });

  describe("Antigravity Gemini 3 with tier suffix", () => {
    it("antigravity-gemini-3.1-pro-low gets thinkingLevel from tier", () => {
      const result = resolveModelWithTier("antigravity-gemini-3.1-pro-low");
      expect(result.actualModel).toBe("gemini-3.1-pro-low");
      expect(result.thinkingLevel).toBe("low");
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("antigravity-gemini-3.1-pro-high gets thinkingLevel from tier", () => {
      const result = resolveModelWithTier("antigravity-gemini-3.1-pro-high");
      expect(result.actualModel).toBe("gemini-3.1-pro-high");
      expect(result.thinkingLevel).toBe("high");
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("antigravity-gemini-3-flash-medium gets thinkingLevel from tier", () => {
      const result = resolveModelWithTier("antigravity-gemini-3-flash-medium");
      expect(result.actualModel).toBe("gemini-3-flash");
      expect(result.thinkingLevel).toBe("medium");
    });
  });

  describe("Claude thinking models default budget", () => {
    it("antigravity-claude-opus-4-6-thinking gets default max budget (32768)", () => {
      const result = resolveModelWithTier("antigravity-claude-opus-4-6-thinking");
      expect(result.actualModel).toBe("claude-opus-4-6-thinking");
      expect(result.thinkingBudget).toBe(32768);
      expect(result.isThinkingModel).toBe(true);
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("rejects deprecated Claude 4.5 models", () => {
      expect(() => resolveModelWithTier("antigravity-claude-opus-4-5-thinking")).toThrow(
        /Deprecated Claude 4\.5 model/i,
      );
      expect(() => resolveModelWithTier("gemini-claude-sonnet-4-5-thinking-low")).toThrow(
        /Deprecated Claude 4\.5 model/i,
      );
    });
  });

  describe("Image models", () => {
    it("throws for antigravity-gemini-3.1-flash-image-preview", () => {
      expect(() => resolveModelWithTier("antigravity-gemini-3.1-flash-image-preview")).toThrow(
        /Image generation models are not supported via the Antigravity proxy endpoint/i,
      );
    });

    it("throws for gemini-3.1-flash-image-preview", () => {
      expect(() => resolveModelWithTier("gemini-3.1-flash-image-preview")).toThrow(
        /Image generation models are not supported via the Antigravity proxy endpoint/i,
      );
    });

    it("throws for legacy gemini-3.1-pro-image", () => {
      expect(() => resolveModelWithTier("gemini-3.1-pro-image")).toThrow(
        /Image generation models are not supported via the Antigravity proxy endpoint/i,
      );
    });

    it("throws for antigravity-gemini-2.5-flash-image", () => {
      expect(() => resolveModelWithTier("antigravity-gemini-2.5-flash-image")).toThrow(
        /Image generation models are not supported via the Antigravity proxy endpoint/i,
      );
    });
  });
  describe("Claude Sonnet 4.6 aliases (non-thinking)", () => {
    it("antigravity-claude-sonnet-4-6-thinking resolves to thinking Sonnet 4.6", () => {
      const result = resolveModelWithTier("antigravity-claude-sonnet-4-6-thinking");
      expect(result.actualModel).toBe("claude-sonnet-4-6");
      expect(result.thinkingBudget).toBeUndefined();
      expect(result.isThinkingModel).toBe(false);
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("maps gemini-claude-sonnet-4-6 to claude-sonnet-4-6", () => {
      const result = resolveModelWithTier("gemini-claude-sonnet-4-6");
      expect(result.actualModel).toBe("claude-sonnet-4-6");
      expect(result.isThinkingModel).toBe(false);
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("maps gemini-claude-sonnet-4-6-thinking to thinking claude-sonnet-4-6", () => {
      const result = resolveModelWithTier("gemini-claude-sonnet-4-6-thinking");
      expect(result.actualModel).toBe("claude-sonnet-4-6");
      expect(result.thinkingBudget).toBeUndefined();
      expect(result.isThinkingModel).toBe(false);
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("maps gemini-claude-sonnet-4-6-thinking-high to thinking claude-sonnet-4-6", () => {
      const result = resolveModelWithTier("gemini-claude-sonnet-4-6-thinking-high");
      expect(result.actualModel).toBe("claude-sonnet-4-6");
      expect(result.thinkingBudget).toBeUndefined();
      expect(result.isThinkingModel).toBe(false);
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("maps gemini-claude-sonnet-4-6-thinking-low to thinking claude-sonnet-4-6", () => {
      const result = resolveModelWithTier("gemini-claude-sonnet-4-6-thinking-low");
      expect(result.actualModel).toBe("claude-sonnet-4-6");
      expect(result.thinkingBudget).toBeUndefined();
      expect(result.isThinkingModel).toBe(false);
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("maps gemini-claude-sonnet-4-6-thinking-medium to thinking claude-sonnet-4-6", () => {
      const result = resolveModelWithTier("gemini-claude-sonnet-4-6-thinking-medium");
      expect(result.actualModel).toBe("claude-sonnet-4-6");
      expect(result.thinkingBudget).toBeUndefined();
      expect(result.isThinkingModel).toBe(false);
      expect(result.quotaPreference).toBe("antigravity");
    });
  });
});

describe("resolveModelWithVariant", () => {
  describe("without variant config", () => {
    it("falls back to tier resolution for Claude thinking models", () => {
      const result = resolveModelWithVariant("claude-opus-4-6-thinking-low");
      expect(result.actualModel).toBe("claude-opus-4-6-thinking");
      expect(result.thinkingBudget).toBe(8192);
      expect(result.configSource).toBeUndefined();
    });

    it("falls back to tier resolution for Gemini 3 models", () => {
      const result = resolveModelWithVariant("gemini-3.1-pro-high");
      expect(result.actualModel).toBe("gemini-3.1-pro-high");
      expect(result.thinkingLevel).toBe("high");
      expect(result.configSource).toBeUndefined();
    });
  });

  describe("with variant config", () => {
    it("overrides tier budget for Claude models", () => {
      const result = resolveModelWithVariant("antigravity-claude-opus-4-6-thinking", {
        thinkingBudget: 24000,
      });
      expect(result.actualModel).toBe("claude-opus-4-6-thinking");
      expect(result.thinkingBudget).toBe(24000);
      expect(result.configSource).toBe("variant");
    });

    it("maps budget to thinkingLevel for Gemini 3 - low", () => {
      const result = resolveModelWithVariant("antigravity-gemini-3.1-pro", {
        thinkingBudget: 8000,
      });
      expect(result.actualModel).toBe("gemini-3.1-pro-low");
      expect(result.thinkingLevel).toBe("low");
      expect(result.thinkingBudget).toBeUndefined();
      expect(result.configSource).toBe("variant");
    });

    it("maps budget to thinkingLevel for Gemini 3 Flash - medium (no tier suffix)", () => {
      const result = resolveModelWithVariant("antigravity-gemini-3-flash", {
        thinkingBudget: 12000,
      });
      expect(result.actualModel).toBe("gemini-3-flash");
      expect(result.thinkingLevel).toBe("medium");
      expect(result.configSource).toBe("variant");
    });

    it("maps budget to thinkingLevel for Gemini 3 - high", () => {
      const result = resolveModelWithVariant("antigravity-gemini-3.1-pro", {
        thinkingBudget: 32000,
      });
      expect(result.thinkingLevel).toBe("high");
      expect(result.configSource).toBe("variant");
    });

    it("uses budget directly for non-Gemini 3 models", () => {
      const result = resolveModelWithVariant("gemini-2.5-pro", {
        thinkingBudget: 20000,
      });
      expect(result.thinkingBudget).toBe(20000);
      expect(result.thinkingLevel).toBeUndefined();
      expect(result.configSource).toBe("variant");
    });

    it("applies variant thinkingBudget for thinking Sonnet 4.6 alias", () => {
      const result = resolveModelWithVariant("gemini-claude-sonnet-4-6-thinking", {
        thinkingBudget: 20000,
      });
      expect(result.actualModel).toBe("claude-sonnet-4-6");
      expect(result.isThinkingModel).toBe(false);
      expect(result.thinkingBudget).toBeUndefined();
      expect(result.thinkingLevel).toBeUndefined();
      expect(result.configSource).toBeUndefined();
    });
  });

  describe("backward compatibility", () => {
    it("tier-suffixed models work without variant config", () => {
      const lowResult = resolveModelWithVariant("claude-opus-4-6-thinking-low");
      expect(lowResult.thinkingBudget).toBe(8192);

      const medResult = resolveModelWithVariant("claude-opus-4-6-thinking-medium");
      expect(medResult.thinkingBudget).toBe(16384);

      const highResult = resolveModelWithVariant("claude-opus-4-6-thinking-high");
      expect(highResult.thinkingBudget).toBe(32768);
    });

    it("variant config overrides tier suffix", () => {
      const result = resolveModelWithVariant("claude-opus-4-6-thinking-low", {
        thinkingBudget: 50000,
      });
      expect(result.thinkingBudget).toBe(50000);
      expect(result.configSource).toBe("variant");
    });
  });
});

describe("Issue #103: resolveModelForHeaderStyle", () => {
  describe("quota fallback from gemini-cli to antigravity", () => {
    it("transforms gemini-3-flash-preview to gemini-3-flash for antigravity", () => {
      const result = resolveModelForHeaderStyle("gemini-3-flash-preview", "antigravity");
      expect(result.actualModel).toBe("gemini-3-flash");
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("transforms gemini-3.1-pro-preview to gemini-3.1-pro for antigravity", () => {
      const result = resolveModelForHeaderStyle("gemini-3.1-pro-preview", "antigravity");
      expect(result.actualModel).toBe("gemini-3.1-pro-low");
      expect(result.quotaPreference).toBe("antigravity");
    });

    it("rejects image preview model for antigravity", () => {
      expect(() => resolveModelForHeaderStyle("gemini-3.1-flash-image-preview", "antigravity")).toThrow(
        /Image generation models are not supported via the Antigravity proxy endpoint/i,
      );
    });
  });

  describe("quota fallback from antigravity to gemini-cli", () => {
    it("transforms gemini-3-flash to gemini-3-flash-preview for gemini-cli", () => {
      const result = resolveModelForHeaderStyle("gemini-3-flash", "gemini-cli");
      expect(result.actualModel).toBe("gemini-3-flash-preview");
      expect(result.quotaPreference).toBe("gemini-cli");
    });

    it("transforms gemini-3.1-pro-low to gemini-3.1-pro-preview for gemini-cli", () => {
      const result = resolveModelForHeaderStyle("gemini-3.1-pro-low", "gemini-cli");
      expect(result.actualModel).toBe("gemini-3.1-pro-preview");
      expect(result.quotaPreference).toBe("gemini-cli");
    });

    it("strips -preview-customtools before gemini-cli conversion", () => {
      const result = resolveModelForHeaderStyle("gemini-3.1-pro-preview-customtools", "gemini-cli");
      expect(result.actualModel).toBe("gemini-3.1-pro-preview");
      expect(result.quotaPreference).toBe("gemini-cli");
    });
  });

  describe("no transformation needed", () => {
    it("keeps gemini-2.5-flash unchanged for both header styles", () => {
      const antigravity = resolveModelForHeaderStyle("gemini-2.5-flash", "antigravity");
      const cli = resolveModelForHeaderStyle("gemini-2.5-flash", "gemini-cli");
      expect(antigravity.actualModel).toBe("gemini-2.5-flash");
      expect(cli.actualModel).toBe("gemini-2.5-flash");
    });

    it("keeps claude models unchanged (antigravity only)", () => {
      const result = resolveModelForHeaderStyle("claude-opus-4-6-thinking", "antigravity");
      expect(result.actualModel).toBe("claude-opus-4-6-thinking");
    });
  });
});
