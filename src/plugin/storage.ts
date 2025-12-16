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

export async function loadAccounts(): Promise<AccountStorage | null> {
  try {
    const path = getStoragePath();
    const content = await fs.readFile(path, "utf-8");
    const parsed = JSON.parse(content) as Partial<AccountStorage>;

    if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      console.warn("[opencode-antigravity-auth] Invalid account storage format, ignoring");
      return null;
    }

    return {
      version: 1,
      accounts: parsed.accounts.filter((a): a is AccountMetadata => {
        return !!a && typeof a === "object" && typeof (a as AccountMetadata).refreshToken === "string";
      }),
      activeIndex: typeof parsed.activeIndex === "number" && Number.isFinite(parsed.activeIndex) ? parsed.activeIndex : 0,
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
