import crypto from "node:crypto";
import {
  ANTIGRAVITY_ENDPOINT,
  GEMINI_CLI_ENDPOINT,
  GEMINI_CLI_HEADERS,
  EMPTY_SCHEMA_PLACEHOLDER_NAME,
  EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
  SKIP_THOUGHT_SIGNATURE,
  getRandomizedHeaders,
  type HeaderStyle,
} from "../constants";
import { cacheSignature, getCachedSignature } from "./cache";
import { getKeepThinking, isDebugTuiEnabled } from "./config";
import {
  createStreamingTransformer,
  transformSseLine,
  transformStreamingPayload,
} from "./core/streaming";
import { defaultSignatureStore } from "./stores/signature-store";
import {
  DEBUG_MESSAGE_PREFIX,
  isDebugEnabled,
  logAntigravityDebugResponse,
  logCacheStats,
  type AntigravityDebugContext,
} from "./debug";
import { createLogger } from "./logger";
import {
  DEFAULT_THINKING_BUDGET,
  deepFilterThinkingBlocks,
  extractVariantThinkingConfig,
  fixToolResponseGrouping,
  validateAndFixClaudeToolPairing,
  applyToolPairingFixes,
  createSyntheticErrorResponse,
  isThinkingCapableModel,
} from "./request-helpers";
import {
  ANTIGRAVITY_SYSTEM_INSTRUCTION,
} from "../constants";
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  needsThinkingRecovery,
} from "./thinking-recovery";
import { SUPPORTED_IMAGE_GENERATION_MODELS } from "./transform/model-resolver";
import { sanitizeCrossModelPayloadInPlace } from "./transform/cross-model-sanitizer";
import { isGemini3Model } from "./transform";
import {
  resolveModelForHeaderStyle,
  isClaudeModel,
  isClaudeThinkingModel,
  CLAUDE_THINKING_MAX_OUTPUT_TOKENS,
} from "./transform";
import { getSessionFingerprint, buildFingerprintHeaders, type Fingerprint } from "./fingerprint";
import type { GoogleSearchConfig } from "./transform/types";
import {
  isContentWithParts,
  isGeminiThinkingBoundaryPart,
  isGeminiToolUseBoundaryPart,
  isMessageWithContent,
  isRecord,
  isThinkingMessageBlock,
  hasBoundarySignature,
  type UnknownRecord,
} from "./types";
import { applyPrepareThinkingStage } from "./request-prepare-thinking";
import { applyPrepareToolsStage } from "./request-prepare-tools";
import {
  buildResponseDebugText,
  shouldTransformAntigravityBody,
  transformBufferedResponseStage,
  transformStreamingResponseStage,
} from "./request-response-stages";

const log = createLogger("request");

const PLUGIN_SESSION_ID = crypto.randomUUID();

const sessionDisplayedThinkingHashes = new Set<string>();
const SESSION_DISPLAYED_THINKING_HASHES_MAX_SIZE = 2000;

const MIN_SIGNATURE_LENGTH = 50;

function buildSignatureSessionKey(
  sessionId: string,
  model?: string,
  conversationKey?: string,
  projectKey?: string,
): string {
  const modelKey = typeof model === "string" && model.trim() ? model.toLowerCase() : "unknown";
  const projectPart = typeof projectKey === "string" && projectKey.trim()
    ? projectKey.trim()
    : "default";
  const conversationPart = typeof conversationKey === "string" && conversationKey.trim()
    ? conversationKey.trim()
    : "default";
  return `${sessionId}:${modelKey}:${projectPart}:${conversationPart}`;
}

function buildOpaqueSessionId(signatureSessionKey: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(signatureSessionKey, "utf8")
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}







function shouldCacheThinkingSignatures(model?: string): boolean {
  if (typeof model !== "string") return false;
  const lower = model.toLowerCase();
  // Both Claude and Gemini 3 models require thought signature caching
  // for multi-turn conversations with function calling
  return lower.includes("claude") || lower.includes("gemini-3");
}

function hashConversationSeed(seed: string): string {
  return crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 16);
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (typeof block.text === "string") {
      return block.text;
    }
    if (isRecord(block.text) && typeof block.text.text === "string") {
      return block.text.text;
    }
  }
  return "";
}

function extractConversationSeedFromMessages(messages: any[]): string {
  const system = messages.find((message) => message?.role === "system");
  const users = messages.filter((message) => message?.role === "user");
  const firstUser = users[0];
  const lastUser = users.length > 0 ? users[users.length - 1] : undefined;
  const systemText = system ? extractTextFromContent(system.content) : "";
  const userText = firstUser ? extractTextFromContent(firstUser.content) : "";
  const fallbackUserText = !userText && lastUser ? extractTextFromContent(lastUser.content) : "";
  return [systemText, userText || fallbackUserText].filter(Boolean).join("|");
}

function extractConversationSeedFromContents(contents: any[]): string {
  const users = contents.filter((content) => content?.role === "user");
  const firstUser = users[0];
  const lastUser = users.length > 0 ? users[users.length - 1] : undefined;
  const primaryUser = firstUser && Array.isArray(firstUser.parts) ? extractTextFromContent(firstUser.parts) : "";
  if (primaryUser) {
    return primaryUser;
  }
  if (lastUser && Array.isArray(lastUser.parts)) {
    return extractTextFromContent(lastUser.parts);
  }
  return "";
}

