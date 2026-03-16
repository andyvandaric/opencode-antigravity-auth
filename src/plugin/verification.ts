/**
 * Account verification probe.
 *
 * Handles detecting whether a Google account requires additional verification
 * (e.g. CAPTCHA, TOS acceptance) before it can be used for API calls.
 */

import {
  ANTIGRAVITY_ENDPOINT_PROD,
  getAntigravityHeaders,
} from "../constants";
import { parseRefreshParts, formatRefreshParts } from "./auth";
import { AntigravityTokenRefreshError, refreshAccessToken } from "./token";
import type { PluginClient } from "./types";

export type VerificationRequiredType =
  | "gemini-cli"
  | "api-enable"
  | "google-account"
  | "unknown";

export type VerificationProbeResult = {
  status: "ok" | "blocked" | "error";
  message: string;
  verifyUrl?: string;
  verificationRequiredType?: VerificationRequiredType;
};

export type VerificationStoredAccount = {
  enabled?: boolean;
  verificationRequired?: boolean;
  verificationRequiredAt?: number;
  verificationRequiredReason?: string;
  verificationRequiredType?: VerificationRequiredType;
  verificationUrl?: string;
};

// ── Text helpers ──────────────────────────────────────────────────

function decodeEscapedText(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function normalizeGoogleVerificationUrl(rawUrl: string): string | undefined {
  const normalized = decodeEscapedText(rawUrl).trim();
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname !== "accounts.google.com") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function selectBestVerificationUrl(urls: string[]): string | undefined {
  const unique = Array.from(
    new Set(
      urls
        .map((url) => normalizeGoogleVerificationUrl(url))
        .filter(Boolean) as string[],
    ),
  );
  if (unique.length === 0) return undefined;
  unique.sort((a, b) => {
    const score = (value: string): number => {
      let total = 0;
      if (value.includes("plt=")) total += 4;
      if (value.includes("/signin/continue")) total += 3;
      if (value.includes("continue=")) total += 2;
      if (value.includes("service=cloudcode")) total += 1;
      return total;
    };
    return score(b) - score(a);
  });
  return unique[0];
}

// ── Error detail extraction ───────────────────────────────────────

export function extractVerificationErrorDetails(bodyText: string): {
  validationRequired: boolean;
  message?: string;
  verifyUrl?: string;
  verificationRequiredType?: VerificationRequiredType;
} {
  const decodedBody = decodeEscapedText(bodyText);
  const lowerBody = decodedBody.toLowerCase();
  let validationRequired = lowerBody.includes("validation_required");
  let message: string | undefined;
  const verificationUrls = new Set<string>();

  const collectUrlsFromText = (text: string): void => {
    for (const match of text.matchAll(
      /https:\/\/accounts\.google\.com\/[^\s"'<>]+/gi,
    )) {
      if (match[0]) verificationUrls.add(match[0]);
    }
  };

  collectUrlsFromText(decodedBody);

  const payloads: unknown[] = [];
  const trimmed = decodedBody.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      payloads.push(JSON.parse(trimmed));
    } catch {}
  }

  for (const rawLine of decodedBody.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payloadText = line.slice(5).trim();
    if (!payloadText || payloadText === "[DONE]") continue;
    try {
      payloads.push(JSON.parse(payloadText));
    } catch {
      collectUrlsFromText(payloadText);
    }
  }

  const visited = new Set<unknown>();
  const walk = (value: unknown, key?: string): void => {
    if (typeof value === "string") {
      const normalizedValue = decodeEscapedText(value);
      const lowerValue = normalizedValue.toLowerCase();
      const lowerKey = key?.toLowerCase() ?? "";

      if (lowerValue.includes("validation_required")) validationRequired = true;
      if (
        !message &&
        (lowerKey.includes("message") ||
          lowerKey.includes("detail") ||
          lowerKey.includes("description"))
      ) {
        message = normalizedValue;
      }
      if (
        lowerKey.includes("validation_url") ||
        lowerKey.includes("verify_url") ||
        lowerKey.includes("verification_url") ||
        lowerKey === "url"
      ) {
        verificationUrls.add(normalizedValue);
      }
      collectUrlsFromText(normalizedValue);
      return;
    }

    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      walk(childValue, childKey);
    }
  };

  for (const payload of payloads) walk(payload);

  if (!validationRequired) {
    validationRequired =
      lowerBody.includes("verification required") ||
      lowerBody.includes("verify your account") ||
      lowerBody.includes("account verification");
  }

  if (!message) {
    const fallback = decodedBody
      .split("\n")
      .map((line) => line.trim())
      .find(
        (line) =>
          line &&
          !line.startsWith("data:") &&
          /(verify|validation|required)/i.test(line),
      );
    if (fallback) message = fallback;
  }

  const bestVerifyUrl = selectBestVerificationUrl([...verificationUrls]);
  let verificationRequiredType: VerificationRequiredType = "unknown";

  const lowerVerifyUrl = bestVerifyUrl?.toLowerCase() ?? "";
  if (
    lowerBody.includes("gemini") ||
    lowerBody.includes("gemini-cli") ||
    lowerVerifyUrl.includes("gemini")
  ) {
    verificationRequiredType = "gemini-cli";
  } else if (lowerBody.includes("api.enable") || lowerBody.includes("enable")) {
    verificationRequiredType = "api-enable";
  } else if (
    lowerBody.includes("accounts.google.com/o/oauth2") ||
    lowerVerifyUrl.includes("accounts.google.com/o/oauth2")
  ) {
    verificationRequiredType = "google-account";
  }

  return {
    validationRequired,
    message,
    verifyUrl: bestVerifyUrl,
    verificationRequiredType: validationRequired
      ? verificationRequiredType
      : undefined,
  };
}

