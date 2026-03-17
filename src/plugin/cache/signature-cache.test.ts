import { describe, expect, it } from "vitest"
import { join } from "node:path"

import { __testExports } from "./signature-cache"

describe("signature-cache path resolution", () => {
  it("uses OPENCODE_CONFIG_DIR when provided", () => {
    const configDir = __testExports.resolveConfigDir(
      {
        OPENCODE_CONFIG_DIR: "/custom/opencode",
      },
      "win32",
      "/home/tester",
    )

    expect(configDir).toBe("/custom/opencode")
  })

  it("falls back to XDG_CONFIG_HOME when OPENCODE_CONFIG_DIR is unset", () => {
    const configDir = __testExports.resolveConfigDir(
      {
        XDG_CONFIG_HOME: "/xdg-config",
      },
      "linux",
      "/home/tester",
    )

    expect(configDir).toBe(join("/xdg-config", "opencode"))
  })

  it("uses ~/.config/opencode across platforms when no overrides are provided", () => {
    const winConfigDir = __testExports.resolveConfigDir({}, "win32", "C:/Users/tester")
    const linuxConfigDir = __testExports.resolveConfigDir({}, "linux", "/home/tester")

    expect(winConfigDir).toBe(join("C:/Users/tester", ".config", "opencode"))
    expect(linuxConfigDir).toBe(join("/home/tester", ".config", "opencode"))
  })

  it("builds the cache file path from config dir", () => {
    const cacheFilePath = __testExports.resolveCacheFilePath("/tmp/opencode")
    expect(cacheFilePath).toBe(join("/tmp/opencode", "antigravity-signature-cache.json"))
  })
})
