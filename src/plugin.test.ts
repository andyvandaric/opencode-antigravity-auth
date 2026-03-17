import { beforeAll, describe, expect, it, vi } from "vitest";

type ShouldSendRecoveryResumePrompt = (input: {
  recovered: boolean;
  sessionID?: string;
  autoResume: boolean;
  errorType:
    | "tool_result_missing"
    | "thinking_block_order"
    | "thinking_disabled_violation"
    | null;
}) => boolean;

let shouldSendRecoveryResumePrompt: ShouldSendRecoveryResumePrompt | undefined;

beforeAll(async () => {
  vi.mock("@opencode-ai/plugin", () => ({
    tool: vi.fn(),
  }));

  const { __testExports } = await import("./plugin");
  shouldSendRecoveryResumePrompt = (__testExports as {
    shouldSendRecoveryResumePrompt?: ShouldSendRecoveryResumePrompt;
  }).shouldSendRecoveryResumePrompt;
});

describe("recovery resume prompt gating", () => {
  it("allows the outer resume prompt for tool_result_missing", () => {
    expect(
      shouldSendRecoveryResumePrompt?.({
        recovered: true,
        sessionID: "session-1",
        autoResume: true,
        errorType: "tool_result_missing",
      }),
    ).toBe(true);
  });

  it("does not send the outer resume prompt for thinking_block_order", () => {
    expect(
      shouldSendRecoveryResumePrompt?.({
        recovered: true,
        sessionID: "session-1",
        autoResume: true,
        errorType: "thinking_block_order",
      }),
    ).toBe(false);
  });

  it("does not send the outer resume prompt for thinking_disabled_violation", () => {
    expect(
      shouldSendRecoveryResumePrompt?.({
        recovered: true,
        sessionID: "session-1",
        autoResume: true,
        errorType: "thinking_disabled_violation",
      }),
    ).toBe(false);
  });

  it("does not send the outer resume prompt for missing or non-recoverable error types", () => {
    expect(
      shouldSendRecoveryResumePrompt?.({
        recovered: true,
        sessionID: "session-1",
        autoResume: true,
        errorType: null,
      }),
    ).toBe(false);

    expect(
      shouldSendRecoveryResumePrompt?.({
        recovered: false,
        sessionID: "session-1",
        autoResume: true,
        errorType: "tool_result_missing",
      }),
    ).toBe(false);

    expect(
      shouldSendRecoveryResumePrompt?.({
        recovered: true,
        sessionID: undefined,
        autoResume: true,
        errorType: "tool_result_missing",
      }),
    ).toBe(false);

    expect(
      shouldSendRecoveryResumePrompt?.({
        recovered: true,
        sessionID: "session-1",
        autoResume: false,
        errorType: "tool_result_missing",
      }),
    ).toBe(false);
  });
});