function resolveConversationKey(requestPayload: Record<string, unknown>): string | undefined {
  const anyPayload = requestPayload as UnknownRecord;
  const metadata = isRecord(anyPayload.metadata) ? anyPayload.metadata : undefined;
  const candidates = [
    anyPayload.conversationId,
    anyPayload.conversation_id,
    anyPayload.thread_id,
    anyPayload.threadId,
    anyPayload.chat_id,
    anyPayload.chatId,
    anyPayload.sessionId,
    anyPayload.session_id,
    metadata?.conversation_id,
    metadata?.conversationId,
    metadata?.thread_id,
    metadata?.threadId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const systemSeed = extractTextFromContent(
    (isRecord(anyPayload.systemInstruction) ? anyPayload.systemInstruction.parts : undefined)
    ?? anyPayload.systemInstruction
    ?? anyPayload.system
    ?? anyPayload.system_instruction,
  );
  const messageSeed = Array.isArray(anyPayload.messages)
    ? extractConversationSeedFromMessages(anyPayload.messages)
    : Array.isArray(anyPayload.contents)
      ? extractConversationSeedFromContents(anyPayload.contents)
      : "";
  const seed = [systemSeed, messageSeed].filter(Boolean).join("|");
  if (!seed) {
    return undefined;
  }
  return hashConversationSeed(seed);
}

function resolveConversationKeyFromRequests(requestObjects: Array<Record<string, unknown>>): string | undefined {
  for (const req of requestObjects) {
    const key = resolveConversationKey(req);
    if (key) {
      return key;
    }
  }
  return undefined;
}

function resolveProjectKey(candidate?: unknown, fallback?: string): string | undefined {
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim();
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  return undefined;
}

function formatDebugLinesForThinking(lines: string[]): string {
  const cleaned = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-50);
  return `${DEBUG_MESSAGE_PREFIX}\n${cleaned.map((line) => `- ${line}`).join("\n")}`;
}

function injectDebugThinking(response: unknown, debugText: string): unknown {
  if (!response || typeof response !== "object") {
    return response;
  }

  const resp = response as Record<string, unknown>;

  if (Array.isArray(resp.candidates) && resp.candidates.length > 0) {
    const candidates = resp.candidates.slice();
    const first = candidates[0];

    if (isRecord(first) && isRecord(first.content) && Array.isArray(first.content.parts)) {
      const parts = [{ thought: true, text: debugText }, ...first.content.parts];
      candidates[0] = { ...first, content: { ...first.content, parts } };
      return { ...resp, candidates };
    }

    return resp;
  }

  if (Array.isArray(resp.content)) {
    const content = [{ type: "thinking", thinking: debugText }, ...resp.content];
    return { ...resp, content };
  }

  if (!resp.reasoning_content) {
    return { ...resp, reasoning_content: debugText };
  }

  return resp;
}

/**
 * Synthetic thinking placeholder text used when keep_thinking=true but debug mode is off.
 * Injected via the same path as debug text (injectDebugThinking) to ensure consistent
 * signature caching and multi-turn handling.
 */
const SYNTHETIC_THINKING_PLACEHOLDER = "[Thinking preserved]\n";

function stripInjectedDebugFromParts(parts: unknown): unknown {
  if (!Array.isArray(parts)) {
    return parts;
  }

  return parts.filter((part) => {
    if (!isRecord(part)) {
      return true;
    }
    const text =
      typeof part.text === "string"
        ? part.text
        : typeof part.thinking === "string"
          ? part.thinking
          : undefined;

    // Strip debug blocks and synthetic thinking placeholders
    if (text && (text.startsWith(DEBUG_MESSAGE_PREFIX) || text.startsWith(SYNTHETIC_THINKING_PLACEHOLDER.trim()))) {
      return false;
    }

    return true;
  });
}

function stripInjectedDebugFromRequestPayload(payload: Record<string, unknown>): void {
  const anyPayload = payload as UnknownRecord;

  if (Array.isArray(anyPayload.contents)) {
    anyPayload.contents = anyPayload.contents.map((content) => {
      if (!isRecord(content)) {
        return content;
      }

      if (isContentWithParts(content)) {
        return { ...content, parts: stripInjectedDebugFromParts(content.parts) };
      }

      if (isMessageWithContent(content)) {
        return { ...content, content: stripInjectedDebugFromParts(content.content) };
      }

      return content;
    });
  }

  if (Array.isArray(anyPayload.messages)) {
    anyPayload.messages = anyPayload.messages.map((message) => {
      if (!isRecord(message)) {
        return message;
      }

      if (isMessageWithContent(message)) {
        return { ...message, content: stripInjectedDebugFromParts(message.content) };
      }

      return message;
    });
  }
}

function isGeminiToolUsePart(part: unknown): boolean {
  return isGeminiToolUseBoundaryPart(part);
}

function isGeminiThinkingPart(part: unknown): boolean {
  return isGeminiThinkingBoundaryPart(part);
}

// Sentinel value used when signature recovery fails - allows Claude to handle gracefully
// by redacting the thinking block instead of rejecting the request entirely.
// Reference: LLM-API-Key-Proxy uses this pattern for Gemini 3 tool calls.
const SENTINEL_SIGNATURE = "skip_thought_signature_validator";

export function ensureThoughtSignature<T>(part: T, sessionId: string): T {
  if (!isRecord(part)) {
    return part;
  }

  const text = typeof part.text === "string" ? part.text : typeof part.thinking === "string" ? part.thinking : "";
  if (!text) {
    return part;
  }

  if (part.thought === true) {
    if (!part.thoughtSignature) {
      const cached = getCachedSignature(sessionId, text);
      if (cached) {
        return { ...part, thoughtSignature: cached };
      }
      // Fallback: use sentinel signature to prevent API rejection
      // This allows Claude to redact the thinking block instead of failing
      return { ...part, thoughtSignature: SENTINEL_SIGNATURE };
    }
    return part;
  }

  if ((part.type === "thinking" || part.type === "reasoning") && !part.signature) {
    const cached = getCachedSignature(sessionId, text);
    if (cached) {
      return { ...part, signature: cached };
    }
    // Fallback: use sentinel signature to prevent API rejection
    return { ...part, signature: SENTINEL_SIGNATURE };
  }

  return part;
}

function hasSignedThinkingPart(part: unknown): boolean {
  return hasBoundarySignature(part, MIN_SIGNATURE_LENGTH);
}