// ── Verification probe ────────────────────────────────────────────

export async function verifyAccountAccess(
  account: {
    refreshToken: string;
    email?: string;
    projectId?: string;
    managedProjectId?: string;
  },
  client: PluginClient,
  providerId: string,
): Promise<VerificationProbeResult> {
  const parsed = parseRefreshParts(account.refreshToken);
  if (!parsed.refreshToken) {
    return { status: "error", message: "Missing refresh token for selected account." };
  }

  const auth = {
    type: "oauth" as const,
    refresh: formatRefreshParts({
      refreshToken: parsed.refreshToken,
      projectId: parsed.projectId ?? account.projectId,
      managedProjectId: parsed.managedProjectId ?? account.managedProjectId,
    }),
    access: "",
    expires: 0,
  };

  let refreshedAuth: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    refreshedAuth = await refreshAccessToken(auth, client, providerId);
  } catch (error) {
    if (error instanceof AntigravityTokenRefreshError) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: `Token refresh failed: ${String(error)}` };
  }

  if (!refreshedAuth?.access) {
    return { status: "error", message: "Could not refresh access token for this account." };
  }

  const projectId =
    parsed.managedProjectId ??
    parsed.projectId ??
    account.managedProjectId ??
    account.projectId;

  const headers: Record<string, string> = {
    ...getAntigravityHeaders(),
    Authorization: `Bearer ${refreshedAuth.access}`,
    "Content-Type": "application/json",
  };
  if (projectId) headers["x-goog-user-project"] = projectId;

  const requestBody = {
    model: "gemini-3-flash",
    request: {
      model: "gemini-3-flash",
      contents: [{ role: "user", parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 1, temperature: 0 },
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  let response: Response;
  try {
    response = await fetch(
      `${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:streamGenerateContent?alt=sse`,
      { method: "POST", headers, body: JSON.stringify(requestBody), signal: controller.signal },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "error", message: "Verification check timed out." };
    }
    return { status: "error", message: `Verification check failed: ${String(error)}` };
  } finally {
    clearTimeout(timeoutId);
  }

  let responseBody = "";
  try {
    responseBody = await response.text();
  } catch {
    responseBody = "";
  }

  if (response.ok) return { status: "ok", message: "Account verification check passed." };

  const extracted = extractVerificationErrorDetails(responseBody);
  if (response.status === 403 && extracted.validationRequired) {
    return {
      status: "blocked",
      message: extracted.message ?? "Google requires additional account verification.",
      verifyUrl: extracted.verifyUrl,
      verificationRequiredType: extracted.verificationRequiredType,
    };
  }

  return {
    status: "error",
    message: extracted.message ?? `Request failed (${response.status} ${response.statusText}).`,
  };
}

// ── Stored account verification state helpers ─────────────────────

export function markStoredAccountVerificationRequired(
  account: VerificationStoredAccount,
  reason: string,
  verifyUrl?: string,
  verificationRequiredType?: VerificationRequiredType,
): boolean {
  let changed = false;
  const wasVerificationRequired = account.verificationRequired === true;

  if (!wasVerificationRequired) { account.verificationRequired = true; changed = true; }
  if (!wasVerificationRequired || account.verificationRequiredAt === undefined) {
    account.verificationRequiredAt = Date.now(); changed = true;
  }

  const normalizedReason = reason.trim();
  if (account.verificationRequiredReason !== normalizedReason) {
    account.verificationRequiredReason = normalizedReason; changed = true;
  }

  const normalizedUrl = verifyUrl?.trim();
  if (normalizedUrl && account.verificationUrl !== normalizedUrl) {
    account.verificationUrl = normalizedUrl; changed = true;
  }

  if (account.verificationRequiredType !== verificationRequiredType) {
    account.verificationRequiredType = verificationRequiredType; changed = true;
  }

  if (account.enabled !== false) { account.enabled = false; changed = true; }
  return changed;
}

export function clearStoredAccountVerificationRequired(
  account: VerificationStoredAccount,
  enableIfRequired = false,
): { changed: boolean; wasVerificationRequired: boolean } {
  const wasVerificationRequired = account.verificationRequired === true;
  let changed = false;

  if (account.verificationRequired !== false) { account.verificationRequired = false; changed = true; }
  if (account.verificationRequiredAt !== undefined) { account.verificationRequiredAt = undefined; changed = true; }
  if (account.verificationRequiredReason !== undefined) { account.verificationRequiredReason = undefined; changed = true; }
  if (account.verificationUrl !== undefined) { account.verificationUrl = undefined; changed = true; }

  if (enableIfRequired && wasVerificationRequired && account.enabled === false) {
    account.enabled = true; changed = true;
  }

  return { changed, wasVerificationRequired };
}
