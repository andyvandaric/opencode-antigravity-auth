import { isRecord } from "./types"

const ANTIGRAVITY_PREVIEW_LINK = "https://goo.gle/enable-preview-features" // TODO: Update to Antigravity link if available

export interface AntigravityApiError {
  code?: number;
  message?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Minimal representation of Antigravity API responses we touch.
 */
export interface AntigravityApiBody {
  response?: unknown;
  error?: AntigravityApiError;
  [key: string]: unknown;
}

/**
 * Usage metadata exposed by Antigravity responses. Fields are optional to reflect partial payloads.
 */
export interface AntigravityUsageMetadata {
  totalTokenCount?: number;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

/**
 * Parses an Antigravity API body; handles array-wrapped responses the API sometimes returns.
 */
export function parseAntigravityApiBody(rawText: string): AntigravityApiBody | null {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      const firstObject = parsed.find((item: unknown) => isRecord(item));
      if (isRecord(firstObject)) {
        return firstObject as AntigravityApiBody;
      }
      return null;
    }

    if (isRecord(parsed)) {
      return parsed as AntigravityApiBody;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts usageMetadata from a response object, guarding types.
 */
export function extractUsageMetadata(body: AntigravityApiBody): AntigravityUsageMetadata | null {
  const usage = (body.response && typeof body.response === "object"
    ? (body.response as { usageMetadata?: unknown }).usageMetadata
    : undefined) as AntigravityUsageMetadata | undefined;

  if (!usage || typeof usage !== "object") {
    return null;
  }

  const asRecord = usage as Record<string, unknown>;
  const toNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  return {
    totalTokenCount: toNumber(asRecord.totalTokenCount),
    promptTokenCount: toNumber(asRecord.promptTokenCount),
    candidatesTokenCount: toNumber(asRecord.candidatesTokenCount),
    cachedContentTokenCount: toNumber(asRecord.cachedContentTokenCount),
    thoughtsTokenCount: toNumber(asRecord.thoughtsTokenCount),
  };
}

/**
 * Walks SSE lines to find a usage-bearing response chunk.
 */
export function extractUsageFromSsePayload(payload: string): AntigravityUsageMetadata | null {
  const lines = payload.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const jsonText = line.slice(5).trim();
    if (!jsonText) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (isRecord(parsed)) {
        const usage = extractUsageMetadata({ response: parsed.response });
        if (usage) {
          return usage;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Enhances 404 errors for Antigravity models with a direct preview-access message.
 */
export function rewriteAntigravityPreviewAccessError(
  body: AntigravityApiBody,
  status: number,
  requestedModel?: string,
): AntigravityApiBody | null {
  if (!needsPreviewAccessOverride(status, body, requestedModel)) {
    return null;
  }

  const error: AntigravityApiError = body.error ?? {};
  const trimmedMessage = typeof error.message === "string" ? error.message.trim() : "";
  const messagePrefix = trimmedMessage.length > 0
    ? trimmedMessage
    : "Antigravity preview features are not enabled for this account.";
  const enhancedMessage = `${messagePrefix} Request preview access at ${ANTIGRAVITY_PREVIEW_LINK} before using this model.`;

  return {
    ...body,
    error: {
      ...error,
      message: enhancedMessage,
    },
  };
}

function needsPreviewAccessOverride(
  status: number,
  body: AntigravityApiBody,
  requestedModel?: string,
): boolean {
  if (status !== 404) {
    return false;
  }

  if (isAntigravityModel(requestedModel)) {
    return true;
  }

  const errorMessage = typeof body.error?.message === "string" ? body.error.message : "";
  return isAntigravityModel(errorMessage);
}

function isAntigravityModel(target?: string): boolean {
  if (!target) {
    return false;
  }

  // Check for Antigravity models instead of Gemini 3
  return /antigravity/i.test(target) || /opus/i.test(target) || /claude/i.test(target);
}

// ============================================================================
// EMPTY RESPONSE DETECTION (Ported from LLM-API-Key-Proxy)
// ============================================================================

/**
 * Checks if a JSON response body represents an empty response.
 * 
 * Empty responses occur when:
 * - No candidates in Gemini format
 * - No choices in OpenAI format
 * - Candidates/choices exist but have no content
 * 
 * @param text - The response body text (should be valid JSON)
 * @returns true if the response is empty
 */
export function isEmptyResponseBody(text: string): boolean {
  if (!text || !text.trim()) {
    return true;
  }

  try {
    const parsed = JSON.parse(text);
    
    // Check for empty candidates (Gemini/Antigravity format)
    if (parsed.candidates !== undefined) {
      if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
        return true;
      }
      
      // Check if first candidate has empty content
      const firstCandidate = parsed.candidates[0];
      if (!firstCandidate) {
        return true;
      }
      
      // Check for empty parts in content
      const content = firstCandidate.content;
      if (!content || typeof content !== "object") {
        return true;
      }
      
      const parts = content.parts;
      if (!Array.isArray(parts) || parts.length === 0) {
        return true;
      }
      
      // Check if all parts are empty (no text, no functionCall)
      const hasContent = parts.some((part: any) => {
        if (!part || typeof part !== "object") return false;
        if (typeof part.text === "string" && part.text.length > 0) return true;
        if (part.functionCall) return true;
        if (part.thought === true && typeof part.text === "string") return true;
        return false;
      });
      
      if (!hasContent) {
        return true;
      }
    }
    
    // Check for empty choices (OpenAI format - shouldn't occur but handle it)
    if (parsed.choices !== undefined) {
      if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) {
        return true;
      }
      
      const firstChoice = parsed.choices[0];
      if (!firstChoice) {
        return true;
      }
      
      // Check for empty message/delta
      const message = firstChoice.message || firstChoice.delta;
      if (!message) {
        return true;
      }
      
      // Check if message has content or tool_calls
      if (!message.content && !message.tool_calls && !message.reasoning_content) {
        return true;
      }
    }
    
    // Check response wrapper (Antigravity envelope)
    if (parsed.response !== undefined) {
      const response = parsed.response;
      if (!response || typeof response !== "object") {
        return true;
      }
      return isEmptyResponseBody(JSON.stringify(response));
    }
    
    return false;
  } catch {
    // JSON parse error - treat as empty
    return true;
  }
}

/**
 * Checks if a streaming SSE response yielded zero meaningful chunks.
 * 
 * This is used after consuming a streaming response to determine if retry is needed.
 */
export interface StreamingChunkCounter {
  increment: () => void;
  getCount: () => number;
  hasContent: () => boolean;
}

export function createStreamingChunkCounter(): StreamingChunkCounter {
  let count = 0;
  let hasRealContent = false;

  return {
    increment: () => {
      count++;
    },
    getCount: () => count,
    hasContent: () => hasRealContent || count > 0,
  };
}

/**
 * Checks if an SSE line contains meaningful content.
 * 
 * @param line - A single SSE line (e.g., "data: {...}")
 * @returns true if the line contains content worth counting
 */
export function isMeaningfulSseLine(line: string): boolean {
  if (!line.startsWith("data: ")) {
    return false;
  }

  const data = line.slice(6).trim();
  
  if (data === "[DONE]") {
    return false;
  }

  if (!data) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed)) {
      return false;
    }
    
    // Check for candidates with content
    if (Array.isArray(parsed.candidates)) {
      for (const candidate of parsed.candidates) {
        const parts = isRecord(candidate) && isRecord(candidate.content)
          ? candidate.content.parts
          : undefined;
        if (Array.isArray(parts) && parts.length > 0) {
          for (const part of parts) {
            if (isRecord(part) && typeof part.text === "string" && part.text.length > 0) return true;
            if (isRecord(part) && part.functionCall !== undefined) return true;
          }
        }
      }
    }
    
    // Check response wrapper
    if (isRecord(parsed.response) && parsed.response.candidates !== undefined) {
      return isMeaningfulSseLine(`data: ${JSON.stringify(parsed.response)}`);
    }
    
    return false;
  } catch {
    return false;
  }
}
