import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("initAntigravityVersion", () => {
  it("uses the updater API version when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("1.20.7")),
    );

    const versionModule = await import("./version");
    const constants = await import("../constants");

    await versionModule.initAntigravityVersion();

    expect(constants.getAntigravityVersion()).toBe("1.20.7");
  });

  it("falls back to the changelog when the updater API is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockRejectedValueOnce(new Error("updater unavailable"))
        .mockResolvedValueOnce(new Response("<html>Antigravity 1.20.8 shipped</html>")),
    );

    const versionModule = await import("./version");
    const constants = await import("../constants");

    await versionModule.initAntigravityVersion();

    expect(constants.getAntigravityVersion()).toBe("1.20.8");
  });

  it("keeps the fallback version when remote sources do not return a semver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response("no version here"))
        .mockResolvedValueOnce(new Response("still nothing useful")),
    );

    const versionModule = await import("./version");
    const constants = await import("../constants");

    await versionModule.initAntigravityVersion();

    expect(constants.getAntigravityVersion()).toBe("1.20.5");
  });
});