function ensureThinkingBeforeToolUseInContents(contents: any[], signatureSessionKey: string): any[] {
  return contents.map((content: unknown) => {
    if (!isContentWithParts(content)) {
      return content;
    }

    const role = content.role;
    if (role !== "model" && role !== "assistant") {
      return content;
    }

    const parts = content.parts;
    const hasToolUse = parts.some(isGeminiToolUsePart);
    if (!hasToolUse) {
      return content;
    }

    const thinkingParts = parts.filter(isGeminiThinkingPart).map((p) => ensureThoughtSignature(p, signatureSessionKey));
    const otherParts = parts.filter((p) => !isGeminiThinkingPart(p));
    const hasSignedThinking = thinkingParts.some(hasSignedThinkingPart);

    if (hasSignedThinking) {
      return { ...content, parts: [...thinkingParts, ...otherParts] };
    }

    const lastThinking = defaultSignatureStore.get(signatureSessionKey);
    if (!lastThinking) {
      // No cached signature available - strip thinking blocks entirely
      // Claude requires valid signatures, and we can't fake them
      // Return only tool_use parts without any thinking to avoid signature validation errors
      log.debug("Stripping thinking from tool_use content (no valid cached signature)", { signatureSessionKey });
      return { ...content, parts: otherParts };
    }

    const injected = {
      thought: true,
      text: lastThinking.text,
      thoughtSignature: lastThinking.signature,
    };

    return { ...content, parts: [injected, ...otherParts] };
  });
}

function ensureMessageThinkingSignature(block: any, sessionId: string): any {
  if (!isRecord(block)) {
    return block;
  }

  if (!isThinkingMessageBlock(block)) {
    return block;
  }

  if (typeof block.signature === "string" && block.signature.length >= MIN_SIGNATURE_LENGTH) {
    return block;
  }

  const text = typeof block.thinking === "string" ? block.thinking : typeof block.text === "string" ? block.text : "";
  if (!text) {
    return block;
  }

  const cached = getCachedSignature(sessionId, text);
  if (cached) {
    return { ...block, signature: cached };
  }

  return block;
}

function hasToolUseInContents(contents: any[]): boolean {
  return contents.some((content: unknown) => {
    if (!isContentWithParts(content)) {
      return false;
    }
    return content.parts.some(isGeminiToolUsePart);
  });
}

function hasSignedThinkingInContents(contents: any[]): boolean {
  return contents.some((content: unknown) => {
    if (!isContentWithParts(content)) {
      return false;
    }
    return content.parts.some(hasSignedThinkingPart);
  });
}

function hasToolUseInMessages(messages: any[]): boolean {
  return messages.some((message: unknown) => {
    if (!isMessageWithContent(message)) {
      return false;
    }
    return message.content.some(
      (block) => isRecord(block) && (block.type === "tool_use" || block.type === "tool_result"),
    );
  });
}

function hasSignedThinkingInMessages(messages: any[]): boolean {
  return messages.some((message: unknown) => {
    if (!isMessageWithContent(message)) {
      return false;
    }
    return message.content.some(
      (block) => isThinkingMessageBlock(block) && hasBoundarySignature(block, MIN_SIGNATURE_LENGTH),
    );
  });
}

function ensureThinkingBeforeToolUseInMessages(messages: any[], signatureSessionKey: string): any[] {
  return messages.map((message: unknown) => {
    if (!isMessageWithContent(message)) {
      return message;
    }

    if (message.role !== "assistant") {
      return message;
    }

    const blocks = message.content;
    const hasToolUse = blocks.some(
      (b) => isRecord(b) && (b.type === "tool_use" || b.type === "tool_result"),
    );
    if (!hasToolUse) {
      return message;
    }

    const thinkingBlocks = blocks
      .filter((b) => isRecord(b) && (b.type === "thinking" || b.type === "redacted_thinking"))
      .map((b) => ensureMessageThinkingSignature(b, signatureSessionKey));

    const otherBlocks = blocks.filter(
      (b) => !(isRecord(b) && (b.type === "thinking" || b.type === "redacted_thinking")),
    );
    const hasSignedThinking = thinkingBlocks.some((b) => typeof b.signature === "string" && b.signature.length >= MIN_SIGNATURE_LENGTH);

    if (hasSignedThinking) {
      return { ...message, content: [...thinkingBlocks, ...otherBlocks] };
    }

    const lastThinking = defaultSignatureStore.get(signatureSessionKey);
    if (!lastThinking) {
      // No cached signature available - use sentinel to bypass validation
      // This handles cache miss scenarios (restart, session mismatch, expiry)
      const existingThinking = thinkingBlocks[0];
      const thinkingText = existingThinking?.thinking || existingThinking?.text || "";
      log.debug("Injecting sentinel signature (cache miss)", { signatureSessionKey });
      const sentinelBlock = {
        type: "thinking",
        thinking: thinkingText,
        signature: SKIP_THOUGHT_SIGNATURE,
      };
      return { ...message, content: [sentinelBlock, ...otherBlocks] };
    }

    const injected = {
      type: "thinking",
      thinking: lastThinking.text,
      signature: lastThinking.signature,
    };

    return { ...message, content: [injected, ...otherBlocks] };
  });
}

/**
 * Gets the stable session ID for this plugin instance.
 */
export function getPluginSessionId(): string {
  return PLUGIN_SESSION_ID;
}

function generateSyntheticProjectId(): string {
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toLowerCase();
  return `project-${randomPart}`;
}

const STREAM_ACTION = "streamGenerateContent";

function sanitizeRequestPayloadForAntigravity(payload: any, sessionKey?: string): void {
  if (!payload || typeof payload !== "object") return;

  if (Array.isArray(payload.contents)) {
    for (const content of payload.contents) {
      if (!content || !Array.isArray(content.parts)) continue;

      let currentThoughtSignature: string | undefined;

      // First pass: Find existing thoughtSignature or recover it from cache via ensureThoughtSignature
      for (const part of content.parts) {
        if (part && typeof part === "object") {
          // Check standard Gemini thought parts
          if (part.thought === true) {
            currentThoughtSignature = part.thoughtSignature;
            
            // If missing in payload but we have sessionKey, try to recover from cache
            if (!currentThoughtSignature && sessionKey) {
              const updatedPart = ensureThoughtSignature(part, sessionKey);
              if (updatedPart.thoughtSignature && updatedPart.thoughtSignature !== "skip_thought_signature_validator") {
                currentThoughtSignature = updatedPart.thoughtSignature;
                part.thoughtSignature = currentThoughtSignature; // restore it
              }
            }
            
            if (currentThoughtSignature) break;
          }
          
          // Check wrapped/Anthropic style thinking parts
          if (part.type === "thinking" || part.type === "reasoning") {
            currentThoughtSignature = part.signature;
            
            // Try to recover from cache
            if (!currentThoughtSignature && sessionKey) {
              const updatedPart = ensureThoughtSignature(part, sessionKey);
              if (updatedPart.thoughtSignature && updatedPart.thoughtSignature !== "skip_thought_signature_validator") {
                currentThoughtSignature = updatedPart.thoughtSignature;
                part.signature = currentThoughtSignature; // also restore it to the thought part itself
              }
            }
            
            if (currentThoughtSignature) break;
          }
        }
      }

      // Second pass: If we found a thought signature, inject it into any functionCall parts in this turn
      if (currentThoughtSignature) {
        for (const part of content.parts) {
          if (part && typeof part === "object" && part.functionCall && !part.thoughtSignature) {
            part.thoughtSignature = currentThoughtSignature;
          }
        }
      }
    }
  }
}

