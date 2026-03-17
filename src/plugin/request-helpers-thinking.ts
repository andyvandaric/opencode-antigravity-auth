import { getKeepThinking } from "./config"
import { createLogger } from "./logger"
import { processImageData } from "./image-saver"
import type { GoogleSearchConfig } from "./transform/types"
import { recursivelyParseJsonStrings } from "./request-helpers-tool-pairing"
import {
  hasBoundarySignature,
  isContentWithParts,
  isGeminiThinkingBoundaryPart,
  isGeminiToolUseBoundaryPart,
  isMessageWithContent,
  isRecord,
} from "./types"
import { SKIP_THOUGHT_SIGNATURE } from "../constants"

const log = createLogger("request-helpers-thinking")

/**
 * Normalized thinking configuration accepted by Antigravity.
 */
export interface ThinkingConfig {
  thinkingBudget?: number;
  includeThoughts?: boolean;
}

/**
 * Default token budget for thinking/reasoning. 16000 tokens provides sufficient
 * space for complex reasoning while staying within typical model limits.
 */
export const DEFAULT_THINKING_BUDGET = 16000;

/**
 * Checks if a model name indicates thinking/reasoning capability.
 * Models with "thinking", "gemini-3", or "opus" in their name support extended thinking.
 */
export function isThinkingCapableModel(modelName: string): boolean {
  const lowerModel = modelName.toLowerCase();
  return lowerModel.includes("thinking")
    || lowerModel.includes("gemini-3")
    || lowerModel.includes("opus");
}

/**
 * Extracts thinking configuration from various possible request locations.
 * Supports both Gemini-style thinkingConfig and Anthropic-style thinking options.
 */
export function extractThinkingConfig(
  requestPayload: Record<string, unknown>,
  rawGenerationConfig: Record<string, unknown> | undefined,
  extraBody: Record<string, unknown> | undefined,
): ThinkingConfig | undefined {
  const thinkingConfig = rawGenerationConfig?.thinkingConfig
    ?? extraBody?.thinkingConfig
    ?? requestPayload.thinkingConfig;

  if (thinkingConfig && typeof thinkingConfig === "object") {
    const config = thinkingConfig as Record<string, unknown>;
    return {
      includeThoughts: Boolean(config.includeThoughts),
      thinkingBudget: typeof config.thinkingBudget === "number" ? config.thinkingBudget : DEFAULT_THINKING_BUDGET,
    };
  }

  // Convert Anthropic-style "thinking" option: { type: "enabled", budgetTokens: N }
  const anthropicThinking = extraBody?.thinking ?? requestPayload.thinking;
  if (anthropicThinking && typeof anthropicThinking === "object") {
    const thinking = anthropicThinking as Record<string, unknown>;
    if (thinking.type === "enabled" || thinking.budgetTokens) {
      return {
        includeThoughts: true,
        thinkingBudget: typeof thinking.budgetTokens === "number" ? thinking.budgetTokens : DEFAULT_THINKING_BUDGET,
      };
    }
  }

  return undefined;
}

/**
 * Variant thinking config extracted from OpenCode's providerOptions.
 */
export interface VariantThinkingConfig {
  /** Gemini 3 native thinking level (low/medium/high) */
  thinkingLevel?: string;
  /** Numeric thinking budget for Claude and Gemini 2.5 */
  thinkingBudget?: number;
  /** Whether to include thoughts in output */
  includeThoughts?: boolean;
  /** Google Search configuration */
  googleSearch?: GoogleSearchConfig;
}

/**
 * Extracts variant thinking config from OpenCode's providerOptions.
 * 
 * All Antigravity models route through the Google provider, so we only check
 * providerOptions.google. Supports two formats:
 * 
 * 1. Gemini 3 native: { google: { thinkingLevel: "high", includeThoughts: true } }
 * 2. Budget-based (Claude/Gemini 2.5): { google: { thinkingConfig: { thinkingBudget: 32000 } } }
 * 
 * When providerOptions is missing or has no thinking config (common with OpenCode
 * model variants), falls back to extracting from generationConfig directly:
 * 3. generationConfig fallback: { thinkingConfig: { thinkingBudget: 8192 } }
 */
