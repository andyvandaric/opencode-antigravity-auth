# Typescript Project Rules

> **Primary Language**: typescript
> **Stack**: typescript
> **Generated**: 2026-02-15 16:14:11

> [!NOTE]
> **Project-Specific Standards**: This file contains universal RULES (HOW to code).
> For project-specific FACTS (WHAT commands, ports, env vars), see:
> - [PROJECT_STANDARDS.md](../.flowcrate/PROJECT_STANDARDS.md) - Commands, naming, environment
>
> Generate/update with: `flowcrate standards init`

> [!CAUTION]
> **MANDATORY: AI MUST READ LINKED RULES FILES!**
> This GEMINI.md is a modular index. Before ANY work:
> 1. **ALWAYS read [flowcrate Workflow](./rules/workflow.md)** - Contains ALL flowcrate CLI commands, checklist management, task creation workflow
> 2. If working on Rust code, read `./rules/skills/tauri.md`
> 3. If working on TypeScript, read `./rules/typescript.md`
> 
> **Failure to read workflow.md = workflow violations (missing checklists, wrong CLI usage, etc.)**

---

## 🚨 Critical Rules Summary

> [!WARNING]
> **This is only a HIGHLIGHT!** You MUST still read [workflow.md](./rules/workflow.md) for complete rules.
> Skipping workflow.md = incomplete understanding = violations.

> [!CAUTION]
> **MANDATORY: ALL project work MUST use flowcrate workflow!**
> - NEVER start coding without creating/tracking a task in flowcrate
> - ALWAYS check `flowcrate list` before starting work
> - ALWAYS move task to appropriate status before implementing
> - Violation = Critical workflow breach

### Pre-Flight Check (Before ANY Code)
```bash
# 1. Check for existing tasks
flowcrate list --status doing --json | Out-String

# 2. If no task exists, create one
flowcrate create "Title" -t feat -p 2 -d "Description" --json | Out-String

# 3. Add checklist items
flowcrate checklist add <id> "Requirement 1" --json | Out-String

# 4. Move to Doing BEFORE writing code
flowcrate move <id> doing --json | Out-String
```

### Forbidden Transitions
- ❌ `Backlog → Done` (skips time tracking)
- ❌ `Ready → Done` (skips time tracking)
- ❌ No card → Any code change

### Done Checklist (MANDATORY)
1. Update plan status: `> **Status**: ✅ DONE`
2. Toggle checklist items: `flowcrate checklist toggle <id> <pos>`
3. Move task: `flowcrate move <id> done`
4. Commit: `git commit -m "feat(scope): description"`
5. Attach commit: `flowcrate commit <id>`

---

## Project Configuration

| Setting | Value |
|---------|-------|
| Test Command | `bun test` |
| Build Command | `bun build` |
| Package Manager | bun |
| Naming Convention | camelCase |

### 🔧 Common Commands

| Command | Purpose |
|---------|--------|
| `bun install` | Install dependencies |
| `bun clean` | **Clean all caches (run before builds!)** |
| `bun dev` or `bun tauri:dev` | Start dev server |
| `bun build` or `bun build:ui` | Build UI |
| `bun build:prod` | Build UI (production, obfuscated) |
| `bun test` | Run tests |
| `bun typecheck` | TypeScript type checking |
> [!CAUTION]
> **ALWAYS run clean before installer builds!**
> ```bash
> bun clean         # Remove all caches
> bun install       # Fresh install
> bun build         # Production build
> ```
> Cached artifacts cause installer issues and version mismatches.

## Rules Index

The following rules apply to this project. Click to view details.

### Project Standards
> Project-specific FACTS (commands, ports, environment)

- [PROJECT_STANDARDS.md](../.flowcrate/PROJECT_STANDARDS.md) - **Auto-generated**, edit as needed

### Core Rules
> Universal workflow rules (HOW to use flowcrate)

- [flowcrate Workflow](./rules/workflow.md)

### Language Rules
- [Typescript](./rules/typescript.md)
- [Bash/Shell](./rules/bash.md)
- [PowerShell (Windows)](./rules/powershell.md)

### Universal Rules
- [Coding Principles](./rules/coding-principles.md)
- [Security Best Practices](./rules/security.md)
- [Testing Guidelines](./rules/testing.md)
- [Markdown Standards](./rules/markdown.md)
- [Database Design](./rules/database.md)
- [DevOps & CI/CD](./rules/devops.md)

### Framework Skills
- [Typescript](./rules/skills/typescript.md)

### Universal Skills
- [TDD Workflow](./rules/skills/tdd-workflow.md)
- [Git Workflow](./rules/skills/git-workflow.md)

---

## 📝 User Customizations

Add your project-specific rules below. This section is preserved during sync.

<!-- USER_RULES_START -->
<!-- USER_RULES_END -->