/**
 * Detects requests headed to the Google Generative Language API so we can intercept them.
 */
export function isGenerativeLanguageRequest(input: RequestInfo): input is string {
  return typeof input === "string" && input.includes("generativelanguage.googleapis.com");
}

/**
 * Options for request preparation.
 */
export interface PrepareRequestOptions {
  /** Enable Claude tool hardening (parameter signatures + system instruction). Default: true */
  claudeToolHardening?: boolean;
  /** Google Search configuration (global default) */
  googleSearch?: GoogleSearchConfig;
  /** Per-account fingerprint for rate limit mitigation. Falls back to session fingerprint if not provided. */
  fingerprint?: Fingerprint;
}

export function prepareAntigravityRequest(
  input: RequestInfo,
  init: RequestInit | undefined,
  accessToken: string,
  projectId: string,
  endpointOverride?: string,
  headerStyle: HeaderStyle = "antigravity",
  forceThinkingRecovery = false,
  options?: PrepareRequestOptions,
): {
  request: RequestInfo;
  init: RequestInit;
  streaming: boolean;
  requestedModel?: string;
  effectiveModel?: string;
  projectId?: string;
  endpoint?: string;
  sessionId?: string;
  toolDebugMissing?: number;
  toolDebugSummary?: string;
  toolDebugPayload?: string;
  needsSignedThinkingWarmup?: boolean;
  headerStyle: HeaderStyle;
  thinkingRecoveryMessage?: string;
  /** When set, caller should return this synthetic response without sending the request. */
  contextOverflowResponse?: Response;
  /** Human-readable toast message for context overflow. */
  contextOverflowMessage?: string;
} {
  const baseInit: RequestInit = { ...init };
  const headers = new Headers(init?.headers ?? {});
  let resolvedProjectId = projectId?.trim() || "";
  let toolDebugMissing = 0;
  const toolDebugSummaries: string[] = [];
  let toolDebugPayload: string | undefined;
  let sessionId: string | undefined;
  let outboundSessionId: string | undefined;
  let needsSignedThinkingWarmup = false;
  let thinkingRecoveryMessage: string | undefined;

  if (!isGenerativeLanguageRequest(input)) {
    return {
      request: input,
      init: { ...baseInit, headers },
      streaming: false,
      headerStyle,
    };
  }

  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.delete("x-api-key");
  if (headerStyle === "antigravity") {
    // Strip x-goog-user-project header to prevent 403 PERMISSION_DENIED errors.
    // This header is added by OpenCode/AI SDK but causes auth conflicts on ALL endpoints
    // (Daily, Autopush, Prod) when the user's GCP project doesn't have Cloud Code API enabled.
    // Error: "Cloud Code Private API has not been used in project {user_project} before or it is disabled"
    headers.delete("x-goog-user-project");
  }

  const match = input.match(/\/models\/([^:]+):(\w+)/);
  if (!match) {
    return {
      request: input,
      init: { ...baseInit, headers },
      streaming: false,
      headerStyle,
    };
  }

  const [, rawModel = "", rawAction = ""] = match;
  const requestedModel = rawModel;

  const resolved = resolveModelForHeaderStyle(rawModel, headerStyle);
  let effectiveModel = resolved.actualModel;

  const applyGemini3ProTierToEffectiveModel = (level: string | undefined) => {
    if (!level) {
      return;
    }
    if (headerStyle !== "antigravity") {
      return;
    }
    if (!/^gemini-3(?:\.\d+)?-pro/i.test(effectiveModel)) {
      return;
    }

    const normalizedProTier = level.toLowerCase() === "high" ? "high" : "low";
    const baseGemini3Pro = effectiveModel.replace(/-(minimal|low|medium|high)$/i, "");
    effectiveModel = `${baseGemini3Pro}-${normalizedProTier}`;
  };

  const streaming = rawAction === STREAM_ACTION;
  const defaultEndpoint = headerStyle === "gemini-cli" ? GEMINI_CLI_ENDPOINT : ANTIGRAVITY_ENDPOINT;
  const baseEndpoint = endpointOverride ?? defaultEndpoint;
  const transformedUrl = `${baseEndpoint}/v1internal:${rawAction}${streaming ? "?alt=sse" : ""}`;

  const isClaude = isClaudeModel(resolved.actualModel);
  const isClaudeThinking = isClaudeThinkingModel(resolved.actualModel);

  // Tier-based thinking configuration from model resolver (can be overridden by variant config)
  let tierThinkingBudget = resolved.thinkingBudget;
  let tierThinkingLevel = resolved.thinkingLevel;
  let signatureSessionKey = buildSignatureSessionKey(
    PLUGIN_SESSION_ID,
    effectiveModel,
    undefined,
    resolveProjectKey(projectId),
  );

  let body = baseInit.body;
  if (typeof baseInit.body === "string" && baseInit.body) {
    try {
      const parsedBody = JSON.parse(baseInit.body) as Record<string, unknown>;
      const isWrapped = typeof parsedBody.project === "string" && "request" in parsedBody;

      if (isWrapped) {
        const wrappedBody = {
          ...parsedBody,
          model: effectiveModel,
        } as Record<string, unknown>;

        // Some callers may already send an Antigravity-wrapped body.
        // We still need to sanitize Claude thinking blocks (remove cache_control)
        // and attach a stable sessionId so multi-turn signature caching works.
        const requestRoot = wrappedBody.request;
        const requestObjects: Array<Record<string, unknown>> = [];

        if (requestRoot && typeof requestRoot === "object") {
          requestObjects.push(requestRoot as Record<string, unknown>);
          const nested = (requestRoot as Record<string, unknown>).request;
          if (nested && typeof nested === "object") {
            requestObjects.push(nested as Record<string, unknown>);
          }
        }

        const variantSources: Array<Record<string, unknown>> = [
          wrappedBody,
          ...requestObjects,
        ];

        for (const req of variantSources) {
          const variantConfig = extractVariantThinkingConfig(
            (req.providerOptions as Record<string, unknown> | undefined),
            (req.generationConfig as Record<string, unknown> | undefined),
          );

          if (variantConfig?.thinkingLevel) {
            applyGemini3ProTierToEffectiveModel(variantConfig.thinkingLevel);
            break;
          }

          if (typeof variantConfig?.thinkingBudget === "number") {
            const inferredLevel = variantConfig.thinkingBudget <= 8192
              ? "low"
              : variantConfig.thinkingBudget <= 16384
              ? "medium"
              : "high";
            applyGemini3ProTierToEffectiveModel(inferredLevel);
            break;
          }
        }

        wrappedBody.model = effectiveModel;

        const conversationKey = resolveConversationKeyFromRequests(requestObjects);
        const modelForCacheKey = effectiveModel.replace(/-(minimal|low|medium|high)$/i, "");
        signatureSessionKey = buildSignatureSessionKey(PLUGIN_SESSION_ID, modelForCacheKey, conversationKey, resolveProjectKey(parsedBody.project));
        outboundSessionId = buildOpaqueSessionId(signatureSessionKey);

        if (requestObjects.length > 0) {
          sessionId = signatureSessionKey;
        }

        for (const req of requestObjects) {
          // Use stable session ID for signature caching across multi-turn conversations
          req.sessionId = outboundSessionId;
          stripInjectedDebugFromRequestPayload(req as Record<string, unknown>);

          if (isClaude) {
            // Step 0: Sanitize cross-model metadata (strips Gemini signatures when sending to Claude)
            sanitizeCrossModelPayloadInPlace(req, { targetModel: effectiveModel });

            // Step 1: Strip corrupted/unsigned thinking blocks FIRST
            deepFilterThinkingBlocks(req, signatureSessionKey, getCachedSignature, true);

            // Step 2: THEN inject signed thinking from cache (after stripping)
            if (isClaudeThinking && Array.isArray(req.contents)) {
              req.contents = ensureThinkingBeforeToolUseInContents(req.contents, signatureSessionKey);
            }
            if (isClaudeThinking && Array.isArray(req.messages)) {
              req.messages = ensureThinkingBeforeToolUseInMessages(req.messages, signatureSessionKey);
            }

            // Step 3: Apply tool pairing fixes (ID assignment, response matching, orphan recovery)
            applyToolPairingFixes(req as Record<string, unknown>, true);
          } else if (effectiveModel.toLowerCase().includes("gemini-3") || effectiveModel.toLowerCase().includes("gemini-experimental")) {
            // Fix: Preserve thoughtSignature for Gemini thinking models when wrapped by OpenCode (Vercel AI SDK compatibility)
            // The Vercel AI SDK strips thoughtSignature when building conversation history.
            // We need to re-inject it by copying from the thinking part to the functionCall part in the same block.
            sanitizeRequestPayloadForAntigravity(req as Record<string, unknown>, signatureSessionKey);
          }
        }

        if (isClaudeThinking && sessionId) {
          const hasToolUse = requestObjects.some((req) =>
            (Array.isArray(req.contents) && hasToolUseInContents(req.contents)) ||
            (Array.isArray(req.messages) && hasToolUseInMessages(req.messages)),
          );
          const hasSignedThinking = requestObjects.some((req) =>
            (Array.isArray(req.contents) && hasSignedThinkingInContents(req.contents)) ||
            (Array.isArray(req.messages) && hasSignedThinkingInMessages(req.messages)),
          );
          const hasCachedThinking = defaultSignatureStore.has(signatureSessionKey);
          needsSignedThinkingWarmup = hasToolUse && !hasSignedThinking && !hasCachedThinking;
        }

        body = JSON.stringify(wrappedBody);
      } else {
        const requestPayload: Record<string, unknown> = { ...parsedBody };

        const rawGenerationConfig = requestPayload.generationConfig as Record<string, unknown> | undefined;
        const extraBody = requestPayload.extra_body as Record<string, unknown> | undefined;

        if (isClaude) {
          if (!requestPayload.toolConfig) {
            requestPayload.toolConfig = {};
          }
          if (typeof requestPayload.toolConfig === "object" && requestPayload.toolConfig !== null) {
            const toolConfig = requestPayload.toolConfig as Record<string, unknown>;
            if (!toolConfig.functionCallingConfig) {
              toolConfig.functionCallingConfig = {};
            }
            if (typeof toolConfig.functionCallingConfig === "object" && toolConfig.functionCallingConfig !== null) {
              (toolConfig.functionCallingConfig as Record<string, unknown>).mode = "VALIDATED";
            }
          }
        }

        const thinkingStage = applyPrepareThinkingStage({
          requestPayload,
          rawGenerationConfig,
          extraBody,
          effectiveModel,
          isClaude,
          isClaudeThinking,
          tierThinkingBudget,
          tierThinkingLevel,
          resolvedIsThinkingModel: resolved.isThinkingModel,
          applyGemini3ProTierToEffectiveModel,
          warn: (message) => log.warn(message),
        });
        tierThinkingBudget = thinkingStage.tierThinkingBudget;
        tierThinkingLevel = thinkingStage.tierThinkingLevel;

        const cachedContentFromExtra =
          typeof requestPayload.extra_body === "object" && requestPayload.extra_body
            ? (requestPayload.extra_body as Record<string, unknown>).cached_content ??
            (requestPayload.extra_body as Record<string, unknown>).cachedContent
            : undefined;
        const cachedContent =
          (requestPayload.cached_content as string | undefined) ??
          (requestPayload.cachedContent as string | undefined) ??
          (cachedContentFromExtra as string | undefined);
        if (cachedContent) {
          requestPayload.cachedContent = cachedContent;
        }

        delete requestPayload.cached_content;
        delete requestPayload.cachedContent;
        if (requestPayload.extra_body && typeof requestPayload.extra_body === "object") {
          delete (requestPayload.extra_body as Record<string, unknown>).cached_content;
          delete (requestPayload.extra_body as Record<string, unknown>).cachedContent;
          if (Object.keys(requestPayload.extra_body as Record<string, unknown>).length === 0) {
            delete requestPayload.extra_body;
          }
        }

        const toolsStage = applyPrepareToolsStage({
          requestPayload,
          isClaude,
          effectiveModel,
          tierThinkingBudget,
          tierThinkingLevel,
          claudeToolHardening: options?.claudeToolHardening ?? true,
          toolDebugMissing,
        });
        toolDebugMissing = toolsStage.toolDebugMissing;
        toolDebugSummaries.push(...toolsStage.toolDebugSummaries);
        toolDebugPayload = toolsStage.toolDebugPayload;

        const conversationKey = resolveConversationKey(requestPayload);
        signatureSessionKey = buildSignatureSessionKey(PLUGIN_SESSION_ID, effectiveModel, conversationKey, resolveProjectKey(projectId));

        // For Claude models, filter out unsigned thinking blocks (required by Claude API)
        // Attempts to restore signatures from cache for multi-turn conversations
        // Handle both Gemini-style contents[] and Anthropic-style messages[] payloads.
        if (isClaude) {
          // Step 0: Sanitize cross-model metadata (strips Gemini signatures when sending to Claude)
          sanitizeCrossModelPayloadInPlace(requestPayload, { targetModel: effectiveModel });

          // Step 1: Strip corrupted/unsigned thinking blocks FIRST
          deepFilterThinkingBlocks(requestPayload, signatureSessionKey, getCachedSignature, true);

          // Step 2: THEN inject signed thinking from cache (after stripping)
          if (isClaudeThinking && Array.isArray(requestPayload.contents)) {
            requestPayload.contents = ensureThinkingBeforeToolUseInContents(requestPayload.contents, signatureSessionKey);
          }
          if (isClaudeThinking && Array.isArray(requestPayload.messages)) {
            requestPayload.messages = ensureThinkingBeforeToolUseInMessages(requestPayload.messages, signatureSessionKey);
          }

          // Step 3: Check if warmup needed (AFTER injection attempt)
          if (isClaudeThinking) {
            const hasToolUse =
              (Array.isArray(requestPayload.contents) && hasToolUseInContents(requestPayload.contents)) ||
              (Array.isArray(requestPayload.messages) && hasToolUseInMessages(requestPayload.messages));
            const hasSignedThinking =
              (Array.isArray(requestPayload.contents) && hasSignedThinkingInContents(requestPayload.contents)) ||
              (Array.isArray(requestPayload.messages) && hasSignedThinkingInMessages(requestPayload.messages));
            const hasCachedThinking = defaultSignatureStore.has(signatureSessionKey);
            needsSignedThinkingWarmup = hasToolUse && !hasSignedThinking && !hasCachedThinking;
          }
        } else {
          sanitizeRequestPayloadForAntigravity(requestPayload, signatureSessionKey);
        }

        // For Claude models, ensure functionCall/tool use parts carry IDs (required by Anthropic).
        // We use a two-pass approach: first collect all functionCalls and assign IDs,
        // then match functionResponses to their corresponding calls using a FIFO queue per function name.
        if (isClaude && Array.isArray(requestPayload.contents)) {
          let contentsForToolPairing = requestPayload.contents;
          let toolCallCounter = 0;
          // Track pending call IDs per function name as a FIFO queue
          const pendingCallIdsByName = new Map<string, string[]>();

          // First pass: assign IDs to all functionCalls and collect them
          contentsForToolPairing = contentsForToolPairing.map((content: any) => {
            if (!content || !Array.isArray(content.parts)) {
              return content;
            }

            const newParts = content.parts.map((part: any) => {
              if (part && typeof part === "object" && part.functionCall) {
                const call = { ...part.functionCall };
                if (!call.id) {
                  call.id = `tool-call-${++toolCallCounter}`;
                }
                const nameKey = typeof call.name === "string" ? call.name : `tool-${toolCallCounter}`;
                // Push to the queue for this function name
                const queue = pendingCallIdsByName.get(nameKey) || [];
                queue.push(call.id);
                pendingCallIdsByName.set(nameKey, queue);
                return { ...part, functionCall: call };
              }
              return part;
            });

            return { ...content, parts: newParts };
          });

          // Second pass: match functionResponses to their corresponding calls (FIFO order)
          contentsForToolPairing = contentsForToolPairing.map((content: any) => {
            if (!content || !Array.isArray(content.parts)) {
              return content;
            }

            const newParts = content.parts.map((part: any) => {
              if (part && typeof part === "object" && part.functionResponse) {
                const resp = { ...part.functionResponse };
                if (!resp.id && typeof resp.name === "string") {
                  const queue = pendingCallIdsByName.get(resp.name);
                  if (queue && queue.length > 0) {
                    // Consume the first pending ID (FIFO order)
                    resp.id = queue.shift();
                    pendingCallIdsByName.set(resp.name, queue);
                  }
                }
                return { ...part, functionResponse: resp };
              }
              return part;
            });

            return { ...content, parts: newParts };
          });

          // Third pass: Apply orphan recovery for mismatched tool IDs
          // This handles cases where context compaction or other processes
          // create ID mismatches between calls and responses.
          // Ported from LLM-API-Key-Proxy's _fix_tool_response_grouping()
          requestPayload.contents = fixToolResponseGrouping(contentsForToolPairing);
        }

        // Fourth pass: Fix Claude format tool pairing (defense in depth)
        // Handles orphaned tool_use blocks in Claude's messages[] format
        if (Array.isArray(requestPayload.messages)) {
          requestPayload.messages = validateAndFixClaudeToolPairing(requestPayload.messages);
        }

        // =====================================================================
        // LAST RESORT RECOVERY: "Let it crash and start again"
        // =====================================================================
        // If after all our processing we're STILL in a bad state (tool loop without
        // thinking at turn start), don't try to fix it - just close the turn and
        // start fresh. This prevents permanent session breakage.
        //
        // This handles cases where:
        // - Context compaction stripped thinking blocks
        // - Signature cache miss
        // - Any other corruption we couldn't repair
        // - API error indicated thinking_block_order issue (forceThinkingRecovery=true)
        //
        // The synthetic messages allow Claude to generate fresh thinking on the
        // new turn instead of failing with "Expected thinking but found text".
        if (isClaudeThinking && Array.isArray(requestPayload.contents)) {
          const conversationState = analyzeConversationState(requestPayload.contents);

          // Force recovery if API returned thinking_block_order error (retry case)
          // or if proactive check detects we need recovery
          if (forceThinkingRecovery || needsThinkingRecovery(conversationState)) {
            // Set message for toast notification (shown in plugin.ts, respects quiet mode)
            thinkingRecoveryMessage = forceThinkingRecovery
              ? "Thinking recovery: retrying with fresh turn (API error)"
              : "Thinking recovery: restarting turn (corrupted context)";

            requestPayload.contents = closeToolLoopForThinking(requestPayload.contents);

            defaultSignatureStore.delete(signatureSessionKey);
          }
        }

        // Proactive context overflow guard for Claude models
        if (isClaude && headerStyle === "antigravity") {
          const HARD_LIMIT = 200_000;
          const resolvedThinkingBudget = typeof tierThinkingBudget === "number" && tierThinkingBudget > 0
            ? tierThinkingBudget
            : (isClaudeThinking ? 8_192 : 0);
          
          // Use 195,000 as effective limit for safety. 
          // 195,000 corresponds to "nurunin limit ke 195k" + subtract thinking budget
          const effectiveLimit = 195_000 - resolvedThinkingBudget - 5_000;

          const estimateTokens = (obj: unknown): number => Math.ceil(JSON.stringify(obj).length / 4);
          let estimatedInputTokens = 0;
          if (requestPayload.systemInstruction) estimatedInputTokens += estimateTokens(requestPayload.systemInstruction);
          if (Array.isArray(requestPayload.contents)) estimatedInputTokens += estimateTokens(requestPayload.contents);
          if (Array.isArray(requestPayload.messages)) estimatedInputTokens += estimateTokens(requestPayload.messages);
          if (Array.isArray(requestPayload.tools)) estimatedInputTokens += estimateTokens(requestPayload.tools);

          if (estimatedInputTokens > effectiveLimit) {
            const overBy = estimatedInputTokens - 200_000;
            const overflowMsg = `[Antigravity] Context too long for ${requestedModel || effectiveModel}: ~${estimatedInputTokens.toLocaleString()} estimated tokens exceeds the 200,000 token limit by ~${overBy.toLocaleString()} tokens.\n\nUse /compact to compress your context, then retry.`;
            const overflowToastMsg = `Context too long (~${Math.round(estimatedInputTokens / 1000)}k tokens). Use /compact to reduce size.`;

            return {
              request: input,
              init: { ...baseInit, headers },
              streaming,
              requestedModel,
              effectiveModel,
              projectId: resolvedProjectId,
              endpoint: transformedUrl,
              headerStyle,
              contextOverflowResponse: createSyntheticErrorResponse(overflowMsg, requestedModel || effectiveModel),
              contextOverflowMessage: overflowToastMsg,
            };
          }
        }

        if ("model" in requestPayload) {
          delete requestPayload.model;
        }

        stripInjectedDebugFromRequestPayload(requestPayload);

        const effectiveProjectId = projectId?.trim() || (headerStyle === "antigravity" ? generateSyntheticProjectId() : "");
        resolvedProjectId = effectiveProjectId;
        outboundSessionId = buildOpaqueSessionId(signatureSessionKey);

        // Inject Antigravity system instruction with role "user" (CLIProxyAPI v6.6.89 compatibility)
        // This sets request.systemInstruction.role = "user" and request.systemInstruction.parts[0].text
        if (headerStyle === "antigravity") {
          const existingSystemInstruction = requestPayload.systemInstruction;
          if (existingSystemInstruction && typeof existingSystemInstruction === "object") {
            const sys = existingSystemInstruction as Record<string, unknown>;
            sys.role = "user";
            if (Array.isArray(sys.parts) && sys.parts.length > 0) {
              const firstPart = sys.parts[0] as Record<string, unknown>;
              if (firstPart && typeof firstPart.text === "string") {
                firstPart.text = ANTIGRAVITY_SYSTEM_INSTRUCTION + "\n\n" + firstPart.text;
              } else {
                sys.parts = [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }, ...sys.parts];
              }
            } else {
              sys.parts = [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }];
            }
          } else if (typeof existingSystemInstruction === "string") {
            requestPayload.systemInstruction = {
              role: "user",
              parts: [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION + "\n\n" + existingSystemInstruction }],
            };
          } else {
            requestPayload.systemInstruction = {
              role: "user",
              parts: [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }],
            };
          }
        }

        const wrappedBody: Record<string, unknown> = {
          project: effectiveProjectId,
          model: effectiveModel,
          request: requestPayload,
        };

        if (headerStyle === "antigravity") {
          wrappedBody.requestType = "agent";
          wrappedBody.userAgent = "antigravity";
          wrappedBody.requestId = crypto.randomUUID();
        }
        if (wrappedBody.request && typeof wrappedBody.request === 'object') {
          // Use stable session ID for signature caching across multi-turn conversations
          sessionId = signatureSessionKey;
          (wrappedBody.request as Record<string, unknown>).sessionId = outboundSessionId;
        }

        body = JSON.stringify(wrappedBody);
      }
    } catch (error) {
      throw error;
    }
  }

  if (streaming) {
    headers.set("Accept", "text/event-stream");
  }

  // Add interleaved thinking header for Claude thinking models
  // This enables real-time streaming of thinking tokens
  if (isClaudeThinking) {
    const existing = headers.get("anthropic-beta");
    const interleavedHeader = "interleaved-thinking-2025-05-14";

    if (existing) {
      if (!existing.includes(interleavedHeader)) {
        headers.set("anthropic-beta", `${existing},${interleavedHeader}`);
      }
    } else {
      headers.set("anthropic-beta", interleavedHeader);
    }
  }

  if (headerStyle === "antigravity") {
    // Use randomized headers as the fallback pool for Antigravity mode
    const selectedHeaders = getRandomizedHeaders("antigravity", requestedModel);

    // Antigravity mode: Match Antigravity Manager behavior
    // AM only sends User-Agent on content requests — no X-Goog-Api-Client, no Client-Metadata header
    // (ideType=ANTIGRAVITY goes in request body metadata via project.ts, not as a header)
    const fingerprint = options?.fingerprint ?? getSessionFingerprint();
    const fingerprintHeaders = buildFingerprintHeaders(fingerprint);

    headers.set("User-Agent", fingerprintHeaders["User-Agent"] || selectedHeaders["User-Agent"]);
  } else {
    // Gemini CLI mode: match opencode-gemini-auth Code Assist header set exactly
    headers.set("User-Agent", GEMINI_CLI_HEADERS["User-Agent"]);
    headers.set("X-Goog-Api-Client", GEMINI_CLI_HEADERS["X-Goog-Api-Client"]);
    headers.set("Client-Metadata", GEMINI_CLI_HEADERS["Client-Metadata"]);
  }
  return {
    request: transformedUrl,
    init: {
      ...baseInit,
      headers,
      body,
    },
    streaming,
    requestedModel,
    effectiveModel: effectiveModel,
    projectId: resolvedProjectId,
    endpoint: transformedUrl,
    sessionId,
    toolDebugMissing,
    toolDebugSummary: toolDebugSummaries.slice(0, 20).join(" | "),
    toolDebugPayload,
    needsSignedThinkingWarmup,
    headerStyle,
    thinkingRecoveryMessage,
  };
}

