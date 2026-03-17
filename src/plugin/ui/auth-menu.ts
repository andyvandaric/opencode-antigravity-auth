import { ANSI } from "./ansi";
import { select, type MenuItem } from "./select";
import { confirm } from "./confirm";

export type AccountStatus =
  | "active"
  | "rate-limited"
  | "expired"
  | "verification-required"
  | "unknown";

export interface AccountInfo {
  email?: string;
  index: number;
  addedAt?: number;
  lastUsed?: number;
  status?: AccountStatus;
  /** Which quota families are rate-limited (e.g. ['claude'], ['gemini'], ['claude', 'gemini']) */
  rateLimitedFamilies?: string[];
  /** Remaining ms until rate limit resets, keyed by family */
  rateLimitResetIn?: Record<string, number>;
  isCurrentAccount?: boolean;
  enabled?: boolean;
}

export type AuthMenuAction =
  | { type: "add" }
  | { type: "select-account"; account: AccountInfo }
  | { type: "delete-all" }
  | { type: "check" }
  | { type: "verify" }
  | { type: "verify-all" }
  | { type: "configure-models" }
  | { type: "gemini-cli-login" }
  | { type: "cancel" };

export type AccountAction =
  | "back"
  | "delete"
  | "refresh"
  | "toggle"
  | "verify"
  | "cancel";

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "never";
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return "unknown";
  return new Date(timestamp).toLocaleDateString();
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

function formatRateLimitBadge(
  families?: string[],
  resetIn?: Record<string, number>,
): string {
  if (!families || families.length === 0) {
    return `${ANSI.yellow}[rate-limited]${ANSI.reset}`;
  }
  const parts = families.sort().map((f) => {
    const remaining = resetIn?.[f];
    return remaining ? `${f} resets in ${formatCountdown(remaining)}` : f;
  });
  return `${ANSI.yellow}[rate-limited: ${parts.join(", ")}]${ANSI.reset}`;
}

function getStatusBadge(
  status: AccountStatus | undefined,
  rateLimitedFamilies?: string[],
  rateLimitResetIn?: Record<string, number>,
): string {
  switch (status) {
    case "active": {
      const badge = `${ANSI.green}[active]${ANSI.reset}`;
      if (rateLimitedFamilies && rateLimitedFamilies.length > 0) {
        const limited = rateLimitedFamilies
          .sort()
          .map((f) => {
            const remaining = rateLimitResetIn?.[f];
            const countdown = remaining
              ? `, resets in ${formatCountdown(remaining)}`
              : "";
            return `${ANSI.yellow}[${f}: limited${countdown}]${ANSI.reset}`;
          })
          .join(" ");
        return `${badge} ${limited}`;
      }
      return badge;
    }
    case "rate-limited":
      return formatRateLimitBadge(rateLimitedFamilies, rateLimitResetIn);
    case "expired":
      return `${ANSI.red}[expired]${ANSI.reset}`;
    case "verification-required":
      return `${ANSI.red}[needs verification]${ANSI.reset}`;
    default:
      return "";
  }
}

export async function showAuthMenu(
  accounts: AccountInfo[],
): Promise<AuthMenuAction> {
  const items: MenuItem<AuthMenuAction>[] = [
    { label: "Actions", value: { type: "cancel" }, kind: "heading" },
    { label: "Add account", value: { type: "add" }, color: "cyan" },
    { label: "Check quotas", value: { type: "check" }, color: "cyan" },
    { label: "Verify one account", value: { type: "verify" }, color: "cyan" },
    {
      label: "Verify all accounts",
      value: { type: "verify-all" },
      color: "cyan",
    },
    {
      label: "Configure models in opencode.json",
      value: { type: "configure-models" },
      color: "cyan",
    },
    {
      label: "Login with Gemini CLI OAuth",
      value: { type: "gemini-cli-login" },
      color: "cyan",
    },

    { label: "", value: { type: "cancel" }, separator: true },

    { label: "Accounts", value: { type: "cancel" }, kind: "heading" },

    ...accounts.map((account) => {
      const statusBadge = getStatusBadge(
        account.status,
        account.rateLimitedFamilies,
        account.rateLimitResetIn,
      );
      const currentBadge = account.isCurrentAccount
        ? ` ${ANSI.cyan}[current]${ANSI.reset}`
        : "";
      const disabledBadge =
        account.enabled === false ? ` ${ANSI.red}[disabled]${ANSI.reset}` : "";
      const baseLabel = account.email || `Account ${account.index + 1}`;
      const numbered = `${account.index + 1}. ${baseLabel}`;
      const fullLabel = `${numbered}${currentBadge}${statusBadge ? " " + statusBadge : ""}${disabledBadge}`;

      return {
        label: fullLabel,
        hint: account.lastUsed
          ? `used ${formatRelativeTime(account.lastUsed)}`
          : "",
        value: { type: "select-account" as const, account },
      };
    }),

    { label: "", value: { type: "cancel" }, separator: true },

    { label: "Danger zone", value: { type: "cancel" }, kind: "heading" },
    {
      label: "Delete all accounts",
      value: { type: "delete-all" },
      color: "red" as const,
    },
  ];

  while (true) {
    const result = await select(items, {
      message: "Google accounts (Antigravity)",
      subtitle: "Select an action or account",
      clearScreen: true,
    });

    if (!result) return { type: "cancel" };

    if (result.type === "delete-all") {
      const confirmed = await confirm(
        "Delete ALL accounts? This cannot be undone.",
      );
      if (!confirmed) continue;
    }

    return result;
  }
}

export async function showAccountDetails(
  account: AccountInfo,
): Promise<AccountAction> {
  const label = account.email || `Account ${account.index + 1}`;
  const badge = getStatusBadge(
    account.status,
    account.rateLimitedFamilies,
    account.rateLimitResetIn,
  );
  const disabledBadge =
    account.enabled === false ? ` ${ANSI.red}[disabled]${ANSI.reset}` : "";
  const header = `${label}${badge ? " " + badge : ""}${disabledBadge}`;
  const subtitleParts = [
    `Added: ${formatDate(account.addedAt)}`,
    `Last used: ${formatRelativeTime(account.lastUsed)}`,
  ];

  while (true) {
    const result = await select(
      [
        { label: "Back", value: "back" as const },
        {
          label: "Verify account access",
          value: "verify" as const,
          color: "cyan",
        },
        {
          label:
            account.enabled === false ? "Enable account" : "Disable account",
          value: "toggle" as const,
          color: account.enabled === false ? "green" : "yellow",
        },
        { label: "Refresh token", value: "refresh" as const, color: "cyan" },
        {
          label: "Delete this account",
          value: "delete" as const,
          color: "red",
        },
      ],
      {
        message: header,
        subtitle: subtitleParts.join(" | "),
        clearScreen: true,
      },
    );

    if (result === "delete") {
      const confirmed = await confirm(`Delete ${label}?`);
      if (!confirmed) continue;
    }

    if (result === "refresh") {
      const confirmed = await confirm(`Re-authenticate ${label}?`);
      if (!confirmed) continue;
    }

    return result ?? "cancel";
  }
}

export { isTTY } from "./ansi";
