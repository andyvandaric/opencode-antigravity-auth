import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface AccountMetadata {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  isRateLimited?: boolean;
  rateLimitResetTime?: number;
}

export interface AccountStorage {
  version: 1;
  accounts: AccountMetadata[];
  /**
   * Rotation cursor (next index to start from).
   *
   * Historical note: some forks call this `activeIndex`.
   */
  activeIndex: number;
}

function getConfigDir(): string {
  const platform = process.platform;
  if (platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "opencode");
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}

export function getStoragePath(): string {
  return join(getConfigDir(), "antigravity-accounts.json");
}

/**
 * Deduplicates accounts by email, keeping only the most recent entry for each email.
 * Accounts without email are kept as-is (no deduplication possible).
 */
export function deduplicateAccountsByEmail(accounts: AccountMetadata[]): AccountMetadata[] {
  const emailToNewestIndex = new Map<string, number>();
  const indicesToKeep = new Set<number>();
  
  // First pass: find the newest account for each email (by lastUsed, then addedAt)
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (!acc) continue;
    
    if (!acc.email) {
      // No email - keep this account (can't deduplicate without email)
      indicesToKeep.add(i);
      continue;
    }
    
    const existingIndex = emailToNewestIndex.get(acc.email);
    if (existingIndex === undefined) {
      emailToNewestIndex.set(acc.email, i);
      continue;
    }
    
    // Compare to find which is newer
    const existing = accounts[existingIndex];
    if (!existing) {
      emailToNewestIndex.set(acc.email, i);
      continue;
    }
    
    // Prefer higher lastUsed, then higher addedAt
    const currentScore = (acc.lastUsed || 0) * 1000000 + (acc.addedAt || 0);
    const existingScore = (existing.lastUsed || 0) * 1000000 + (existing.addedAt || 0);
    
    if (currentScore > existingScore) {
      emailToNewestIndex.set(acc.email, i);
    }
  }
  
  // Add all the newest email-based indices to the keep set
  for (const idx of emailToNewestIndex.values()) {
    indicesToKeep.add(idx);
  }
  
  // Build the deduplicated list, preserving original order for kept items
  const result: AccountMetadata[] = [];
  for (let i = 0; i < accounts.length; i++) {
    if (indicesToKeep.has(i)) {
      const acc = accounts[i];
      if (acc) {
        result.push(acc);
      }
    }
  }
  
  return result;
}

export async function loadAccounts(): Promise<AccountStorage | null> {
  try {
    const path = getStoragePath();
    const content = await fs.readFile(path, "utf-8");
    const parsed = JSON.parse(content) as Partial<AccountStorage>;

    if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      console.warn("[opencode-antigravity-auth] Invalid account storage format, ignoring");
      return null;
    }

    const validAccounts = parsed.accounts.filter((a): a is AccountMetadata => {
      return !!a && typeof a === "object" && typeof (a as AccountMetadata).refreshToken === "string";
    });
    
    // Deduplicate accounts by email (keeps newest entry for each email)
    const deduplicatedAccounts = deduplicateAccountsByEmail(validAccounts);
    
    // Clamp activeIndex to valid range after deduplication
    let activeIndex = typeof parsed.activeIndex === "number" && Number.isFinite(parsed.activeIndex) ? parsed.activeIndex : 0;
    if (deduplicatedAccounts.length > 0) {
      activeIndex = Math.min(activeIndex, deduplicatedAccounts.length - 1);
      activeIndex = Math.max(activeIndex, 0);
    } else {
      activeIndex = 0;
    }

    return {
      version: 1,
      accounts: deduplicatedAccounts,
      activeIndex,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    console.error("[opencode-antigravity-auth] Failed to load account storage:", error);
    return null;
  }
}

export async function saveAccounts(storage: AccountStorage): Promise<void> {
  const path = getStoragePath();
  await fs.mkdir(dirname(path), { recursive: true });

  const content = JSON.stringify(storage, null, 2);
  await fs.writeFile(path, content, "utf-8");
}

export async function clearAccounts(): Promise<void> {
  try {
    const path = getStoragePath();
    await fs.unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error("[opencode-antigravity-auth] Failed to clear account storage:", error);
    }
  }
}
