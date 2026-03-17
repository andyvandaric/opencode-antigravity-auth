import { describe, expect, it } from "vitest"

import { ANTIGRAVITY_ENDPOINT, GEMINI_CLI_ENDPOINT } from "../constants"
import { DEFAULT_CONFIG, type AntigravityConfig } from "./config/schema"
import { prepareAntigravityRequest } from "./request"
import { resolveHeaderRoutingDecision } from "./request-url"

function createGeminiRequestInfo(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`
}

function createBody(): string {
  return JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: "hello" }],
      },
    ],
  })
}

function createConfig(overrides: Partial<AntigravityConfig> = {}): AntigravityConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  }
}

describe("integration routing smoke", () => {
  it("routes unsuffixed Gemini requests to Antigravity when cli_first is disabled", () => {
    const input = createGeminiRequestInfo("gemini-3.1-pro-preview")
    const config = createConfig({ cli_first: false })
    const decision = resolveHeaderRoutingDecision(input, "gemini", config)

    const prepared = prepareAntigravityRequest(
      input,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody(),
      },
      "token",
      "project",
      undefined,
      decision.preferredHeaderStyle,
    )

    expect(decision.preferredHeaderStyle).toBe("antigravity")
    expect(typeof prepared.request).toBe("string")
    expect((prepared.request as string).startsWith(ANTIGRAVITY_ENDPOINT)).toBe(true)
  })

  it("routes unsuffixed Gemini requests to Gemini CLI when cli_first is enabled", () => {
    const input = createGeminiRequestInfo("gemini-3.1-pro-preview")
    const config = createConfig({ cli_first: true })
    const decision = resolveHeaderRoutingDecision(input, "gemini", config)

    const prepared = prepareAntigravityRequest(
      input,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody(),
      },
      "token",
      "project",
      undefined,
      decision.preferredHeaderStyle,
    )

    expect(decision.preferredHeaderStyle).toBe("gemini-cli")
    expect(typeof prepared.request).toBe("string")
    expect((prepared.request as string).startsWith(GEMINI_CLI_ENDPOINT)).toBe(true)
  })

  it("keeps explicit antigravity-prefixed Gemini models on Antigravity even when cli_first is enabled", () => {
    const input = createGeminiRequestInfo("antigravity-gemini-3.1-pro-high")
    const config = createConfig({ cli_first: true })
    const decision = resolveHeaderRoutingDecision(input, "gemini", config)

    const prepared = prepareAntigravityRequest(
      input,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: createBody(),
      },
      "token",
      "project",
      undefined,
      decision.preferredHeaderStyle,
    )

    expect(decision.explicitQuota).toBe(true)
    expect(decision.preferredHeaderStyle).toBe("antigravity")
    expect(typeof prepared.request).toBe("string")
    expect((prepared.request as string).startsWith(ANTIGRAVITY_ENDPOINT)).toBe(true)
  })
})