export function extractVariantThinkingConfig(
  providerOptions: Record<string, unknown> | undefined,
  generationConfig?: Record<string, unknown> | undefined
): VariantThinkingConfig | undefined {
  const result: VariantThinkingConfig = {};

  // Primary path: extract from providerOptions.google
  const google = (providerOptions?.google) as Record<string, unknown> | undefined;
  if (google) {
    // Gemini 3 native format: { google: { thinkingLevel: "high", includeThoughts: true } }
    // thinkingLevel takes priority over thinkingBudget - they are mutually exclusive
    if (typeof google.thinkingLevel === "string") {
      result.thinkingLevel = google.thinkingLevel;
      result.includeThoughts = typeof google.includeThoughts === "boolean" ? google.includeThoughts : undefined;
    } else if (google.thinkingConfig && typeof google.thinkingConfig === "object") {
      // Budget-based format (Claude/Gemini 2.5): { google: { thinkingConfig: { thinkingBudget } } }
      // Only used when thinkingLevel is not present
      const tc = google.thinkingConfig as Record<string, unknown>;
      if (typeof tc.thinkingBudget === "number") {
        result.thinkingBudget = tc.thinkingBudget;
      }
    }

    // Extract Google Search config
    if (google.googleSearch && typeof google.googleSearch === "object") {
      const search = google.googleSearch as Record<string, unknown>;
      result.googleSearch = {
        mode: search.mode === 'auto' || search.mode === 'off' ? search.mode : undefined,
        threshold: typeof search.threshold === 'number' ? search.threshold : undefined,
      };
    }
  }

  // Fallback: OpenCode may pass thinking config in generationConfig
  // instead of providerOptions (common when using model variants)
  if (result.thinkingBudget === undefined && !result.thinkingLevel && generationConfig) {
    if (generationConfig.thinkingConfig && typeof generationConfig.thinkingConfig === "object") {
      const tc = generationConfig.thinkingConfig as Record<string, unknown>;
      if (typeof tc.thinkingBudget === "number") {
        result.thinkingBudget = tc.thinkingBudget;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Determines the final thinking configuration based on model capabilities and user settings.
 * For Claude thinking models, we keep thinking enabled even in multi-turn conversations.
 * The filterUnsignedThinkingBlocks function will handle signature validation/restoration.
 */
export function resolveThinkingConfig(
  userConfig: ThinkingConfig | undefined,
  isThinkingModel: boolean,
  _isClaudeModel: boolean,
  _hasAssistantHistory: boolean,
): ThinkingConfig | undefined {
  // For thinking-capable models (including Claude thinking models), enable thinking by default
  // The signature validation/restoration is handled by filterUnsignedThinkingBlocks
  if (isThinkingModel && !userConfig) {
    return { includeThoughts: true, thinkingBudget: DEFAULT_THINKING_BUDGET };
  }

  return userConfig;
}

/**
 * Checks if a part is a thinking/reasoning block (Anthropic or Gemini style).
 */
function isThinkingPart(part: Record<string, unknown>): boolean {
  return isGeminiThinkingBoundaryPart(part as unknown)
    || part.type === "redacted_thinking"
    || part.thinking !== undefined
    || part.type === "reasoning"
    || part.thought === true;
}

/**
 * Checks if a part has a signature field (thinking block signature).
 * Used to detect foreign thinking blocks that might have unknown type values.
 */
function hasSignatureField(part: Record<string, unknown>): boolean {
  return hasBoundarySignature(part) || part.signature !== undefined || part.thoughtSignature !== undefined;
}

/**
 * Checks if a part is a tool block (tool_use or tool_result).
 * Tool blocks must never be filtered - they're required for tool call/result pairing.
 * Handles multiple formats:
 * - Anthropic: { type: "tool_use" }, { type: "tool_result", tool_use_id }
 * - Nested: { tool_result: { tool_use_id } }, { tool_use: { id } }
 * - Gemini: { functionCall }, { functionResponse }
 */
function isToolBlock(part: Record<string, unknown>): boolean {
  return part.type === "tool_use"
    || part.type === "tool_result"
    || part.tool_use_id !== undefined
    || part.tool_call_id !== undefined
    || part.tool_result !== undefined
    || part.functionResponse !== undefined
    || isGeminiToolUseBoundaryPart(part as unknown)
    || part.functionCall !== undefined;
}

/**
 * Unconditionally strips ALL thinking/reasoning blocks from a content array.
 * Used for Claude models to avoid signature validation errors entirely.
 * Claude will generate fresh thinking for each turn.
 */
function stripAllThinkingBlocks(contentArray: any[]): any[] {
  return contentArray.filter(item => {
    if (!item || typeof item !== "object") return true;
    if (isToolBlock(item)) return true;
    if (isThinkingPart(item)) return false;
    if (hasSignatureField(item)) return false;
    return true;
  });
}

/**
 * Removes trailing thinking blocks from a content array.
 * Claude API requires that assistant messages don't end with thinking blocks.
 * Only removes unsigned thinking blocks; preserves those with valid signatures.
 */
function removeTrailingThinkingBlocks(
  contentArray: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
): any[] {
  const result = [...contentArray];

  while (result.length > 0 && isThinkingPart(result[result.length - 1])) {
    const part = result[result.length - 1];
    const isValid = sessionId && getCachedSignatureFn
      ? isOurCachedSignature(part as Record<string, unknown>, sessionId, getCachedSignatureFn)
      : hasValidSignature(part as Record<string, unknown>);
    if (isValid) {
      break;
    }
    result.pop();
  }

  return result;
}

/**
 * Checks if a thinking part has a valid signature.
 * A valid signature is a non-empty string with at least 50 characters.
 */
function hasValidSignature(part: Record<string, unknown>): boolean {
  return hasBoundarySignature(part, 50);
}

/**
 * Gets the signature from a thinking part, if present.
 */
function getSignature(part: Record<string, unknown>): string | undefined {
  const signature = part.thought === true ? part.thoughtSignature : part.signature;
  return typeof signature === "string" ? signature : undefined;
}

/**
 * Checks if a thinking part's signature was generated by our plugin (exists in our cache).
 * This prevents accepting signatures from other providers (e.g., direct Anthropic API, OpenAI)
 * which would cause "Invalid signature" errors when sent to Antigravity Claude.
 */
function isOurCachedSignature(
  part: Record<string, unknown>,
  sessionId: string | undefined,
  getCachedSignatureFn: ((sessionId: string, text: string) => string | undefined) | undefined,
): boolean {
  if (!sessionId || !getCachedSignatureFn) {
    return false;
  }

  const text = getThinkingText(part);
  if (!text) {
    return false;
  }

  const partSignature = getSignature(part);
  if (!partSignature) {
    return false;
  }

  const cachedSignature = getCachedSignatureFn(sessionId, text);
  return cachedSignature === partSignature;
}

/**
 * Gets the text content from a thinking part.
 */
function getThinkingText(part: Record<string, unknown>): string {
  if (typeof part.text === "string") return part.text;
  if (typeof part.thinking === "string") return part.thinking;

  if (isRecord(part.text)) {
    const maybeText = part.text.text;
    if (typeof maybeText === "string") return maybeText;
  }

  if (isRecord(part.thinking)) {
    const maybeText = part.thinking.text ?? part.thinking.thinking;
    if (typeof maybeText === "string") return maybeText;
  }

  return "";
}

/**
 * Recursively strips cache_control and providerOptions from any object.
 * These fields can be injected by SDKs, but Claude rejects them inside thinking blocks.
 */
function stripCacheControlRecursively(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(item => stripCacheControlRecursively(item));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "cache_control" || key === "providerOptions") continue;
    result[key] = stripCacheControlRecursively(value);
  }
  return result;
}

/**
 * Sanitizes a thinking part by keeping only the allowed fields.
 * In particular, ensures `thinking` is a string (not an object with cache_control).
 * Returns null if the thinking block has no valid content.
 */
function sanitizeThinkingPart(part: Record<string, unknown>): Record<string, unknown> | null {
  // Gemini-style thought blocks: { thought: true, text, thoughtSignature }
  if (part.thought === true) {
    let textContent: unknown = part.text;
    if (isRecord(textContent)) {
      textContent = typeof textContent.text === "string" ? textContent.text : undefined;
    }

    const hasContent = typeof textContent === "string" && textContent.trim().length > 0;
    if (!hasContent && !part.thoughtSignature) {
      return null;
    }

    const sanitized: Record<string, unknown> = { thought: true };
    if (textContent !== undefined) sanitized.text = textContent;
    if (part.thoughtSignature !== undefined) sanitized.thoughtSignature = part.thoughtSignature;
    return sanitized;
  }

  // Anthropic-style thinking/redacted_thinking blocks: { type: "thinking"|"redacted_thinking", thinking, signature }
  if (part.type === "thinking" || part.type === "redacted_thinking" || part.thinking !== undefined) {
    let thinkingContent: unknown = part.thinking ?? part.text;
    if (thinkingContent !== undefined && isRecord(thinkingContent)) {
      const maybeText = thinkingContent.text ?? thinkingContent.thinking;
      thinkingContent = typeof maybeText === "string" ? maybeText : undefined;
    }

    const hasContent = typeof thinkingContent === "string" && thinkingContent.trim().length > 0;
    if (!hasContent && !part.signature) {
      return null;
    }

    const sanitized: Record<string, unknown> = { type: part.type === "redacted_thinking" ? "redacted_thinking" : "thinking" };
    if (thinkingContent !== undefined) sanitized.thinking = thinkingContent;
    if (part.signature !== undefined) sanitized.signature = part.signature;
    return sanitized;
  }

  // Reasoning blocks (OpenCode format): { type: "reasoning", text, signature }
  if (part.type === "reasoning") {
    let textContent: unknown = part.text;
    if (isRecord(textContent)) {
      textContent = typeof textContent.text === "string" ? textContent.text : undefined;
    }

    const hasContent = typeof textContent === "string" && textContent.trim().length > 0;
    if (!hasContent && !part.signature) {
      return null;
    }

    const sanitized: Record<string, unknown> = { type: "reasoning" };
    if (textContent !== undefined) sanitized.text = textContent;
    if (part.signature !== undefined) sanitized.signature = part.signature;
    return sanitized;
  }

  // Fallback: strip cache_control recursively.
  return stripCacheControlRecursively(part) as Record<string, unknown>;
}

function findLastAssistantIndex(contents: any[], roleValue: "model" | "assistant"): number {
  for (let i = contents.length - 1; i >= 0; i--) {
    const content = contents[i];
    if (content && typeof content === "object" && content.role === roleValue) {
      return i;
    }
  }
  return -1;
}

function filterContentArray(
  contentArray: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
  isLastAssistantMessage: boolean = false,
): any[] {
  // For Claude models, strip thinking blocks by default for reliability
  // User can opt-in to keep thinking via config: { "keep_thinking": true }
  if (isClaudeModel && !getKeepThinking()) {
    return stripAllThinkingBlocks(contentArray);
  }

  const filtered: any[] = [];

  for (const item of contentArray) {
    if (!item || typeof item !== "object") {
      filtered.push(item);
      continue;
    }

    if (isToolBlock(item)) {
      filtered.push(item);
      continue;
    }

    const isThinking = isThinkingPart(item);
    const hasSignature = hasSignatureField(item);

    if (!isThinking && !hasSignature) {
      filtered.push(item);
      continue;
    }

    // For the LAST assistant message with thinking blocks:
    // - If signature is OUR cached signature, pass through unchanged
    // - Otherwise inject sentinel to bypass Antigravity validation
    // NOTE: We can't trust signatures just because they're >= 50 chars - Claude returns
    // its own signatures which are long but invalid for Antigravity.
    if (isLastAssistantMessage && (isThinking || hasSignature)) {
      // First check if it's our cached signature
      if (isOurCachedSignature(item, sessionId, getCachedSignatureFn)) {
        const sanitized = sanitizeThinkingPart(item);
        if (sanitized) filtered.push(sanitized);
        continue;
      }
      
      // Not our signature (or no signature) - inject sentinel
      const thinkingText = getThinkingText(item) || "";
      const existingSignature = item.signature || item.thoughtSignature;
      const signatureInfo = existingSignature ? `foreign signature (${String(existingSignature).length} chars)` : "no signature";
      log.debug(`Injecting sentinel for last-message thinking block with ${signatureInfo}`);
      const sentinelPart = {
        type: item.type || "thinking",
        thinking: thinkingText,
        signature: SKIP_THOUGHT_SIGNATURE,
      };
      filtered.push(sentinelPart);
      continue;
    }

    if (isOurCachedSignature(item, sessionId, getCachedSignatureFn)) {
      const sanitized = sanitizeThinkingPart(item);
      if (sanitized) filtered.push(sanitized);
      continue;
    }

    if (sessionId && getCachedSignatureFn) {
      const text = getThinkingText(item);
      if (text) {
        const cachedSignature = getCachedSignatureFn(sessionId, text);
        if (cachedSignature && cachedSignature.length >= 50) {
          const restoredPart = { ...item };
          if (item.thought === true) {
            restoredPart.thoughtSignature = cachedSignature;
          } else {
            restoredPart.signature = cachedSignature;
          }
          const sanitized = sanitizeThinkingPart(restoredPart as Record<string, unknown>);
          if (sanitized) filtered.push(sanitized);
          continue;
        }
      }
    }
  }

  return filtered;
}

/**
 * Filters thinking blocks from contents unless the signature matches our cache.
 * Attempts to restore signatures from cache for thinking blocks that lack signatures.
 *
 * @param contents - The contents array from the request
 * @param sessionId - Optional session ID for signature cache lookup
 * @param getCachedSignatureFn - Optional function to retrieve cached signatures
 */
export function filterUnsignedThinkingBlocks(
  contents: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): any[] {
  const lastAssistantIdx = findLastAssistantIndex(contents, "model");

  return contents.map((content: unknown, idx: number) => {
    if (!isRecord(content)) {
      return content;
    }

    const isLastAssistant = idx === lastAssistantIdx;

    if (isContentWithParts(content)) {
      const filteredParts = filterContentArray(
        content.parts,
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
        isLastAssistant,
      );

      const trimmedParts = content.role === "model" && !isClaudeModel
        ? removeTrailingThinkingBlocks(filteredParts, sessionId, getCachedSignatureFn)
        : filteredParts;

      return { ...content, parts: trimmedParts };
    }

    if (isMessageWithContent(content)) {
      const isAssistantRole = content.role === "assistant";
      const isLastAssistantContent = idx === lastAssistantIdx || 
        (isAssistantRole && idx === findLastAssistantIndex(contents, "assistant"));
      
      const filteredContent = filterContentArray(
        content.content,
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
        isLastAssistantContent,
      );

      const trimmedContent = isAssistantRole && !isClaudeModel
        ? removeTrailingThinkingBlocks(filteredContent, sessionId, getCachedSignatureFn)
        : filteredContent;

      return { ...content, content: trimmedContent };
    }

    return content;
  });
}

/**
 * Filters thinking blocks from Anthropic-style messages[] payloads using cached signatures.
 */
export function filterMessagesThinkingBlocks(
  messages: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): any[] {
  const lastAssistantIdx = findLastAssistantIndex(messages, "assistant");

  return messages.map((message: unknown, idx: number) => {
    if (!isRecord(message)) {
      return message;
    }

    if (isMessageWithContent(message)) {
      const isAssistantRole = message.role === "assistant";
      const isLastAssistant = isAssistantRole && idx === lastAssistantIdx;
      
      const filteredContent = filterContentArray(
        message.content,
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
        isLastAssistant,
      );

      const trimmedContent = isAssistantRole && !isClaudeModel
        ? removeTrailingThinkingBlocks(filteredContent, sessionId, getCachedSignatureFn)
        : filteredContent;

      return { ...message, content: trimmedContent };
    }

    return message;
  });
}

export function deepFilterThinkingBlocks(
  payload: unknown,
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): unknown {
  const visited = new WeakSet<object>();

  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }

    if (visited.has(value as object)) {
      return;
    }

    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach((item) => {
        walk(item);
      });
      return;
    }

    const obj = value as Record<string, unknown>;

    if (Array.isArray(obj.contents)) {
      obj.contents = filterUnsignedThinkingBlocks(
        obj.contents,
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
      );
    }

    if (Array.isArray(obj.messages)) {
      obj.messages = filterMessagesThinkingBlocks(
        obj.messages,
        sessionId,
        getCachedSignatureFn,
        isClaudeModel,
      );
    }

    Object.keys(obj).forEach((key) => {
      walk(obj[key]);
    });
  };

  walk(payload);
  return payload;
}

