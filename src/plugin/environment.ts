/**
 * Environment-detection helpers – cached at module load.
 *
 * All heavy I/O (reading /proc/version) is done once and the results are
 * reused for the entire process lifetime.  This replaces the per-call
 * `readFileSync("/proc/version")` pattern that existed in plugin.ts and
 * server.ts.
 */

import { readFileSync } from "node:fs";

// ── Cached /proc/version ──────────────────────────────────────────

const _procVersion: string | null = (() => {
  if (process.platform !== "linux") return null;
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase();
  } catch {
    return null;
  }
})();

// ── WSL detection ─────────────────────────────────────────────────

/**
 * Returns `true` when running inside WSL (version 1 *or* 2).
 *
 * The check is evaluated once and cached.
 */
export function isWSL(): boolean {
  return _isWSL;
}

const _isWSL: boolean = (() => {
  if (!_procVersion) return false;
  return _procVersion.includes("microsoft") || _procVersion.includes("wsl");
})();

/**
 * Returns `true` only when running under WSL **2**.
 *
 * The check is evaluated once and cached.
 */
export function isWSL2(): boolean {
  return _isWSL2;
}

const _isWSL2: boolean = (() => {
  if (!_isWSL) return false;
  if (!_procVersion) return false;
  return (
    _procVersion.includes("wsl2") ||
    _procVersion.includes("microsoft-standard")
  );
})();

// ── Remote environment detection ──────────────────────────────────

/**
 * Best-effort check for SSH, containers, or headless remote setups.
 *
 * Unlike the WSL helpers the result is *not* cached because environment
 * variables could theoretically change (e.g. `DISPLAY` set after launch).
 * The function is pure logic with no I/O, so there's no performance concern.
 */
export function isRemoteEnvironment(): boolean {
  if (
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY ||
    process.env.SSH_CONNECTION
  ) {
    return true;
  }
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) {
    return true;
  }
  if (
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY &&
    !_isWSL
  ) {
    return true;
  }
  return false;
}
