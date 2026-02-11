import { describe, it, expect } from "vitest"
import {
  GEMINI_CLI_HEADERS,
  getRandomizedHeaders,
  type HeaderSet,
} from "./constants.ts"

describe("GEMINI_CLI_HEADERS", () => {
  it("contains only User-Agent with GeminiCLI format", () => {
    expect(GEMINI_CLI_HEADERS).toEqual({
      "User-Agent": "GeminiCLI/1.0.0/gemini-2.5-flash",
    })
  })

  it("does not contain X-Goog-Api-Client", () => {
    expect(GEMINI_CLI_HEADERS).not.toHaveProperty("X-Goog-Api-Client")
  })

  it("does not contain Client-Metadata", () => {
    expect(GEMINI_CLI_HEADERS).not.toHaveProperty("Client-Metadata")
  })
})

describe("getRandomizedHeaders", () => {
  describe("gemini-cli style", () => {
    it("returns only User-Agent header", () => {
      const headers = getRandomizedHeaders("gemini-cli")
      expect(headers).toHaveProperty("User-Agent")
      expect(headers["X-Goog-Api-Client"]).toBeUndefined()
      expect(headers["Client-Metadata"]).toBeUndefined()
    })

    it("returns a User-Agent in GeminiCLI format", () => {
      const headers = getRandomizedHeaders("gemini-cli")
      expect(headers["User-Agent"]).toMatch(/^GeminiCLI\/\d+\.\d+\.\d+\/gemini-2\.5-flash$/)
    })

    it("returns one of the expected GeminiCLI user agents", () => {
      const expectedAgents = [
        "GeminiCLI/1.2.0/gemini-2.5-flash",
        "GeminiCLI/1.1.0/gemini-2.5-flash",
        "GeminiCLI/1.0.0/gemini-2.5-flash",
      ]
      for (let i = 0; i < 20; i++) {
        const headers = getRandomizedHeaders("gemini-cli")
        expect(expectedAgents).toContain(headers["User-Agent"])
      }
    })
  })

  describe("antigravity style", () => {
    it("returns all three headers", () => {
      const headers = getRandomizedHeaders("antigravity")
      expect(headers["User-Agent"]).toBeDefined()
      expect(headers["X-Goog-Api-Client"]).toBeDefined()
      expect(headers["Client-Metadata"]).toBeDefined()
    })

    it("returns User-Agent in antigravity format", () => {
      const headers = getRandomizedHeaders("antigravity")
      expect(headers["User-Agent"]).toMatch(/^antigravity\//)
    })
  })
})

describe("HeaderSet type", () => {
  it("allows omitting X-Goog-Api-Client and Client-Metadata", () => {
    const headers: HeaderSet = {
      "User-Agent": "test",
    }
    expect(headers["User-Agent"]).toBe("test")
    expect(headers["X-Goog-Api-Client"]).toBeUndefined()
    expect(headers["Client-Metadata"]).toBeUndefined()
  })

  it("allows including all three headers", () => {
    const headers: HeaderSet = {
      "User-Agent": "test",
      "X-Goog-Api-Client": "test-client",
      "Client-Metadata": "test-metadata",
    }
    expect(headers["User-Agent"]).toBe("test")
    expect(headers["X-Goog-Api-Client"]).toBe("test-client")
    expect(headers["Client-Metadata"]).toBe("test-metadata")
  })
})
