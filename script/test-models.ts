#!/usr/bin/env npx tsx
import { spawn } from "child_process";
import { resolve } from "path";
import { pathToFileURL } from "url";

export type ModelCategory =
  | "gemini-cli"
  | "antigravity-gemini"
  | "antigravity-claude"
  | "custom";

export interface ModelTest {
  model: string;
  category: ModelCategory;
  variant?: "minimal" | "low" | "medium" | "high" | "max";
}

export const MODELS: ModelTest[] = [
  // Gemini CLI (direct Google API)
  { model: "google/gemini-3-flash-preview", category: "gemini-cli" },
  { model: "google/gemini-3.1-pro-preview", category: "gemini-cli" },
  { model: "google/gemini-2.5-pro", category: "gemini-cli" },
  { model: "google/gemini-2.5-flash", category: "gemini-cli" },

  // Antigravity Gemini
  { model: "google/antigravity-gemini-3.1-pro", category: "antigravity-gemini", variant: "low" },
  { model: "google/antigravity-gemini-3.1-pro", category: "antigravity-gemini", variant: "high" },
  { model: "google/antigravity-gemini-3-flash", category: "antigravity-gemini", variant: "medium" },

  // Antigravity Claude
  { model: "google/antigravity-claude-sonnet-4-6", category: "antigravity-claude" },
  { model: "google/antigravity-claude-sonnet-4-6-thinking", category: "antigravity-claude", variant: "low" },
  { model: "google/antigravity-claude-sonnet-4-6-thinking", category: "antigravity-claude", variant: "max" },
  { model: "google/antigravity-claude-opus-4-6-thinking", category: "antigravity-claude", variant: "low" },
  { model: "google/antigravity-claude-opus-4-6-thinking", category: "antigravity-claude", variant: "max" },
];

const TEST_PROMPT = "Reply with exactly one word: WORKING";
const DEFAULT_TIMEOUT_MS = 120_000;

interface TestResult {
  success: boolean;
  error?: string;
  duration: number;
}

async function testModel(model: string, timeoutMs: number, variant?: ModelTest["variant"]): Promise<TestResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "opencode.cmd" : "opencode";
    const args = ["run", TEST_PROMPT, "--model", model];
    if (variant) {
      args.push("--variant", variant);
    }

    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ success: false, error: `Timeout after ${timeoutMs}ms`, duration: Date.now() - start });
    }, timeoutMs);

    proc.stdout?.on("data", (data) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const duration = Date.now() - start;

      if (code !== 0) {
        resolve({ success: false, error: `Exit ${code}: ${stderr || stdout}`.slice(0, 200), duration });
      } else {
        resolve({ success: true, duration });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message, duration: Date.now() - start });
    });
  });
}

export interface ScriptArgs {
  filterModel: string | null;
  filterCategory: ModelCategory | null;
  dryRun: boolean;
  help: boolean;
  timeout: number;
}

export function parseArgs(args: string[] = process.argv.slice(2)): ScriptArgs {
  const modelIdx = args.indexOf("--model");
  const catIdx = args.indexOf("--category");
  const timeoutIdx = args.indexOf("--timeout");

  return {
    filterModel: modelIdx !== -1 ? args[modelIdx + 1] ?? null : null,
    filterCategory: catIdx !== -1 ? (args[catIdx + 1] as ModelCategory | undefined) ?? null : null,
    dryRun: args.includes("--dry-run"),
    help: args.includes("--help") || args.includes("-h"),
    timeout: timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1] || "120000", 10) : DEFAULT_TIMEOUT_MS,
  };
}

export function selectModelTests(models: ModelTest[], args: Pick<ScriptArgs, "filterModel" | "filterCategory">): ModelTest[] {
  let tests = models;

  if (args.filterModel) {
    const modelFilter = args.filterModel;
    const configuredMatches = tests.filter((t) => t.model === modelFilter || t.model.endsWith(modelFilter));
    tests = configuredMatches.length > 0
      ? configuredMatches
      : [{ model: modelFilter, category: "custom" }];
  }

  if (args.filterCategory) {
    tests = tests.filter((t) => t.category === args.filterCategory);
  }

  return tests;
}

function printHelp(): void {
  console.log(`
E2E Model Test Script

Usage:
  npx tsx script/test-models.ts [options]

Options:
  --model <model>      Test specific model
  --category <cat>     Test by category (gemini-cli, antigravity-gemini, antigravity-claude, custom)
  --timeout <ms>       Timeout per model (default: 120000)
  --dry-run            List models without testing
  --help, -h           Show this help

Examples:
  npx tsx script/test-models.ts --dry-run
  npx tsx script/test-models.ts --model google/gemini-3-flash-preview
  npx tsx script/test-models.ts --category antigravity-claude
`);
}

async function main(): Promise<void> {
  const { filterModel, filterCategory, dryRun, help, timeout } = parseArgs();

  if (help) {
    printHelp();
    return;
  }

  const tests = selectModelTests(MODELS, { filterModel, filterCategory });

  if (tests.length === 0) {
    console.log("No models match the filter.");
    return;
  }

  console.log(`\n🧪 E2E Model Tests (${tests.length} models)\n${"=".repeat(50)}\n`);

  if (dryRun) {
    for (const t of tests) {
      const withVariant = t.variant ? `${t.model} (variant=${t.variant})` : t.model;
      console.log(`  ${withVariant.padEnd(68)} [${t.category}]`);
    }
    console.log(`\n${tests.length} models would be tested.\n`);
    return;
  }

  let passed = 0;
  let failed = 0;
  const failures: { model: string; error: string }[] = [];

  for (const t of tests) {
    const displayName = t.variant ? `${t.model} [${t.variant}]` : t.model;
    process.stdout.write(`Testing ${displayName.padEnd(68)} ... `);
    const result = await testModel(t.model, timeout, t.variant);

    if (result.success) {
      console.log(`✅ (${(result.duration / 1000).toFixed(1)}s)`);
      passed++;
    } else {
      console.log(`❌ FAIL`);
      console.log(`   ${result.error}`);
      failures.push({ model: t.model, error: result.error || "Unknown" });
      failed++;
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Summary: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log("Failed models:");
    for (const f of failures) {
      console.log(`  - ${f.model}`);
    }
    process.exit(1);
  }
}

function isMainModule(argv: string[] = process.argv, moduleUrl: string = import.meta.url): boolean {
  const entrypoint = argv[1];
  if (!entrypoint) {
    return false;
  }

  return pathToFileURL(resolve(entrypoint)).href === moduleUrl;
}

if (isMainModule()) {
  main().catch(console.error);
}
