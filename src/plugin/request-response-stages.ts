import {
  extractUsageFromSsePayload,
  extractUsageMetadata,
  parseAntigravityApiBody,
  rewriteAntigravityPreviewAccessError,
  transformThinkingParts,
  type AntigravityApiBody,
} from "./request-helpers"
import {
  createStreamingTransformer,
  type SignatureStore,
} from "./core/streaming"
import {
  isDebugEnabled,
  logAntigravityDebugResponse,
  logCacheStats,
  type AntigravityDebugContext,
} from "./debug"
import { getKeepThinking, isDebugTuiEnabled } from "./config"
import { detectErrorType } from "./recovery"
import { isRecord } from "./types"

type StreamingStageInput = {
  response: Response
  streaming: boolean
  isEventStreamResponse: boolean
  debugContext?: AntigravityDebugContext | null
  debugText?: string
  cacheSignatures: boolean
  sessionId?: string
  displayedThinkingHashes?: Set<string>
  displayedThinkingHashesMaxSize?: number
  signatureStore: SignatureStore
  cacheSignature: (sessionKey: string, text: string, signature: string) => void
  injectDebugThinking: (response: unknown, debugText: string) => unknown
}

type BufferedStageInput = {
  response: Response
  streaming: boolean
  isEventStreamResponse: boolean
  debugContext?: AntigravityDebugContext | null
  requestedModel?: string
  projectId?: string
  endpoint?: string
  effectiveModel?: string
  toolDebugMissing?: number
  toolDebugSummary?: string
  toolDebugPayload?: string
  debugText?: string
  injectDebugThinking: (response: unknown, debugText: string) => unknown
}

