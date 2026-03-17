import {
  DEFAULT_THINKING_BUDGET,
  extractThinkingConfig,
  extractVariantThinkingConfig,
  isThinkingCapableModel,
  normalizeThinkingConfig,
  resolveThinkingConfig,
} from "./request-helpers"
import {
  buildImageGenerationConfig,
  isImageGenerationModel,
  CLAUDE_THINKING_MAX_OUTPUT_TOKENS,
} from "./transform"
import { SUPPORTED_IMAGE_GENERATION_MODELS } from "./transform/model-resolver"

type ThinkingTierLevel = "low" | "medium" | "high"

type ApplyPrepareThinkingStageInput = {
  requestPayload: Record<string, unknown>
  rawGenerationConfig: Record<string, unknown> | undefined
  extraBody: Record<string, unknown> | undefined
  effectiveModel: string
  isClaude: boolean
  isClaudeThinking: boolean
  tierThinkingBudget: number | undefined
  tierThinkingLevel: string | undefined
  resolvedIsThinkingModel: boolean | undefined
  applyGemini3ProTierToEffectiveModel: (level: string | undefined) => void
  warn: (message: string) => void
}

type ApplyPrepareThinkingStageResult = {
  tierThinkingBudget: number | undefined
  tierThinkingLevel: string | undefined
}

