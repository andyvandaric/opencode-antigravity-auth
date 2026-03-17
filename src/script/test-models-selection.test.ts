import { describe, expect, it } from "vitest"

import {
  MODELS,
  selectModelTests,
  type ModelCategory,
  type ModelTest,
} from "../../script/test-models.ts"
import { OPENCODE_MODEL_DEFINITIONS } from "../plugin/config/models"

const BASE_MODELS: ModelTest[] = [
  { model: "google/gemini-3-flash-preview", category: "gemini-cli" },
  { model: "google/antigravity-gemini-3.1-pro-low", category: "antigravity-gemini" },
]

describe("selectModelTests", () => {
  it("keeps configured script models aligned with model definitions", () => {
    for (const configured of MODELS) {
      const modelName = configured.model.replace(/^google\//, "")
      const definition = OPENCODE_MODEL_DEFINITIONS[modelName]

      expect(definition, `${modelName} should exist in OPENCODE_MODEL_DEFINITIONS`).toBeDefined()

      if (configured.variant) {
        expect(
          definition?.variants?.[configured.variant],
          `${modelName} should support variant ${configured.variant}`,
        ).toBeDefined()
      }
    }
  })

  it("returns matching configured model when filter exists", () => {
    const tests = selectModelTests(BASE_MODELS, {
      filterModel: "google/gemini-3-flash-preview",
      filterCategory: null,
    })

    expect(tests).toEqual([
      { model: "google/gemini-3-flash-preview", category: "gemini-cli" },
    ])
  })

  it("matches configured model by suffix", () => {
    const tests = selectModelTests(BASE_MODELS, {
      filterModel: "gemini-3-flash-preview",
      filterCategory: null,
    })

    expect(tests).toEqual([
      { model: "google/gemini-3-flash-preview", category: "gemini-cli" },
    ])
  })

  it("falls back to ad-hoc model when name is not in configured list", () => {
    const tests = selectModelTests(BASE_MODELS, {
      filterModel: "gemini-nonexistent-image-model",
      filterCategory: null,
    })

    expect(tests).toEqual([
      { model: "gemini-nonexistent-image-model", category: "custom" },
    ])
  })

  it("keeps ad-hoc model when category filter is custom", () => {
    const tests = selectModelTests(BASE_MODELS, {
      filterModel: "gemini-nonexistent-image-model",
      filterCategory: "custom",
    })

    expect(tests).toEqual([
      { model: "gemini-nonexistent-image-model", category: "custom" },
    ])
  })

  it("returns empty when category excludes ad-hoc model", () => {
    const tests = selectModelTests(BASE_MODELS, {
      filterModel: "gemini-nonexistent-image-model",
      filterCategory: "gemini-cli",
    })

    expect(tests).toEqual([])
  })

  it("filters configured list by category without model filter", () => {
    const tests = selectModelTests(BASE_MODELS, {
      filterModel: null,
      filterCategory: "antigravity-gemini",
    })

    expect(tests).toEqual([
      { model: "google/antigravity-gemini-3.1-pro-low", category: "antigravity-gemini" },
    ])
  })
})

const _categoryTypeCheck: ModelCategory = "custom"
void _categoryTypeCheck
