import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { saveAccounts, saveAccountsReplace, getStoragePath } from "./storage.ts"
import type { AccountStorageV4, AccountMetadataV3 } from "./storage.ts"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"

describe("AccountStorage Contention", () => {
  let tempDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tempDir = join(tmpdir(), "opencode-contention-" + randomBytes(8).toString("hex"))
    await fs.mkdir(tempDir, { recursive: true })
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = tempDir
  })

  afterEach(async () => {
    process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  function createMockStorage(accountSuffix: string): AccountStorageV4 {
    return {
      version: 4,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: `token-${accountSuffix}`,
          projectId: `proj-${accountSuffix}`,
          managedProjectId: `managed-${accountSuffix}`,
          addedAt: Date.now(),
          lastUsed: 0,
          rateLimitResetTimes: {},
          verificationRequired: false,
        } as AccountMetadataV3,
      ],
    }
  }

  it("handles concurrent saveAccounts writes correctly (merge behavior)", async () => {
    const numConcurrent = 10
    const writePromises = []

    for (let i = 0; i < numConcurrent; i++) {
      const storage = createMockStorage(i.toString())
      writePromises.push(saveAccounts(storage))
    }

    await Promise.all(writePromises)

    const storagePath = getStoragePath()
    const content = await fs.readFile(storagePath, "utf-8")
    const finalStorage = JSON.parse(content) as AccountStorageV4

    expect(finalStorage.version).toBe(4)
    expect(finalStorage.accounts).toHaveLength(numConcurrent)

    // Verify all accounts are present
    const refreshTokens = finalStorage.accounts.map(a => a.refreshToken).sort()
    for (let i = 0; i < numConcurrent; i++) {
      expect(refreshTokens).toContain(`token-${i}`)
    }
  }, 30000)

  it("handles concurrent saveAccountsReplace writes correctly (last-write-wins)", async () => {
    const numConcurrent = 10
    const writePromises = []

    for (let i = 0; i < numConcurrent; i++) {
      const storage = createMockStorage(i.toString())
      writePromises.push(saveAccountsReplace(storage))
    }

    await Promise.all(writePromises)

    const storagePath = getStoragePath()
    const content = await fs.readFile(storagePath, "utf-8")
    const finalStorage = JSON.parse(content) as AccountStorageV4

    expect(finalStorage.version).toBe(4)
    // In replace mode, it's last-write-wins, so we expect exactly 1 account
    expect(finalStorage.accounts).toHaveLength(1)
    expect(finalStorage.accounts[0]?.refreshToken).toMatch(/^token-\d+$/)
  }, 30000)

})