export function applyPrepareThinkingStage(
  input: ApplyPrepareThinkingStageInput,
): ApplyPrepareThinkingStageResult {
  const {
    requestPayload,
    rawGenerationConfig,
    extraBody,
    effectiveModel,
    isClaude,
    isClaudeThinking,
    resolvedIsThinkingModel,
    applyGemini3ProTierToEffectiveModel,
    warn,
  } = input

  let tierThinkingBudget = input.tierThinkingBudget
  let tierThinkingLevel = input.tierThinkingLevel

  const variantConfig = extractVariantThinkingConfig(
    requestPayload.providerOptions as Record<string, unknown> | undefined,
    rawGenerationConfig,
  )
  const isGemini3 = effectiveModel.toLowerCase().includes("gemini-3")

  if (variantConfig?.thinkingLevel && isGemini3) {
    tierThinkingLevel = variantConfig.thinkingLevel
    tierThinkingBudget = undefined
  } else if (variantConfig?.thinkingBudget) {
    if (isGemini3) {
      warn("[Deprecated] Using thinkingBudget for Gemini 3 model. Use thinkingLevel instead.")
      tierThinkingLevel = variantConfig.thinkingBudget <= 8192
        ? "low"
        : variantConfig.thinkingBudget <= 16384
        ? "medium"
        : "high"
      tierThinkingBudget = undefined
    } else {
      tierThinkingBudget = variantConfig.thinkingBudget
      tierThinkingLevel = undefined
    }
  }

  applyGemini3ProTierToEffectiveModel(tierThinkingLevel)

  const isImageModel = isImageGenerationModel(effectiveModel)
  const userThinkingConfig = isImageModel ? undefined : extractThinkingConfig(requestPayload, rawGenerationConfig, extraBody)
  const hasAssistantHistory = Array.isArray(requestPayload.contents) &&
    requestPayload.contents.some((content) => {
      if (!content || typeof content !== "object") return false
      const role = (content as Record<string, unknown>).role
      return role === "model" || role === "assistant"
    })

  const isClaudeSonnetNonThinking = effectiveModel.toLowerCase() === "claude-sonnet-4-6"
  const effectiveUserThinkingConfig = (isClaudeSonnetNonThinking || isImageModel) ? undefined : userThinkingConfig

  if (isImageModel) {
    if (!SUPPORTED_IMAGE_GENERATION_MODELS.includes(effectiveModel)) {
      throw new Error(
        `Image model "${effectiveModel}" is not supported at request layer. Supported: ${SUPPORTED_IMAGE_GENERATION_MODELS.join(", ")}`,
      )
    }

    const imageConfig = buildImageGenerationConfig()
    const generationConfig = (rawGenerationConfig ?? {}) as Record<string, unknown>
    generationConfig.imageConfig = imageConfig
    delete generationConfig.thinkingConfig
    if (!generationConfig.candidateCount) {
      generationConfig.candidateCount = 1
    }
    requestPayload.generationConfig = generationConfig

    if (!requestPayload.safetySettings) {
      requestPayload.safetySettings = [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_ONLY_HIGH" },
      ]
    }

    delete requestPayload.tools
    delete requestPayload.toolConfig
    requestPayload.systemInstruction = {
      parts: [{ text: "You are an AI image generator. Generate images based on user descriptions. Focus on creating high-quality, visually appealing images that match the user's request." }],
    }
  } else {
    const finalThinkingConfig = resolveThinkingConfig(
      effectiveUserThinkingConfig,
      isClaudeSonnetNonThinking ? false : (resolvedIsThinkingModel ?? isThinkingCapableModel(effectiveModel)),
      isClaude,
      hasAssistantHistory,
    )

    const normalizedThinking = normalizeThinkingConfig(finalThinkingConfig)
    if (normalizedThinking) {
      const thinkingBudget = tierThinkingBudget ?? normalizedThinking.thinkingBudget
      let thinkingConfig: Record<string, unknown>

      if (isClaudeThinking) {
        thinkingConfig = {
          include_thoughts: normalizedThinking.includeThoughts ?? true,
          ...(typeof thinkingBudget === "number" && thinkingBudget > 0
            ? { thinking_budget: thinkingBudget }
            : {}),
        }
      } else if (tierThinkingLevel) {
        thinkingConfig = {
          includeThoughts: normalizedThinking.includeThoughts,
          thinkingLevel: tierThinkingLevel,
        }
      } else {
        thinkingConfig = {
          includeThoughts: normalizedThinking.includeThoughts,
          ...(typeof thinkingBudget === "number" && thinkingBudget > 0 ? { thinkingBudget } : {}),
        }
      }

      if (rawGenerationConfig) {
        rawGenerationConfig.thinkingConfig = thinkingConfig

        if (isClaudeThinking && typeof thinkingBudget === "number" && thinkingBudget > 0) {
          const currentMax = (rawGenerationConfig.maxOutputTokens ?? rawGenerationConfig.max_output_tokens) as number | undefined
          if (!currentMax || currentMax <= thinkingBudget) {
            rawGenerationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS
            if (rawGenerationConfig.max_output_tokens !== undefined) {
              delete rawGenerationConfig.max_output_tokens
            }
          }
        }

        requestPayload.generationConfig = rawGenerationConfig
      } else {
        const generationConfig: Record<string, unknown> = { thinkingConfig }
        if (isClaudeThinking && typeof thinkingBudget === "number" && thinkingBudget > 0) {
          generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS
        }
        requestPayload.generationConfig = generationConfig
      }
    } else if (rawGenerationConfig) {
      delete rawGenerationConfig.thinkingConfig
      delete rawGenerationConfig.thinking_config
      delete rawGenerationConfig.thinkingBudget
      delete rawGenerationConfig.thinking_budget
      requestPayload.generationConfig = rawGenerationConfig
    }
  }

  if (extraBody) {
    delete extraBody.thinkingConfig
    delete extraBody.thinking
  }
  delete requestPayload.thinkingConfig
  delete requestPayload.thinking

  if ("system_instruction" in requestPayload) {
    requestPayload.systemInstruction = requestPayload.system_instruction
    delete requestPayload.system_instruction
  }

  if (isClaudeThinking && Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0) {
    const hint = "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them."
    const existing = requestPayload.systemInstruction

    if (typeof existing === "string") {
      requestPayload.systemInstruction = existing.trim().length > 0 ? `${existing}\n\n${hint}` : hint
    } else if (existing && typeof existing === "object") {
      const sys = existing as Record<string, unknown>
      const partsValue = sys.parts

      if (Array.isArray(partsValue)) {
        const parts = partsValue as Record<string, unknown>[]
        let appended = false

        for (let i = parts.length - 1; i >= 0; i--) {
          const part = parts[i]
          if (part && typeof part === "object") {
            const text = part.text
            if (typeof text === "string") {
              part.text = `${text}\n\n${hint}`
              appended = true
              break
            }
          }
        }

        if (!appended) {
          parts.push({ text: hint })
        }
      } else {
        sys.parts = [{ text: hint }]
      }

      requestPayload.systemInstruction = sys
    } else if (Array.isArray(requestPayload.contents)) {
      requestPayload.systemInstruction = { parts: [{ text: hint }] }
    }
  }

  return {
    tierThinkingBudget,
    tierThinkingLevel: tierThinkingLevel as ThinkingTierLevel | undefined,
  }
}
