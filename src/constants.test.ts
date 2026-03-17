import { describe, it, expect } from "vitest"
import {
  GEMINI_CLI_HEADERS,
  getRandomizedHeaders,
  ANTIGRAVITY_VERSION,
  type HeaderSet,
} from "./constants.ts"

describe("GEMINI_CLI_HEADERS", () => {
  it("matches Code Assist headers from opencode-gemini-auth", () => {
    expect(GEMINI_CLI_HEADERS).toEqual({
      "User-Agent": "google-api-nodejs-client/9.15.1",
      "X-Goog-Api-Client": `gl-node/${process.versions.node}`,
      "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
    })
  })
})

describe("getRandomizedHeaders", () => {
  describe("gemini-cli style", () => {
    it("returns static Code Assist headers", () => {
      const headers = getRandomizedHeaders("gemini-cli", "gemini-2.5-pro")
      expect(headers).toEqual({
        "User-Agent": "google-api-nodejs-client/9.15.1",
        "X-Goog-Api-Client": `gl-node/${process.versions.node}`,
        "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
      })
    })

    it("ignores requested model and keeps static User-Agent", () => {
      const headers = getRandomizedHeaders("gemini-cli", "gemini-3.1-pro-preview")
      expect(headers["User-Agent"]).toBe("google-api-nodejs-client/9.15.1")
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
      expect(headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 .* Antigravity\//)
    })

    it("aligns Client-Metadata platform with User-Agent platform", () => {
      for (let i = 0; i < 50; i++) {
        const headers = getRandomizedHeaders("antigravity")
        const ua = headers["User-Agent"]!
        const metadata = JSON.parse(headers["Client-Metadata"]!)
        if (ua.includes("Windows NT")) {
          expect(metadata.platform).toBe("WINDOWS")
        } else {
          expect(metadata.platform).toBe("MACOS")
        }
      }
    })

    it("never produces a linux User-Agent", () => {
      for (let i = 0; i < 50; i++) {
        const headers = getRandomizedHeaders("antigravity")
        expect(headers["User-Agent"]).not.toMatch(/linux\//)
      }
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

describe("ANTIGRAVITY_VERSION_FALLBACK and getAntigravityVersion()", () => {
  it("ANTIGRAVITY_VERSION_FALLBACK is '1.20.5'", async () => {
    const { getAntigravityVersion } = await import("./constants.ts")
    expect(getAntigravityVersion()).toBe("1.20.5")
  })

  it("setAntigravityVersion() updates getAntigravityVersion() to '1.20.6'", async () => {
    const { getAntigravityVersion, setAntigravityVersion } = await import("./constants.ts")
    setAntigravityVersion("1.20.6")
    expect(getAntigravityVersion()).toBe("1.20.6")
  })

  it("after setAntigravityVersion() is called once, calling it again has no effect", async () => {
    const { getAntigravityVersion, setAntigravityVersion } = await import("./constants.ts")
    // Note: If this test runs after the previous one, it's already locked to '1.20.0'
    const current = getAntigravityVersion()
    setAntigravityVersion("1.21.0")
    expect(getAntigravityVersion()).toBe(current)
  })

  it("ANTIGRAVITY_VERSION deprecated export equals '1.20.5'", () => {
    expect(ANTIGRAVITY_VERSION).toBe("1.20.5")
  })
})
