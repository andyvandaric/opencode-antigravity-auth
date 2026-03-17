import { beforeAll, describe, expect, it, vi } from "vitest";
import { GEMINI_CLI_REDIRECT_URI } from "../constants";

type GetOAuthListenerRedirectUri = (isGeminiCli: boolean) =>
  | string
  | undefined;

let getOAuthListenerRedirectUri: GetOAuthListenerRedirectUri | undefined;

beforeAll(async () => {
  vi.mock("@opencode-ai/plugin", () => ({
    tool: vi.fn(),
  }));

  const { __testExports } = await import("../plugin");
  getOAuthListenerRedirectUri = (__testExports as {
    getOAuthListenerRedirectUri?: GetOAuthListenerRedirectUri;
  }).getOAuthListenerRedirectUri;
});

describe("oauth listener redirect selection", () => {
  it("uses the Gemini CLI redirect uri for Gemini CLI login", () => {
    expect(getOAuthListenerRedirectUri?.(true)).toBe(GEMINI_CLI_REDIRECT_URI);
  });

  it("keeps the default listener redirect for Antigravity OAuth", () => {
    expect(getOAuthListenerRedirectUri?.(false)).toBeUndefined();
  });
});
