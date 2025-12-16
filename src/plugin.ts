import { exec } from "node:child_process";
import { ANTIGRAVITY_ENDPOINT_FALLBACKS, ANTIGRAVITY_PROVIDER_ID } from "./constants";
import { authorizeAntigravity, exchangeAntigravity } from "./antigravity/oauth";
import type { AntigravityTokenExchangeResult } from "./antigravity/oauth";
import { accessTokenExpired, isOAuthAuth, parseRefreshParts } from "./plugin/auth";
import { promptAddAnotherAccount, promptProjectId } from "./plugin/cli";
import { ensureProjectContext } from "./plugin/project";
import { startAntigravityDebugRequest } from "./plugin/debug";
import {
  isGenerativeLanguageRequest,
  prepareAntigravityRequest,
  transformAntigravityResponse,
} from "./plugin/request";
import { AntigravityTokenRefreshError, refreshAccessToken } from "./plugin/token";
import { startOAuthListener, type OAuthListener } from "./plugin/server";
import { loadAccounts, saveAccounts } from "./plugin/storage";
import { AccountManager } from "./plugin/accounts";
import type {
  GetAuth,
  LoaderResult,
  PluginContext,
  PluginResult,
  ProjectContextResult,
  Provider,
} from "./plugin/types";

const MAX_OAUTH_ACCOUNTS = 10;

async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      exec(`open "${url}"`);
      return;
    }
    if (process.platform === "win32") {
      exec(`start "${url}"`);
      return;
    }
    exec(`xdg-open "${url}"`);
  } catch {
    // ignore
  }
}

async function promptOAuthCallbackValue(message: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

type OAuthCallbackParams = { code: string; state: string };

function getStateFromAuthorizationUrl(authorizationUrl: string): string {
  try {
    return new URL(authorizationUrl).searchParams.get("state") ?? "";
  } catch {
    return "";
  }
}

function extractOAuthCallbackParams(url: URL): OAuthCallbackParams | null {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return null;
  }
  return { code, state };
}

