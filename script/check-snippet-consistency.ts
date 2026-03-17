import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const DEFAULT_PROTECTED_PATHS = [
  "README.md",
  "docs/INSTALLATION.md",
  "docs/TROUBLESHOOTING.md",
  ".github/workflows/release.yml",
  ".github/workflows/release-beta.yml",
  ".github/workflows/republish-version.yml",
]

const PLURAL_PLUGIN_KEY_PATTERN = /"plugins"\s*:/

interface Violation {
  filePath: string
  line: number
  content: string
}

function parseCliPaths(argv: string[]): string[] {
  const paths: string[] = []

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--path") {
      const value = argv[i + 1]
      if (!value) {
        console.error("Missing value after --path")
        process.exit(2)
      }
      paths.push(value)
      i++
    }
  }

  return paths
}

function findViolations(filePath: string): Violation[] {
  const absolutePath = resolve(filePath)
  const content = readFileSync(absolutePath, "utf8")
  const lines = content.split(/\r?\n/)

  return lines.flatMap((line, index) => {
    if (!PLURAL_PLUGIN_KEY_PATTERN.test(line)) {
      return []
    }

    return [{
      filePath,
      line: index + 1,
      content: line.trim(),
    }]
  })
}

function main(): void {
  const cliPaths = parseCliPaths(process.argv.slice(2))
  const targetPaths = cliPaths.length > 0 ? cliPaths : DEFAULT_PROTECTED_PATHS

  const violations = targetPaths.flatMap((path) => findViolations(path))

  if (violations.length === 0) {
    console.log(`Snippet consistency check passed (${targetPaths.length} files scanned)`)
    return
  }

  console.error("Snippet consistency check failed: found plural \"plugins\" key in protected install snippets")
  for (const violation of violations) {
    console.error(`- ${violation.filePath}:${violation.line} -> ${violation.content}`)
  }

  process.exit(1)
}

main()