export function buildThinkingWarmupBody(
  bodyText: string | undefined,
  isClaudeThinking: boolean,
): string | null {
  if (!bodyText || !isClaudeThinking) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return null;
  }

  const warmupPrompt = "Warmup request for thinking signature.";

  const updateRequest = (req: Record<string, unknown>) => {
    req.contents = [{ role: "user", parts: [{ text: warmupPrompt }] }];
    delete req.tools;
    delete req.toolConfig;

    const generationConfig = (req.generationConfig ?? {}) as Record<string, unknown>;
    generationConfig.thinkingConfig = {
      include_thoughts: true,
      thinking_budget: DEFAULT_THINKING_BUDGET,
    };
    generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
    req.generationConfig = generationConfig;
  };

  if (parsed.request && typeof parsed.request === "object") {
    updateRequest(parsed.request as Record<string, unknown>);
    const nested = (parsed.request as Record<string, unknown>).request;
    if (nested && typeof nested === "object") {
      updateRequest(nested as Record<string, unknown>);
    }
  } else {
    updateRequest(parsed);
  }

  return JSON.stringify(parsed);
}

/**
 * Normalizes Antigravity responses: applies retry headers, extracts cache usage into headers,
 * rewrites preview errors, flattens streaming payloads, and logs debug metadata.
 *
 * For streaming SSE responses, uses TransformStream for true real-time incremental streaming.
 * Thinking/reasoning tokens are transformed and forwarded immediately as they arrive.
 */
