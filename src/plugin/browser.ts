/**
 * Browser-launch helpers.
 *
 * Handles opening URLs in the system browser across platforms
 * (macOS, Windows, WSL, Linux/X11/Wayland).
 */

import { exec } from "node:child_process";
import { isWSL, isWSL2, isRemoteEnvironment } from "./environment";

/**
 * Returns `true` if it is not safe to start a local OAuth callback server
 * (i.e. the browser is not on the same host as the process).
 */
export function shouldSkipLocalServer(): boolean {
  return isWSL2() || isRemoteEnvironment();
}

/**
 * Open `url` in the system browser.
 * Returns `true` if a browser command was dispatched, `false` if no suitable
 * browser was found (headless / no display).
 */
export async function openBrowser(url: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      exec(`open "${url}"`);
      return true;
    }
    if (process.platform === "win32") {
      exec(`start "" "${url}"`);
      return true;
    }
    if (isWSL()) {
      try {
        exec(`wslview "${url}"`);
        return true;
      } catch {}
    }
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      return false;
    }
    exec(`xdg-open "${url}"`);
    return true;
  } catch {
    return false;
  }
}
