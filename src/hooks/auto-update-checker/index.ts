import type { AutoUpdateCheckerOptions } from "./types";
import { getCachedVersion, getLocalDevVersion, findPluginEntry, getLatestVersion, updatePinnedVersion } from "./checker";
import { invalidatePackage } from "./cache";
import { PACKAGE_NAME } from "./constants";

interface PluginClient {
  tui: {
    showToast(options: {
      body: {
        title?: string;
        message: string;
        variant: "info" | "warning" | "success" | "error";
        duration?: number;
      };
    }): Promise<unknown>;
  };
}

interface SessionCreatedEvent {
  type: "session.created";
  properties?: {
    info?: {
      parentID?: string;
    };
  };
}

type PluginEvent = SessionCreatedEvent | { type: string; properties?: unknown };

export function createAutoUpdateCheckerHook(
  client: PluginClient,
  directory: string,
  options: AutoUpdateCheckerOptions = {}
) {
  const { showStartupToast = true, autoUpdate = true } = options;

  let hasChecked = false;

  return {
    event: ({ event }: { event: PluginEvent }) => {
      if (event.type !== "session.created") return;
      if (hasChecked) return;

      const props = event.properties as { info?: { parentID?: string } } | undefined;
      if (props?.info?.parentID) return;

      hasChecked = true;

      setTimeout(() => {
        const localDevVersion = getLocalDevVersion(directory);

        if (localDevVersion) {
          if (showStartupToast) {
            showLocalDevToast(client, localDevVersion).catch(() => {});
          }
          console.log("[auto-update-checker] Local development mode");
          return;
        }

        runBackgroundUpdateCheck(client, directory, autoUpdate).catch((err) => {
          console.log("[auto-update-checker] Background update check failed:", err);
        });
      }, 0);
    },
  };
}

async function runBackgroundUpdateCheck(
  client: PluginClient,
  directory: string,
  autoUpdate: boolean
): Promise<void> {
  const pluginInfo = findPluginEntry(directory);
  if (!pluginInfo) {
    console.log("[auto-update-checker] Plugin not found in config");
    return;
  }

  const cachedVersion = getCachedVersion();
  const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion;
  if (!currentVersion) {
    console.log("[auto-update-checker] No version found (cached or pinned)");
    return;
  }

  const latestVersion = await getLatestVersion();
  if (!latestVersion) {
    console.log("[auto-update-checker] Failed to fetch latest version");
    return;
  }

  if (currentVersion === latestVersion) {
    console.log("[auto-update-checker] Already on latest version");
    return;
  }

  console.log(`[auto-update-checker] Update available: ${currentVersion} → ${latestVersion}`);

  if (!autoUpdate) {
    await showUpdateAvailableToast(client, latestVersion);
    console.log("[auto-update-checker] Auto-update disabled, notification only");
    return;
  }

  if (pluginInfo.isPinned) {
    const updated = updatePinnedVersion(pluginInfo.configPath, pluginInfo.entry, latestVersion);
    if (updated) {
      invalidatePackage(PACKAGE_NAME);
      await showAutoUpdatedToast(client, currentVersion, latestVersion);
      console.log(`[auto-update-checker] Config updated: ${pluginInfo.entry} → ${PACKAGE_NAME}@${latestVersion}`);
    } else {
      await showUpdateAvailableToast(client, latestVersion);
    }
  } else {
    invalidatePackage(PACKAGE_NAME);
    await showUpdateAvailableToast(client, latestVersion);
  }
}

async function showUpdateAvailableToast(client: PluginClient, latestVersion: string): Promise<void> {
  await client.tui
    .showToast({
      body: {
        title: `Antigravity Auth Update`,
        message: `v${latestVersion} available. Restart OpenCode to apply.`,
        variant: "info" as const,
        duration: 8000,
      },
    })
    .catch(() => {});
  console.log(`[auto-update-checker] Update available toast shown: v${latestVersion}`);
}

async function showAutoUpdatedToast(client: PluginClient, oldVersion: string, newVersion: string): Promise<void> {
  await client.tui
    .showToast({
      body: {
        title: `Antigravity Auth Updated!`,
        message: `v${oldVersion} → v${newVersion}\nRestart OpenCode to apply.`,
        variant: "success" as const,
        duration: 8000,
      },
    })
    .catch(() => {});
  console.log(`[auto-update-checker] Auto-updated toast shown: v${oldVersion} → v${newVersion}`);
}

async function showLocalDevToast(client: PluginClient, version: string): Promise<void> {
  await client.tui
    .showToast({
      body: {
        title: `Antigravity Auth ${version} (dev)`,
        message: "Running in local development mode.",
        variant: "warning" as const,
        duration: 5000,
      },
    })
    .catch(() => {});
  console.log(`[auto-update-checker] Local dev toast shown: v${version}`);
}

export type { UpdateCheckResult, AutoUpdateCheckerOptions } from "./types";
export { checkForUpdate, getCachedVersion, getLatestVersion } from "./checker";
export { invalidatePackage, invalidateCache } from "./cache";