function parseOAuthCallbackInput(
  value: string,
  fallbackState: string,
): OAuthCallbackParams | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: "Missing authorization code" };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? fallbackState;

    if (!code) {
      return { error: "Missing code in callback URL" };
    }
    if (!state) {
      return { error: "Missing state in callback URL" };
    }

    return { code, state };
  } catch {
    if (!fallbackState) {
      return { error: "Missing state. Paste the full redirect URL instead of only the code." };
    }

    return { code: trimmed, state: fallbackState };
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function persistAccountPool(
  results: Array<Extract<AntigravityTokenExchangeResult, { type: "success" }>>,
): Promise<void> {
  if (results.length === 0) {
    return;
  }

  const now = Date.now();
  const stored = await loadAccounts();
  const accounts = stored?.accounts ? [...stored.accounts] : [];

  const indexByRefreshToken = new Map<string, number>();
  for (let i = 0; i < accounts.length; i++) {
    const token = accounts[i]?.refreshToken;
    if (token) {
      indexByRefreshToken.set(token, i);
    }
  }

  for (const result of results) {
    const parts = parseRefreshParts(result.refresh);
    if (!parts.refreshToken) {
      continue;
    }

    const existingIndex = indexByRefreshToken.get(parts.refreshToken);
    if (existingIndex === undefined) {
      indexByRefreshToken.set(parts.refreshToken, accounts.length);
      accounts.push({
        email: result.email,
        refreshToken: parts.refreshToken,
        projectId: parts.projectId,
        managedProjectId: parts.managedProjectId,
        addedAt: now,
        lastUsed: now,
        isRateLimited: false,
        rateLimitResetTime: 0,
      });
      continue;
    }

    const existing = accounts[existingIndex];
    if (!existing) {
      continue;
    }

    accounts[existingIndex] = {
      ...existing,
      email: result.email ?? existing.email,
      projectId: parts.projectId ?? existing.projectId,
      managedProjectId: parts.managedProjectId ?? existing.managedProjectId,
      lastUsed: now,
    };
  }

  if (accounts.length === 0) {
    return;
  }

  const activeIndex =
    typeof stored?.activeIndex === "number" && Number.isFinite(stored.activeIndex) ? stored.activeIndex : 0;

  await saveAccounts({
    version: 1,
    accounts,
    activeIndex: clampInt(activeIndex, 0, accounts.length - 1),
  });
}

function retryAfterMsFromResponse(response: Response): number {
  const retryAfterMsHeader = response.headers.get("retry-after-ms");
  if (retryAfterMsHeader) {
    const parsed = Number.parseInt(retryAfterMsHeader, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const parsed = Number.parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed * 1000;
    }
  }

  return 60_000;
}

/**
 * Creates an Antigravity OAuth plugin for a specific provider ID.
 */
export const createAntigravityPlugin = (providerId: string) => async (
  { client }: PluginContext,
): Promise<PluginResult> => ({
  auth: {
    provider: providerId,
    loader: async (getAuth: GetAuth, provider: Provider): Promise<LoaderResult | null> => {
      const auth = await getAuth();
      if (!isOAuthAuth(auth)) {
        return null;
      }

      const accountManager = await AccountManager.loadFromDisk(auth);
      if (accountManager.getAccountCount() > 0) {
        try {
          await accountManager.saveToDisk();
        } catch (error) {
          console.error("[opencode-antigravity-auth] Failed to persist initial account pool:", error);
        }
      }

      if (provider.models) {
        for (const model of Object.values(provider.models)) {
          if (model) {
            model.cost = { input: 0, output: 0 };
          }
        }
      }

      return {
        apiKey: "",
        async fetch(input, init) {
          // If the request is for the *other* provider, we might still want to intercept if URL matches
          // But strict compliance means we only handle requests if the auth provider matches.
          // Since loader is instantiated per provider, we are good.

          if (!isGenerativeLanguageRequest(input)) {
            return fetch(input, init);
          }

          const latestAuth = await getAuth();
          if (!isOAuthAuth(latestAuth)) {
            return fetch(input, init);
          }

          const accountCount = accountManager.getAccountCount();
          if (accountCount === 0) {
            throw new Error("No Antigravity accounts configured. Run `opencode auth login`.");
          }

          type FailureContext = {
            response: Response;
            streaming: boolean;
            debugContext: ReturnType<typeof startAntigravityDebugRequest>;
            requestedModel?: string;
            projectId?: string;
            endpoint?: string;
            effectiveModel?: string;
            toolDebugMissing?: number;
            toolDebugSummary?: string;
            toolDebugPayload?: string;
          };

          let lastFailure: FailureContext | null = null;
          let lastError: Error | null = null;

          accountLoop: for (let attempt = 0; attempt < accountCount; attempt++) {
            const account = accountManager.pickNext();
            if (!account) {
              const waitMs = accountManager.getMinWaitTimeMs();
              const waitSec = Math.max(1, Math.ceil(waitMs / 1000));
              throw new Error(
                `All ${accountManager.getAccountCount()} account(s) are rate-limited. Retry in ${waitSec}s or add more accounts via 'opencode auth login'.`,
              );
            }

            try {
              await accountManager.saveToDisk();
            } catch (error) {
              console.error("[opencode-antigravity-auth] Failed to persist rotation state:", error);
            }

            let authRecord = accountManager.toAuthDetails(account);

            if (accessTokenExpired(authRecord)) {
              try {
                const refreshed = await refreshAccessToken(authRecord, client, providerId);
                if (!refreshed) {
                  lastError = new Error("Antigravity token refresh failed");
                  continue;
                }
                accountManager.updateFromAuth(account, refreshed);
                authRecord = refreshed;
                try {
                  await accountManager.saveToDisk();
                } catch (error) {
                  console.error("[opencode-antigravity-auth] Failed to persist refreshed auth:", error);
                }
              } catch (error) {
                if (error instanceof AntigravityTokenRefreshError && error.code === "invalid_grant") {
                  const removed = accountManager.removeAccount(account);
                  if (removed) {
                    console.warn(
                      "[opencode-antigravity-auth] Removed revoked account from pool. Reauthenticate it via `opencode auth login` to add it back.",
                    );
                    try {
                      await accountManager.saveToDisk();
                    } catch (persistError) {
                      console.error(
                        "[opencode-antigravity-auth] Failed to persist revoked account removal:",
                        persistError,
                      );
                    }
                  }

                  if (accountManager.getAccountCount() === 0) {
                    try {
                      await client.auth.set({
                        path: { id: providerId },
                        body: { type: "oauth", refresh: "" },
                      });
                    } catch (storeError) {
                      console.error("Failed to clear stored Antigravity OAuth credentials:", storeError);
                    }

                    throw new Error(
                      "All Antigravity accounts have invalid refresh tokens. Run `opencode auth login` and reauthenticate.",
                    );
                  }

                  lastError = error;
                  continue;
                }

                lastError = error instanceof Error ? error : new Error(String(error));
                continue;
              }
            }

            const accessToken = authRecord.access;
            if (!accessToken) {
              lastError = new Error("Missing access token");
              continue;
            }

            let projectContext: ProjectContextResult;
            try {
              projectContext = await ensureProjectContext(authRecord);
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              continue;
            }

            if (projectContext.auth !== authRecord) {
              accountManager.updateFromAuth(account, projectContext.auth);
              authRecord = projectContext.auth;
              try {
                await accountManager.saveToDisk();
              } catch (error) {
                console.error("[opencode-antigravity-auth] Failed to persist project context:", error);
              }
            }

            for (let i = 0; i < ANTIGRAVITY_ENDPOINT_FALLBACKS.length; i++) {
              const currentEndpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[i];

              try {
                const prepared = prepareAntigravityRequest(
                  input,
                  init,
                  accessToken,
                  projectContext.effectiveProjectId,
                  currentEndpoint,
                );

                const originalUrl = toUrlString(input);
                const resolvedUrl = toUrlString(prepared.request);
                const debugContext = startAntigravityDebugRequest({
                  originalUrl,
                  resolvedUrl,
                  method: prepared.init.method,
                  headers: prepared.init.headers,
                  body: prepared.init.body,
                  streaming: prepared.streaming,
                  projectId: projectContext.effectiveProjectId,
                });

                const response = await fetch(prepared.request, prepared.init);

                if (response.status === 429 && accountManager.getAccountCount() > 1) {
                  const retryAfterMs = retryAfterMsFromResponse(response);
                  accountManager.markRateLimited(account, retryAfterMs);
                  try {
                    await accountManager.saveToDisk();
                  } catch (error) {
                    console.error("[opencode-antigravity-auth] Failed to persist rate-limit state:", error);
                  }

                  lastFailure = {
                    response,
                    streaming: prepared.streaming,
                    debugContext,
                    requestedModel: prepared.requestedModel,
                    projectId: prepared.projectId,
                    endpoint: prepared.endpoint,
                    effectiveModel: prepared.effectiveModel,
                    toolDebugMissing: prepared.toolDebugMissing,
                    toolDebugSummary: prepared.toolDebugSummary,
                    toolDebugPayload: prepared.toolDebugPayload,
                  };

                  continue accountLoop;
                }

                const shouldRetry = (
                  response.status === 403 ||
                  response.status === 404 ||
                  (response.status === 429 && accountManager.getAccountCount() <= 1) ||
                  response.status >= 500
                );

                if (shouldRetry && i < ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1) {
                  lastFailure = {
                    response,
                    streaming: prepared.streaming,
                    debugContext,
                    requestedModel: prepared.requestedModel,
                    projectId: prepared.projectId,
                    endpoint: prepared.endpoint,
                    effectiveModel: prepared.effectiveModel,
                    toolDebugMissing: prepared.toolDebugMissing,
                    toolDebugSummary: prepared.toolDebugSummary,
                    toolDebugPayload: prepared.toolDebugPayload,
                  };
                  continue;
                }

                return transformAntigravityResponse(
                  response,
                  prepared.streaming,
                  debugContext,
                  prepared.requestedModel,
                  prepared.projectId,
                  prepared.endpoint,
                  prepared.effectiveModel,
                  prepared.toolDebugMissing,
                  prepared.toolDebugSummary,
                  prepared.toolDebugPayload,
                );
              } catch (error) {
                if (i < ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1) {
                  lastError = error instanceof Error ? error : new Error(String(error));
                  continue;
                }

                lastError = error instanceof Error ? error : new Error(String(error));
                continue accountLoop;
              }
            }
          }

          if (lastFailure) {
            return transformAntigravityResponse(
              lastFailure.response,
              lastFailure.streaming,
              lastFailure.debugContext,
              lastFailure.requestedModel,
              lastFailure.projectId,
              lastFailure.endpoint,
              lastFailure.effectiveModel,
              lastFailure.toolDebugMissing,
              lastFailure.toolDebugSummary,
              lastFailure.toolDebugPayload,
            );
          }

          throw lastError || new Error("All Antigravity accounts failed");
        },
      };
    },
    methods: [
      {
        label: "OAuth with Google (Antigravity)",
        type: "oauth",
        authorize: async (inputs) => {
          const isHeadless = !!(
            process.env.SSH_CONNECTION ||
            process.env.SSH_CLIENT ||
            process.env.SSH_TTY ||
            process.env.OPENCODE_HEADLESS
          );

          // CLI flow (`opencode auth login`) passes an inputs object.
          if (inputs) {
            const accounts: Array<Extract<AntigravityTokenExchangeResult, { type: "success" }>> = [];

            while (accounts.length < MAX_OAUTH_ACCOUNTS) {
              console.log(`\n=== Antigravity OAuth (Account ${accounts.length + 1}) ===`);

              const projectId = await promptProjectId();

              const result = await (async (): Promise<AntigravityTokenExchangeResult> => {
                let listener: OAuthListener | null = null;
                if (!isHeadless) {
                  try {
                    listener = await startOAuthListener();
                  } catch {
                    listener = null;
                  }
                }

                const authorization = await authorizeAntigravity(projectId);
                const fallbackState = getStateFromAuthorizationUrl(authorization.url);

                console.log("\nOAuth URL:\n" + authorization.url + "\n");

                if (!isHeadless) {
                  await openBrowser(authorization.url);
                }

                if (listener) {
                  try {
                    const callbackUrl = await listener.waitForCallback();
                    const params = extractOAuthCallbackParams(callbackUrl);
                    if (!params) {
                      return { type: "failed", error: "Missing code or state in callback URL" };
                    }

                    return exchangeAntigravity(params.code, params.state);
                  } catch (error) {
                    return {
                      type: "failed",
                      error: error instanceof Error ? error.message : "Unknown error",
                    };
                  } finally {
                    try {
                      await listener.close();
                    } catch {
                      // ignore
                    }
                  }
                }

                console.log("1. Open the URL below in your browser and complete Google sign-in.");
                console.log(
                  "2. After approving, copy the full redirected localhost URL from the address bar.",
                );
                console.log("3. Paste it back here.");

                const callbackInput = await promptOAuthCallbackValue(
                  "Paste the redirect URL (or just the code) here: ",
                );
                const params = parseOAuthCallbackInput(callbackInput, fallbackState);
                if ("error" in params) {
                  return { type: "failed", error: params.error };
                }

                return exchangeAntigravity(params.code, params.state);
              })();

              if (result.type === "failed") {
                if (accounts.length === 0) {
                  return {
                    url: "",
                    instructions: `Authentication failed: ${result.error}`,
                    method: "auto",
                    callback: async () => result,
                  };
                }

                console.warn(
                  `[opencode-antigravity-auth] Skipping failed account ${accounts.length + 1}: ${result.error}`,
                );
                break;
              }

              accounts.push(result);

              try {
                await persistAccountPool([result]);
              } catch {
                // ignore
              }

              if (accounts.length >= MAX_OAUTH_ACCOUNTS) {
                break;
              }

              const addAnother = await promptAddAnotherAccount(accounts.length);
              if (!addAnother) {
                break;
              }
            }

            const primary = accounts[0];
            if (!primary) {
              return {
                url: "",
                instructions: "Authentication cancelled",
                method: "auto",
                callback: async () => ({ type: "failed", error: "Authentication cancelled" }),
              };
            }

            return {
              url: "",
              instructions: `Multi-account setup complete (${accounts.length} account(s)).`,
              method: "auto",
              callback: async (): Promise<AntigravityTokenExchangeResult> => primary,
            };
          }

          // TUI flow (`/connect`) does not support per-account prompts yet.
          const projectId = "";

          let listener: OAuthListener | null = null;
          if (!isHeadless) {
            try {
              listener = await startOAuthListener();
            } catch {
              listener = null;
            }
          }

          const authorization = await authorizeAntigravity(projectId);
          const fallbackState = getStateFromAuthorizationUrl(authorization.url);

          if (!isHeadless) {
            await openBrowser(authorization.url);
          }

          if (listener) {
            return {
              url: authorization.url,
              instructions:
                "Complete sign-in in your browser. We'll automatically detect the redirect back to localhost.",
              method: "auto",
              callback: async (): Promise<AntigravityTokenExchangeResult> => {
                try {
                  const callbackUrl = await listener.waitForCallback();
                  const params = extractOAuthCallbackParams(callbackUrl);
                  if (!params) {
                    return { type: "failed", error: "Missing code or state in callback URL" };
                  }

                  const result = await exchangeAntigravity(params.code, params.state);
                  if (result.type === "success") {
                    try {
                      await persistAccountPool([result]);
                    } catch {
                      // ignore
                    }
                  }

                  return result;
                } catch (error) {
                  return {
                    type: "failed",
                    error: error instanceof Error ? error.message : "Unknown error",
                  };
                } finally {
                  try {
                    await listener.close();
                  } catch {
                    // ignore
                  }
                }
              },
            };
          }

          return {
            url: authorization.url,
            instructions:
              "Visit the URL above, complete OAuth, then paste either the full redirect URL or the authorization code.",
            method: "code",
            callback: async (codeInput: string): Promise<AntigravityTokenExchangeResult> => {
              const params = parseOAuthCallbackInput(codeInput, fallbackState);
              if ("error" in params) {
                return { type: "failed", error: params.error };
              }

              const result = await exchangeAntigravity(params.code, params.state);
              if (result.type === "success") {
                try {
                  await persistAccountPool([result]);
                } catch {
                  // ignore
                }
              }

              return result;
            },
          };
        },
      },
      {
        provider: providerId,
        label: "Manually enter API Key",
        type: "api",
      },
    ],
  },
});

export const AntigravityCLIOAuthPlugin = createAntigravityPlugin(ANTIGRAVITY_PROVIDER_ID);
export const GoogleOAuthPlugin = AntigravityCLIOAuthPlugin;

function toUrlString(value: RequestInfo): string {
  if (typeof value === "string") {
    return value;
  }
  const candidate = (value as Request).url;
  if (candidate) {
    return candidate;
  }
  return value.toString();
}
