import type { HeaderStyle } from "../constants"
import type { AccountManager, ManagedAccount, ModelFamily } from "./accounts"
import { resolveQuotaFallbackHeaderStyle } from "./request-url"

export interface InitialRateLimitRoutingInput {
  accountManager: Pick<
    AccountManager,
    | "isRateLimitedForHeaderStyle"
    | "hasOtherAccountWithAntigravityAvailable"
    | "getAvailableHeaderStyle"
  >;
  account: ManagedAccount;
  family: ModelFamily;
  model: string | null;
  headerStyle: HeaderStyle;
  allowQuotaFallback: boolean;
}

export interface InitialRateLimitRoutingResult {
  shouldSwitchAccount: boolean;
  headerStyle: HeaderStyle;
  toastMessage?: string;
  debugMessage?: string;
}

/**
 * Resolve initial header-style and account-switch decisions before entering
 * the endpoint retry loop.
 */
export function resolveInitialRateLimitRouting(
  input: InitialRateLimitRoutingInput,
): InitialRateLimitRoutingResult {
  const {
    accountManager,
    account,
    family,
    model,
    allowQuotaFallback,
  } = input
  let { headerStyle } = input
  let shouldSwitchAccount = false
  let toastMessage: string | undefined
  let debugMessage: string | undefined

  if (!accountManager.isRateLimitedForHeaderStyle(account, family, headerStyle, model)) {
    return {
      shouldSwitchAccount,
      headerStyle,
    }
  }

  if (allowQuotaFallback && family === "gemini" && headerStyle === "antigravity") {
    if (
      accountManager.hasOtherAccountWithAntigravityAvailable(
        account.index,
        family,
        model,
      )
    ) {
      shouldSwitchAccount = true
      debugMessage =
        `antigravity rate-limited on account ${account.index}, but available on other accounts. Switching.`
      return {
        shouldSwitchAccount,
        headerStyle,
        debugMessage,
      }
    }

    const alternateStyle = accountManager.getAvailableHeaderStyle(
      account,
      family,
      model,
    )
    const fallbackStyle = resolveQuotaFallbackHeaderStyle({
      family,
      headerStyle,
      alternateStyle,
    })
    if (fallbackStyle) {
      headerStyle = fallbackStyle
      toastMessage = "Antigravity quota exhausted on all accounts. Using Gemini CLI quota."
      debugMessage = `all-accounts antigravity exhausted, quota fallback: ${headerStyle}`
      return {
        shouldSwitchAccount,
        headerStyle,
        toastMessage,
        debugMessage,
      }
    }

    shouldSwitchAccount = true
    return {
      shouldSwitchAccount,
      headerStyle,
    }
  }

  if (allowQuotaFallback && family === "gemini") {
    const alternateStyle = accountManager.getAvailableHeaderStyle(
      account,
      family,
      model,
    )
    const fallbackStyle = resolveQuotaFallbackHeaderStyle({
      family,
      headerStyle,
      alternateStyle,
    })
    if (fallbackStyle) {
      const quotaName = headerStyle === "gemini-cli" ? "Gemini CLI" : "Antigravity"
      const altQuotaName = fallbackStyle === "gemini-cli" ? "Gemini CLI" : "Antigravity"
      headerStyle = fallbackStyle
      toastMessage = `${quotaName} quota exhausted, using ${altQuotaName} quota`
      debugMessage = `quota fallback: ${headerStyle}`
      return {
        shouldSwitchAccount,
        headerStyle,
        toastMessage,
        debugMessage,
      }
    }
  }

  shouldSwitchAccount = true
  return {
    shouldSwitchAccount,
    headerStyle,
  }
}