export type ThinkingRecoveryError = Error & {
  recoveryType: "thinking_block_order"
  originalError: {
    error?: {
      message?: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  debugInfo: string
}

function applyRetryHeadersFromErrorDetails(
  headers: Headers,
  errorBody: { error?: { details?: unknown[] } },
): void {
  if (!Array.isArray(errorBody.error?.details)) {
    return
  }

  const retryInfo = errorBody.error.details.find(
    (detail) =>
      isRecord(detail) &&
      detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
  )

  if (!isRecord(retryInfo) || typeof retryInfo.retryDelay !== "string") {
    return
  }

  const match = retryInfo.retryDelay.match(/^([\d.]+)s$/)
  if (!match || !match[1]) {
    return
  }

  const retrySeconds = parseFloat(match[1])
  if (isNaN(retrySeconds) || retrySeconds <= 0) {
    return
  }

  headers.set("Retry-After", Math.ceil(retrySeconds).toString())
  headers.set("retry-after-ms", Math.ceil(retrySeconds * 1000).toString())
}

export function buildResponseDebugText(
  debugLines: string[] | undefined,
  syntheticThinkingPlaceholder: string,
  formatDebugLinesForThinking: (lines: string[]) => string,
): string | undefined {
  if (isDebugEnabled() && Array.isArray(debugLines) && debugLines.length > 0) {
    return formatDebugLinesForThinking(debugLines)
  }

  if (isDebugTuiEnabled() || getKeepThinking()) {
    return syntheticThinkingPlaceholder
  }

  return undefined
}

export function transformStreamingResponseStage(input: StreamingStageInput): Response | null {
  const {
    response,
    streaming,
    isEventStreamResponse,
    debugContext,
    debugText,
    cacheSignatures,
    sessionId,
    displayedThinkingHashes,
    displayedThinkingHashesMaxSize,
    signatureStore,
    cacheSignature,
    injectDebugThinking,
  } = input

  if (!(streaming && response.ok && isEventStreamResponse && response.body)) {
    return null
  }

  const headers = new Headers(response.headers)
  logAntigravityDebugResponse(debugContext, response, {
    note: "Streaming SSE response (real-time transform)",
  })

  const streamingTransformer = createStreamingTransformer(
    signatureStore,
    {
      onCacheSignature: cacheSignature,
      onInjectDebug: injectDebugThinking,
      transformThinkingParts,
    },
    {
      signatureSessionKey: sessionId,
      debugText,
      cacheSignatures,
      displayedThinkingHashes,
      displayedThinkingHashesMaxSize,
    },
  )

  return new Response(response.body.pipeThrough(streamingTransformer), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function transformBufferedResponseStage(input: BufferedStageInput): Promise<Response> {
  const {
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
  } = input

  const headers = new Headers(response.headers)
  const text = await response.text()

  if (!response.ok) {
    let errorBody: {
      error?: {
        message?: string
        [key: string]: unknown
      }
      [key: string]: unknown
    }

    try {
      const parsed = JSON.parse(text) as unknown
      errorBody = typeof parsed === "object" && parsed !== null
        ? (parsed as typeof errorBody)
        : { error: { message: text } }
    } catch {
      errorBody = { error: { message: text } }
    }

    applyRetryHeadersFromErrorDetails(
      headers,
      errorBody as { error?: { details?: unknown[] } },
    )

    if (errorBody?.error) {
      const debugInfo = `\n\n[Debug Info]\nRequested Model: ${requestedModel || "Unknown"}\nEffective Model: ${effectiveModel || "Unknown"}\nProject: ${projectId || "Unknown"}\nEndpoint: ${endpoint || "Unknown"}\nStatus: ${response.status}\nRequest ID: ${headers.get("x-request-id") || "N/A"}${toolDebugMissing !== undefined ? `\nTool Debug Missing: ${toolDebugMissing}` : ""}${toolDebugSummary ? `\nTool Debug Summary: ${toolDebugSummary}` : ""}${toolDebugPayload ? `\nTool Debug Payload: ${toolDebugPayload}` : ""}`
      const injectedDebug = debugText ? `\n\n${debugText}` : ""
      errorBody.error.message = (errorBody.error.message || "Unknown error") + debugInfo + injectedDebug

      const errorType = detectErrorType(errorBody.error.message || "")
      if (errorType === "thinking_block_order") {
        const recoveryError: ThinkingRecoveryError = Object.assign(
          new Error("THINKING_RECOVERY_NEEDED"),
          {
            recoveryType: errorType,
            originalError: errorBody,
            debugInfo,
          },
        )
        throw recoveryError
      }

      const errorMessage = errorBody.error.message?.toLowerCase() || ""
      if (
        errorMessage.includes("prompt is too long") ||
        errorMessage.includes("context length exceeded") ||
        errorMessage.includes("context_length_exceeded") ||
        errorMessage.includes("maximum context length")
      ) {
        headers.set("x-antigravity-context-error", "prompt_too_long")
      }

      if (
        errorMessage.includes("tool_use") &&
        errorMessage.includes("tool_result") &&
        (errorMessage.includes("without") || errorMessage.includes("immediately after"))
      ) {
        headers.set("x-antigravity-context-error", "tool_pairing")
      }

      return new Response(JSON.stringify(errorBody), {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
  }

  const init = {
    status: response.status,
    statusText: response.statusText,
    headers,
  }

  const usageFromSse = streaming && isEventStreamResponse ? extractUsageFromSsePayload(text) : null
  const parsed: AntigravityApiBody | null = !streaming || !isEventStreamResponse ? parseAntigravityApiBody(text) : null
  const patched = parsed ? rewriteAntigravityPreviewAccessError(parsed, response.status, requestedModel) : null
  const effectiveBody = patched ?? parsed ?? undefined
  const usage = usageFromSse ?? (effectiveBody ? extractUsageMetadata(effectiveBody) : null)

  if (usage && effectiveModel) {
    logCacheStats(
      effectiveModel,
      usage.cachedContentTokenCount ?? 0,
      0,
      usage.promptTokenCount ?? usage.totalTokenCount ?? 0,
    )
  }

  if (usage?.cachedContentTokenCount !== undefined) {
    headers.set("x-antigravity-cached-content-token-count", String(usage.cachedContentTokenCount))
    if (usage.totalTokenCount !== undefined) {
      headers.set("x-antigravity-total-token-count", String(usage.totalTokenCount))
    }
    if (usage.promptTokenCount !== undefined) {
      headers.set("x-antigravity-prompt-token-count", String(usage.promptTokenCount))
    }
    if (usage.candidatesTokenCount !== undefined) {
      headers.set("x-antigravity-candidates-token-count", String(usage.candidatesTokenCount))
    }
  }

  logAntigravityDebugResponse(debugContext, response, {
    body: text,
    note: streaming ? "Streaming SSE payload (buffered fallback)" : undefined,
    headersOverride: headers,
  })

  if (!parsed) {
    return new Response(text, init)
  }

  if (effectiveBody?.response !== undefined) {
    let responseBody: unknown = effectiveBody.response
    if (debugText) {
      responseBody = injectDebugThinking(responseBody, debugText)
    }
    const transformed = transformThinkingParts(responseBody)
    return new Response(JSON.stringify(transformed), init)
  }

  if (patched) {
    return new Response(JSON.stringify(patched), init)
  }

  return new Response(text, init)
}

export function shouldTransformAntigravityBody(contentType: string): {
  isJsonResponse: boolean
  isEventStreamResponse: boolean
  shouldTransform: boolean
} {
  const isJsonResponse = contentType.includes("application/json")
  const isEventStreamResponse = contentType.includes("text/event-stream")
  return {
    isJsonResponse,
    isEventStreamResponse,
    shouldTransform: isJsonResponse || isEventStreamResponse,
  }
}
