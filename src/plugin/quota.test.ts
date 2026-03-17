import { afterEach, describe, expect, it, vi } from "vitest";
import { GEMINI_CLI_HEADERS } from "../constants";
import { __testExports } from "./quota";

const {
  aggregateQuota,
  aggregateGeminiCliQuota,
  fetchAvailableModels,
  fetchGeminiCliQuota,
  resolveQuotaProjectId,
} = __testExports;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("quota request helpers", () => {
  it("falls back to the default project id for quota-only requests", () => {
    expect(resolveQuotaProjectId("")).toBe("rising-fact-p41fc");
    expect(resolveQuotaProjectId("project-123")).toBe("project-123");
  });

  it("sends antigravity quota requests with the fallback project and antigravity headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchAvailableModels("token", "");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const requestInit = init as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    const headers = requestInit.headers as Record<string, string>;

    expect(body.project).toBe("rising-fact-p41fc");
    expect(headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 .* Antigravity\//);
    expect(headers["X-Goog-Api-Client"]).toBeDefined();
    expect(headers["Client-Metadata"]).toContain('"ideType":"ANTIGRAVITY"');
  });

  it("sends gemini cli quota requests with the fallback project and gemini headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ buckets: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchGeminiCliQuota("token", "");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const requestInit = init as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    const headers = requestInit.headers as Record<string, string>;

    expect(body.project).toBe("rising-fact-p41fc");
    expect(headers["User-Agent"]).toBe(GEMINI_CLI_HEADERS["User-Agent"]);
    expect(headers["X-Goog-Api-Client"]).toBe(
      GEMINI_CLI_HEADERS["X-Goog-Api-Client"],
    );
    expect(headers["Client-Metadata"]).toBe(
      GEMINI_CLI_HEADERS["Client-Metadata"],
    );
  });
});

describe("quota aggregation", () => {
  it("keeps remainingFraction undefined when the only model omits it", () => {
    const summary = aggregateQuota({
      "gemini-3-pro": {
        quotaInfo: {},
      },
    });

    expect(summary.groups["gemini-pro"]).toEqual({
      remainingFraction: undefined,
      resetTime: undefined,
      modelCount: 1,
    });
  });

  it("ignores missing remainingFraction when another model has quota data", () => {
    const summary = aggregateQuota({
      "gemini-3-pro": {
        quotaInfo: {
          remainingFraction: 0.8,
        },
      },
      "gemini-3-pro-preview": {
        quotaInfo: {},
      },
    });

    expect(summary.groups["gemini-pro"]?.remainingFraction).toBe(0.8);
  });

  it("keeps the minimum defined remainingFraction across models", () => {
    const summary = aggregateQuota({
      "gemini-3-pro": {
        quotaInfo: {
          remainingFraction: 0.8,
        },
      },
      "gemini-3-pro-preview": {
        quotaInfo: {
          remainingFraction: 0.2,
        },
      },
    });

    expect(summary.groups["gemini-pro"]?.remainingFraction).toBe(0.2);
  });

  it("ignores non-finite remainingFraction values", () => {
    const summary = aggregateQuota({
      "gemini-3-pro": {
        quotaInfo: {
          remainingFraction: 0.8,
        },
      },
      "gemini-3-pro-preview": {
        quotaInfo: {
          remainingFraction: Number.NaN,
        },
      },
    });

    expect(summary.groups["gemini-pro"]?.remainingFraction).toBe(0.8);
  });

  it("preserves individual antigravity model entries for display", () => {
    const summary = aggregateQuota({
      "gemini-3-flash": {
        modelName: "gemini-3-flash",
        displayName: "Gemini 3 Flash",
        quotaInfo: {
          remainingFraction: 0.25,
          resetTime: "2026-01-01T00:00:00Z",
        },
      },
      "claude-sonnet-4-6": {
        modelName: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        quotaInfo: {
          remainingFraction: 0.9,
        },
      },
    });

    expect(summary.models).toEqual([
      {
        modelId: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        remainingFraction: 0.9,
        resetTime: undefined,
        group: "claude",
      },
      {
        modelId: "gemini-3-flash",
        displayName: "Gemini 3 Flash",
        remainingFraction: 0.25,
        resetTime: "2026-01-01T00:00:00Z",
        group: "gemini-flash",
      },
    ]);
  });
});

describe("gemini cli quota aggregation", () => {
  it("keeps all supported Gemini CLI models", () => {
    const summary = aggregateGeminiCliQuota({
      buckets: [
        { modelId: "gemini-2.5-flash", remainingFraction: 0.7 },
        { modelId: "gemini-2.5-pro", remainingFraction: 0.6 },
        { modelId: "gemini-3-flash-preview", remainingFraction: 0.5 },
        { modelId: "gemini-3.1-pro-preview", remainingFraction: 0.4 },
        { modelId: "gemini-1.5-pro", remainingFraction: 0.3 },
      ],
    });

    expect(summary.models.map((model) => model.modelId)).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
    ]);
  });
});
