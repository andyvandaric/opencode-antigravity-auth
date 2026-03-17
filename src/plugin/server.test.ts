import { afterEach, describe, expect, it } from "vitest";
import { startOAuthListener } from "./server";

afterEach(() => {
  process.env.OPENCODE_ANTIGRAVITY_OAUTH_BIND = "";
});

describe("startOAuthListener", () => {
  it("listens on a custom redirect uri for Gemini CLI OAuth", async () => {
    const port = 52000 + Math.floor(Math.random() * 1000);
    const redirectUri = `http://127.0.0.1:${port}/oauth-callback`;
    const listener = await startOAuthListener({
      redirectUri,
      timeoutMs: 2000,
    });

    const callbackPromise = listener.waitForCallback();
    const response = await fetch(
      `${redirectUri}?code=test-code&state=test-state`,
    );
    const callbackUrl = await callbackPromise;

    expect(response.ok).toBe(true);
    expect(callbackUrl.origin).toBe(`http://127.0.0.1:${port}`);
    expect(callbackUrl.pathname).toBe("/oauth-callback");
    expect(callbackUrl.searchParams.get("code")).toBe("test-code");
    expect(callbackUrl.searchParams.get("state")).toBe("test-state");

    await listener.close();
  });
});