export async function transformAntigravityResponse(
  response: Response,
  streaming: boolean,
  debugContext?: AntigravityDebugContext | null,
  requestedModel?: string,
  projectId?: string,
  endpoint?: string,
  effectiveModel?: string,
  sessionId?: string,
  toolDebugMissing?: number,
  toolDebugSummary?: string,
  toolDebugPayload?: string,
  debugLines?: string[],
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const { isEventStreamResponse, shouldTransform } = shouldTransformAntigravityBody(contentType);
  const debugText = buildResponseDebugText(
    debugLines,
    SYNTHETIC_THINKING_PLACEHOLDER,
    formatDebugLinesForThinking,
  );
  const cacheSignatures = shouldCacheThinkingSignatures(effectiveModel);

  if (!shouldTransform) {
    logAntigravityDebugResponse(debugContext, response, {
      note: "Non-JSON response (body omitted)",
    });
    return response;
  }

  const streamingResponse = transformStreamingResponseStage({
    response,
    streaming,
    isEventStreamResponse,
    debugContext,
    debugText,
    cacheSignatures,
    sessionId,
    displayedThinkingHashes: effectiveModel && isGemini3Model(effectiveModel) ? sessionDisplayedThinkingHashes : undefined,
    displayedThinkingHashesMaxSize: SESSION_DISPLAYED_THINKING_HASHES_MAX_SIZE,
    signatureStore: defaultSignatureStore,
    cacheSignature,
    injectDebugThinking,
  });
  if (streamingResponse) {
    return streamingResponse;
  }

  try {
    return await transformBufferedResponseStage({
      response,
      streaming,
      isEventStreamResponse,
      debugContext,
      requestedModel,
      projectId,
      endpoint,
      effectiveModel,
      toolDebugMissing,
      toolDebugSummary,
      toolDebugPayload,
      debugText,
      injectDebugThinking,
    });
  } catch (error) {
    logAntigravityDebugResponse(debugContext, response, {
      error,
      note: "Failed to transform Antigravity response",
    });
    return response;
  }
}

export const __testExports = {
  buildSignatureSessionKey,
  buildOpaqueSessionId,
  hashConversationSeed,
  extractTextFromContent,
  extractConversationSeedFromMessages,
  extractConversationSeedFromContents,
  resolveConversationKey,
  resolveProjectKey,
  isGeminiToolUsePart,
  isGeminiThinkingPart,
  ensureThoughtSignature,
  hasSignedThinkingPart,
  hasSignedThinkingInContents,
  hasSignedThinkingInMessages,
  hasToolUseInContents,
  hasToolUseInMessages,
  ensureThinkingBeforeToolUseInContents,
  ensureThinkingBeforeToolUseInMessages,
  generateSyntheticProjectId,
  MIN_SIGNATURE_LENGTH,
  transformSseLine,
  transformStreamingPayload,
  createStreamingTransformer,
};
