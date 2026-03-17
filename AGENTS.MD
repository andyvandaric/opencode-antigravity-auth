# AGENTS.md
Guidance for coding agents working in `C:\Users\Kailash\Project\opencode-ag-auth`.

## What This Repo Is
`opencode-ag-auth` is an OpenCode plugin that intercepts Google Generative Language API requests and rewrites them for Antigravity and Gemini CLI flows.
Primary responsibilities:
- OAuth login and token refresh
- request/response transformation
- Claude/Gemini thinking block handling
- session recovery for interrupted tool runs
- quota management and multi-account rotation
- plugin configuration and small TUI helpers
## Source Of Truth Files
When you need to understand behavior, start here:
- `package.json` - scripts and dependency versions
- `tsconfig.json` - strictness and module settings for dev/typecheck
- `tsconfig.build.json` - build output settings
- `vitest.config.ts` - test discovery and environment
- `src/plugin.ts` - main plugin entrypoint
- `src/plugin/request.ts` - core request transformation pipeline
- `src/plugin/config/schema.ts` - runtime config schema and defaults
- `README.md` and `docs/` - product behavior and user-facing details
## Commands
Use Bun for local development commands.
```bash
bun install
bun run build
bun run typecheck
bun test
bun run test:watch
bun run test:ui
bun run test:coverage
bun run build:schema
bun run test:snippet-consistency
bun run test:e2e:models
bun run test:e2e:regression
```
## Single Test Commands
Prefer direct Vitest invocation through Bun when narrowing scope.
```bash
bun vitest run src/plugin/auth.test.ts
bun vitest run src/plugin/auth.test.ts -t "parses refresh parts"
bun vitest run -t "parses refresh parts"
bun vitest src/plugin/auth.test.ts --watch
```
Notes:
- `bun test` maps to `vitest run`
- `vitest.config.ts` includes `src/**/*.test.ts`
- tests run in the `node` environment with `globals: true`
- there is no configured lint command in `package.json`
## Cursor / Copilot Rules
No repository-level Cursor or Copilot instruction files were found:
- no `.cursorrules`
- no `.cursor/rules/`
- no `.github/copilot-instructions.md`
This `AGENTS.md` is the canonical agent guidance in this repository.
## Repository Layout
Important areas in `src/`:
- `src/plugin.ts` - plugin registration, auth workflow, fetch interception, recovery hooks
- `src/constants.ts` - endpoint constants, headers, prompts, model constants
- `src/antigravity/oauth.ts` - OAuth exchange helpers
- `src/plugin/` - main implementation modules
- `src/plugin/config/` - config loader, schema, model definitions, updater
- `src/plugin/transform/` - model-specific request shaping for Claude and Gemini
- `src/plugin/core/streaming/` - streaming response transformation
- `src/plugin/ui/` - CLI/TUI menu helpers
- `src/hooks/auto-update-checker/` - plugin auto-update hook
- `script/` - repo maintenance and e2e helper scripts
Tests are colocated with source files as `*.test.ts`.
## TypeScript And Build Settings
The project uses TypeScript 5 with native ESM.
Important compiler settings from `tsconfig.json`:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `module: "Preserve"`
- `moduleResolution: "bundler"`
- `verbatimModuleSyntax: true`
- `allowImportingTsExtensions: true`
Build-specific behavior from `tsconfig.build.json`:
- emits to `dist/`
- generates declarations and source maps
- excludes test files from build output
- turns off `allowImportingTsExtensions` for emitted build output
## Style Expectations
This repo has a few mixed conventions across older and newer files. Do not mass-normalize style. Match the surrounding file unless you have a strong reason not to.
### Imports
- prefer `import type` for type-only imports; many files rely on this because `verbatimModuleSyntax` is enabled
- import ordering is usually: Node builtins, external packages, then local modules
- relative imports are common throughout `src/`
- the repo currently contains both extensionless relative imports and `.ts` suffixed imports; follow the local file's pattern
- named imports are common, but default imports do exist in some files; do not rewrite import style repo-wide unless required
### Exports
- most modules use named exports
- barrel files such as `index.ts` are used in some folders
- avoid introducing default exports unless you are matching an existing file pattern or external API requirement
### Naming
- use `camelCase` for variables, functions, and parameters
- use `PascalCase` for types, interfaces, classes, and schemas used as type sources
- use `UPPER_SNAKE_CASE` for constants
- use `kebab-case` for filenames such as `request-prepare-thinking.ts`
- keep test filenames colocated and named `*.test.ts`
### Types
- prefer explicit unions and narrow helper predicates over loose casting
- use `z.infer<typeof SomeSchema>` for Zod-derived types
- local type guards like `isRecord` and `isMessageWithContent` are a common pattern
- never introduce `as any`, `@ts-ignore`, or `@ts-expect-error`
- keep shared types in nearby `types.ts` files when reuse becomes significant
### Functions And Control Flow
- public APIs usually use `export function ...`
- callbacks and small helpers often use arrow functions
- favor small helper functions over deeply nested inline logic when touching complex request code
- preserve defensive branches around malformed payloads; the plugin is intentionally tolerant of odd upstream input
### Error Handling
- use targeted `try/catch`, not blanket swallowing
- catch unknown failures and convert them into safe fallbacks or domain-specific behavior
- empty catch blocks are not acceptable
- graceful degradation is preferred over hard crashes, especially in auth, quota, recovery, and request transformation code
- preserve retry, fallback, and recovery behavior when refactoring
### Logging
- use `createLogger("module-name")` from `src/plugin/logger.ts` for structured logs
- `console.*` appears in some files as fallback or user-facing output; do not add casual debug prints
- if you need debug output, prefer existing debug/logging utilities over ad hoc logging
### Formatting
- use 2-space indentation
- prefer double quotes in new code
- keep multiline objects, arrays, and imports trailing-comma friendly
- semicolon usage is mixed in the current codebase; preserve the style of the file you edit
- comments are acceptable when they explain non-obvious protocol behavior, recovery logic, or compatibility hacks
## Testing Guidance
- use Vitest APIs: `describe`, `it` or `test`, `expect`, `vi`
- mock with `vi.fn`, `vi.spyOn`, `vi.mock`, and `vi.mocked`
- when changing a source file, look for a colocated `*.test.ts` file first
- request transformation, auth, quota, and config code all have solid unit-test coverage patterns to copy
- if you add behavior to a transformation or recovery path, add or update the nearest focused unit test
## Agent Workflow Expectations
- before editing, inspect the nearest implementation and test files for local conventions
- after editing TypeScript, run `bun run typecheck`
- run the smallest relevant test file first, then broader tests if the change is cross-cutting
- run `bun run build` before finishing if you changed runtime code or types that affect emitted output
- do not invent rules that are not evidenced by the repo; document mixed conventions honestly
## Useful References
- `README.md` - install and usage guidance
- `docs/ARCHITECTURE.md` - architecture overview
- `docs/CONFIGURATION.md` - runtime config behavior
- `docs/MULTI-ACCOUNT.md` - account rotation and quota behavior
- `docs/TROUBLESHOOTING.md` - known failure modes and recovery expectations
