import {
  EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
  EMPTY_SCHEMA_PLACEHOLDER_NAME,
  CLAUDE_DESCRIPTION_PROMPT,
  CLAUDE_TOOL_SYSTEM_INSTRUCTION,
} from "../constants"
import {
  cleanJSONSchemaForAntigravity,
  injectParameterSignatures,
  injectToolHardeningInstruction,
} from "./request-helpers"
import { applyGeminiTransforms } from "./transform"
import type { ThinkingTier } from "./transform"

type ApplyPrepareToolsStageInput = {
  requestPayload: Record<string, unknown>
  isClaude: boolean
  effectiveModel: string
  tierThinkingBudget: number | undefined
  tierThinkingLevel: string | undefined
  claudeToolHardening: boolean
  toolDebugMissing: number
}

type ApplyPrepareToolsStageResult = {
  toolDebugMissing: number
  toolDebugSummaries: string[]
  toolDebugPayload: string | undefined
}

function createPlaceholderSchema(base: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...base,
    type: "object",
    properties: {
      [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
        type: "boolean",
        description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
      },
    },
    required: [EMPTY_SCHEMA_PLACEHOLDER_NAME],
  }
}

function normalizeToolSchema(
  schema: unknown,
  toolDebugMissing: number,
): { normalized: Record<string, unknown>; toolDebugMissing: number } {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return {
      normalized: createPlaceholderSchema(),
      toolDebugMissing: toolDebugMissing + 1,
    }
  }

  const cleaned = cleanJSONSchemaForAntigravity(schema)
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    return {
      normalized: createPlaceholderSchema(),
      toolDebugMissing: toolDebugMissing + 1,
    }
  }

  const cleanedRecord = cleaned as Record<string, unknown>
  const hasProperties =
    cleanedRecord.properties &&
    typeof cleanedRecord.properties === "object" &&
    Object.keys(cleanedRecord.properties as Record<string, unknown>).length > 0

  cleanedRecord.type = "object"
  if (!hasProperties) {
    cleanedRecord.properties = {
      [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
        type: "boolean",
        description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
      },
    }
    cleanedRecord.required = Array.isArray(cleanedRecord.required)
      ? Array.from(new Set([...cleanedRecord.required, EMPTY_SCHEMA_PLACEHOLDER_NAME]))
      : [EMPTY_SCHEMA_PLACEHOLDER_NAME]
  }

  return {
    normalized: cleanedRecord,
    toolDebugMissing,
  }
}

export function applyPrepareToolsStage(
  input: ApplyPrepareToolsStageInput,
): ApplyPrepareToolsStageResult {
  const {
    requestPayload,
    isClaude,
    effectiveModel,
    tierThinkingBudget,
    tierThinkingLevel,
    claudeToolHardening,
  } = input

  const toolDebugSummaries: string[] = []
  let toolDebugPayload: string | undefined
  let toolDebugMissing = input.toolDebugMissing

  const hasTools = Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0
  if (!hasTools) {
    return { toolDebugMissing, toolDebugSummaries, toolDebugPayload }
  }

  if (isClaude) {
    const functionDeclarations: Array<Record<string, unknown>> = []
    const passthroughTools: unknown[] = []

    const tools = requestPayload.tools as unknown[]
    for (const toolValue of tools) {
      if (!toolValue || typeof toolValue !== "object") {
        passthroughTools.push(toolValue)
        continue
      }

      const tool = toolValue as Record<string, unknown>
      const pushDeclaration = (declValue: unknown, source: string) => {
        const decl = declValue && typeof declValue === "object"
          ? (declValue as Record<string, unknown>)
          : {}

        const functionTool = tool.function && typeof tool.function === "object"
          ? (tool.function as Record<string, unknown>)
          : undefined
        const customTool = tool.custom && typeof tool.custom === "object"
          ? (tool.custom as Record<string, unknown>)
          : undefined

        const schemaCandidate =
          decl.parameters ??
          decl.parametersJsonSchema ??
          decl.input_schema ??
          decl.inputSchema ??
          tool.parameters ??
          tool.parametersJsonSchema ??
          tool.input_schema ??
          tool.inputSchema ??
          functionTool?.parameters ??
          functionTool?.parametersJsonSchema ??
          functionTool?.input_schema ??
          functionTool?.inputSchema ??
          customTool?.parameters ??
          customTool?.parametersJsonSchema ??
          customTool?.input_schema

        const schemaResult = normalizeToolSchema(schemaCandidate, toolDebugMissing)
        toolDebugMissing = schemaResult.toolDebugMissing

        const rawName =
          decl.name ??
          tool.name ??
          functionTool?.name ??
          customTool?.name ??
          `tool-${functionDeclarations.length}`
        const name = String(rawName).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)

        const description =
          decl.description ??
          tool.description ??
          functionTool?.description ??
          customTool?.description ??
          ""

        functionDeclarations.push({
          name,
          description: String(description || ""),
          parameters: schemaResult.normalized,
        })

        toolDebugSummaries.push(
          `decl=${name},src=${source},hasSchema=${schemaCandidate ? "y" : "n"}`,
        )
      }

      const declarationsValue = tool.functionDeclarations
      if (Array.isArray(declarationsValue) && declarationsValue.length > 0) {
        for (const decl of declarationsValue) {
          pushDeclaration(decl, "functionDeclarations")
        }
        continue
      }

      if (tool.function || tool.custom || tool.parameters || tool.input_schema || tool.inputSchema) {
        pushDeclaration((tool.function ?? tool.custom ?? tool), "function/custom")
        continue
      }

      passthroughTools.push(tool)
    }

    const finalTools: unknown[] = []
    if (functionDeclarations.length > 0) {
      finalTools.push({ functionDeclarations })
    }
    requestPayload.tools = finalTools.concat(passthroughTools)
  } else {
    const geminiResult = applyGeminiTransforms(requestPayload, {
      model: effectiveModel,
      normalizedThinking: undefined,
      tierThinkingBudget,
      tierThinkingLevel: tierThinkingLevel as ThinkingTier | undefined,
    })

    toolDebugMissing = geminiResult.toolDebugMissing
    toolDebugSummaries.push(...geminiResult.toolDebugSummaries)
  }

  try {
    toolDebugPayload = JSON.stringify(requestPayload.tools)
  } catch {
    toolDebugPayload = undefined
  }

  if (claudeToolHardening && isClaude && Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0) {
    requestPayload.tools = injectParameterSignatures(
      requestPayload.tools,
      CLAUDE_DESCRIPTION_PROMPT,
    )
    injectToolHardeningInstruction(
      requestPayload,
      CLAUDE_TOOL_SYSTEM_INSTRUCTION,
    )
  }

  return {
    toolDebugMissing,
    toolDebugSummaries,
    toolDebugPayload,
  }
}