/**
 * Transforms Gemini-style thought parts (thought: true) and Anthropic-style
 * thinking parts (type: "thinking") to reasoning format.
 * Claude responses through Antigravity may use candidates structure with Anthropic-style parts.
 */
function transformGeminiCandidate(candidate: any): any {
  if (!candidate || typeof candidate !== "object") {
    return candidate;
  }

  const content = candidate.content;
  if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
    return candidate;
  }

  const thinkingTexts: string[] = [];
  const transformedParts = content.parts.map((part: any) => {
    if (!part || typeof part !== "object") {
      return part;
    }

    // Handle Gemini-style: thought: true
    if (part.thought === true) {
      const thinkingText = part.text || "";
      thinkingTexts.push(thinkingText);
      const transformed: Record<string, unknown> = { ...part, type: "reasoning" };
      if (part.cache_control) transformed.cache_control = part.cache_control;

      // Convert signature to providerMetadata format for OpenCode
      const sig = part.signature || part.thoughtSignature;
      if (sig) {
        transformed.providerMetadata = {
          anthropic: { signature: sig }
        };
        delete transformed.signature;
        delete transformed.thoughtSignature;
      }

      return transformed;
    }

    // Handle Anthropic-style in candidates: type: "thinking"
    if (part.type === "thinking") {
      const thinkingText = part.thinking || part.text || "";
      thinkingTexts.push(thinkingText);
      const transformed: Record<string, unknown> = {
        ...part,
        type: "reasoning",
        text: thinkingText,
        thought: true,
      };
      if (part.cache_control) transformed.cache_control = part.cache_control;

      // Convert signature to providerMetadata format for OpenCode
      const sig = part.signature || part.thoughtSignature;
      if (sig) {
        transformed.providerMetadata = {
          anthropic: { signature: sig }
        };
        delete transformed.signature;
        delete transformed.thoughtSignature;
      }

      return transformed;
    }

    // Handle functionCall: parse JSON strings in args and ensure args is always defined
    // (Ported from LLM-API-Key-Proxy's _extract_tool_call)
    // Fix: When Claude calls a tool with no parameters, args may be undefined.
    // opencode expects state.input to be a record, so we must ensure args: {} as fallback.
    if (part.functionCall) {
      const parsedArgs = part.functionCall.args
        ? recursivelyParseJsonStrings(part.functionCall.args)
        : {};
      return {
        ...part,
        functionCall: {
          ...part.functionCall,
          args: parsedArgs,
        },
      };
    }

    // Handle image data (inlineData) - save to disk and return file path
    if (part.inlineData) {
      const result = processImageData({
        mimeType: part.inlineData.mimeType,
        data: part.inlineData.data,
      });
      if (result) {
        return { text: result };
      }
    }

    return part;
  });

  return {
    ...candidate,
    content: { ...content, parts: transformedParts },
    ...(thinkingTexts.length > 0 ? { reasoning_content: thinkingTexts.join("\n\n") } : {}),
  };
}

