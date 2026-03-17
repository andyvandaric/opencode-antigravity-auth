import { afterEach, describe, expect, it, vi } from "vitest";
import { executeSearch, __testExports } from "./search";

const { generateRequestId, getSessionId } = __testExports;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("search.ts", () => {
  describe("identifier helpers", () => {
    it("generates UUID request ids", () => {
      expect(generateRequestId()).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("generates UUID session ids", () => {
      expect(getSessionId()).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe("executeSearch", () => {
    it("wraps search requests with neutral UUID ids", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            candidates: [
              { content: { parts: [{ text: "ok" }] } },
            ],
          },
        }),
      });

      vi.stubGlobal("fetch", fetchMock);

      await executeSearch(
        { query: "latest antigravity version" },
        "token",
        "project-123",
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);

      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.requestId.startsWith("search-")).toBe(false);
      expect(body.request.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.request.sessionId.startsWith("search-")).toBe(false);
    });

    it("does not fall back to the literal unknown project marker", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            candidates: [
              { content: { parts: [{ text: "ok" }] } },
            ],
          },
        }),
      });

      vi.stubGlobal("fetch", fetchMock);

      await executeSearch(
        { query: "latest antigravity version" },
        "token",
        "",
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string);

      expect(body.project).toBe("");
      expect(body.project).not.toBe("unknown");
    });
  });
});
