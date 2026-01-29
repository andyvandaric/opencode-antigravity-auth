import { describe, it, expect } from "vitest";
import { __testExports } from "../plugin";

const { getHeaderStyleFromUrl } = __testExports;

describe("getHeaderStyleFromUrl", () => {
  it("defaults Gemini models to antigravity", () => {
    const headerStyle = getHeaderStyleFromUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      "gemini",
    );
    expect(headerStyle).toBe("antigravity");
  });

  it("keeps Claude models on antigravity", () => {
    const headerStyle = getHeaderStyleFromUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/claude-sonnet-4-5-thinking:generateContent",
      "claude",
    );
    expect(headerStyle).toBe("antigravity");
  });
});
