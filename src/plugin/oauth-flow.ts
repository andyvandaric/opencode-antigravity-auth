/**
 * OAuth login/callback flow helpers.
 *
 * Handles manual code-paste fallback, URL parsing, and redirect-URI
 * resolution for both Antigravity and Gemini CLI OAuth flows.
 */

import { GEMINI_CLI_REDIRECT_URI } from "../constants";
import {
  exchangeAntigravity,
  exchangeGeminiCli,
} from "../antigravity/oauth";
import type { AntigravityTokenExchangeResult } from "../antigravity/oauth";

export type OAuthCallbackParams = { code: string; state: string };

// ── URL / state helpers ───────────────────────────────────────────

export function getStateFromAuthorizationUrl(authorizationUrl: string): string {
  try {
    return new URL(authorizationUrl).searchParams.get("state") ?? "";
  } catch {
    return "";
  }
}

export function getOAuthListenerRedirectUri(isGeminiCli: boolean): string | undefined {
  return isGeminiCli ? GEMINI_CLI_REDIRECT_URI : undefined;
}

export function extractOAuthCallbackParams(url: URL): OAuthCallbackParams | null {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return null;
  return { code, state };
}

export function parseOAuthCallbackInput(
  value: string,
  fallbackState: string,
): OAuthCallbackParams | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { error: "Missing authorization code" };

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? fallbackState;

    if (!code) return { error: "Missing code in callback URL" };
    if (!state) return { error: "Missing state in callback URL" };

    return { code, state };
  } catch {
    if (!fallbackState) {
      return {
        error: "Missing state. Paste the full redirect URL instead of only the code.",
      };
    }
    return { code: trimmed, state: fallbackState };
  }
}

// ── Readline prompt helpers ───────────────────────────────────────

export async function promptOAuthCallbackValue(message: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

export async function promptOpenVerificationUrl(): Promise<boolean> {
  const answer = (
    await promptOAuthCallbackValue("Open verification URL in your browser now? [Y/n]: ")
  )
    .trim()
    .toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}

export async function promptAccountIndexForVerification(
  accounts: Array<{ email?: string; index: number }>,
): Promise<number | undefined> {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log("\nSelect an account to verify:");
    for (const account of accounts) {
      const label = account.email || `Account ${account.index + 1}`;
      console.log(`  ${account.index + 1}. ${label}`);
    }
    console.log("");

    while (true) {
      const answer = (
        await rl.question("Account number (leave blank to cancel): ")
      ).trim();
      if (!answer) return undefined;
      const parsedIndex = Number(answer);
      if (!Number.isInteger(parsedIndex)) {
        console.log("Please enter a valid account number.");
        continue;
      }
      const normalizedIndex = parsedIndex - 1;
      const selected = accounts.find((a) => a.index === normalizedIndex);
      if (!selected) {
        console.log("Please enter a number from the list above.");
        continue;
      }
      return selected.index;
    }
  } finally {
    rl.close();
  }
}

// ── Manual OAuth code input ───────────────────────────────────────

export async function promptManualOAuthInput(
  fallbackState: string,
  isGeminiCli = false,
): Promise<AntigravityTokenExchangeResult> {
  console.log("1. Open the URL above in your browser and complete Google sign-in.");
  console.log("2. After approving, copy the full redirected localhost URL from the address bar.");
  console.log("3. Paste it back here.\n");

  const callbackInput = await promptOAuthCallbackValue(
    "Paste the redirect URL (or just the code) here: ",
  );
  const params = parseOAuthCallbackInput(callbackInput, fallbackState);
  if ("error" in params) {
    return { type: "failed", error: params.error };
  }

  return isGeminiCli
    ? exchangeGeminiCli(params.code, params.state)
    : exchangeAntigravity(params.code, params.state);
}