/**
 * Transforms thinking/reasoning content in response parts to OpenCode's expected format.
 * Handles both Gemini-style (thought: true) and Anthropic-style (type: "thinking") formats.
 * Also extracts reasoning_content for Anthropic-style responses.
 */
export function transformThinkingParts(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    return response;
  }

  const resp = response as Record<string, unknown>;
  const result: Record<string, unknown> = { ...resp };
  const reasoningTexts: string[] = [];

  // Handle Anthropic-style content array (type: "thinking")
  if (Array.isArray(resp.content)) {
    const transformedContent: any[] = [];
    for (const block of resp.content) {
      if (isRecord(block) && block.type === "thinking") {
        const rawThinkingText = block.thinking ?? block.text;
        const thinkingText = typeof rawThinkingText === "string" ? rawThinkingText : "";
        reasoningTexts.push(thinkingText);
        const transformed: Record<string, unknown> = {
          ...block,
          type: "reasoning",
          text: thinkingText,
          thought: true,
        };

        // Convert signature to providerMetadata format for OpenCode
        const sig = block.signature || block.thoughtSignature;
        if (sig) {
          transformed.providerMetadata = {
            anthropic: { signature: sig }
          };
          delete transformed.signature;
          delete transformed.thoughtSignature;
        }

        transformedContent.push(transformed);
      } else {
        transformedContent.push(block);
      }
    }
    result.content = transformedContent;
  }

  // Handle Gemini-style candidates array
  if (Array.isArray(resp.candidates)) {
    result.candidates = resp.candidates.map(transformGeminiCandidate);
  }

  // Add reasoning_content if we found any thinking blocks (for Anthropic-style)
  if (reasoningTexts.length > 0 && !result.reasoning_content) {
    result.reasoning_content = reasoningTexts.join("\n\n");
  }

  return result;
}

/**
 * Ensures thinkingConfig is valid: includeThoughts only allowed when budget > 0.
 */
export function normalizeThinkingConfig(config: unknown): ThinkingConfig | undefined {
  if (!config || typeof config !== "object") {
    return undefined;
  }

  const record = config as Record<string, unknown>;
  const budgetRaw = record.thinkingBudget ?? record.thinking_budget;
  const includeRaw = record.includeThoughts ?? record.include_thoughts;

  const thinkingBudget = typeof budgetRaw === "number" && Number.isFinite(budgetRaw) ? budgetRaw : undefined;
  const includeThoughts = typeof includeRaw === "boolean" ? includeRaw : undefined;

  const enableThinking = thinkingBudget !== undefined && thinkingBudget > 0;
  const finalInclude = enableThinking ? includeThoughts ?? false : false;

  if (!enableThinking && finalInclude === false && thinkingBudget === undefined && includeThoughts === undefined) {
    return undefined;
  }

  const normalized: ThinkingConfig = {};
  if (thinkingBudget !== undefined) {
    normalized.thinkingBudget = thinkingBudget;
  }
  if (finalInclude !== undefined) {
    normalized.includeThoughts = finalInclude;
  }
  return normalized;
}
