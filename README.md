# Antigravity OAuth Plugin for Opencode

[![npm version](https://img.shields.io/npm/v/opencode-antigravity-auth.svg)](https://www.npmjs.com/package/opencode-antigravity-auth)

Enable Opencode to authenticate against **Antigravity** (Google's IDE) via OAuth so you can use Antigravity rate limits and access models like `gemini-3-pro-high` and `claude-opus-4-5-thinking` with your Google credentials.

## What you get

- **Google OAuth sign-in** (multi-account via `opencode auth login`) with automatic token refresh
- **Multi-account load balancing** Automatically cycle through multiple Google accounts to maximize rate limits
- **Automatic endpoint fallback** between Antigravity API endpoints (daily → autopush → prod)
- **Antigravity API compatibility** for OpenAI-style requests
- **Debug logging** for requests and responses
- **Drop-in setup** Opencode auto-installs the plugin from config

## Quick start

1) **Add the plugin to config** (`~/.config/opencode/opencode.json` or project `.opencode.json`):

```json
{
  "plugin": ["opencode-antigravity-auth@1.0.7"]
}
```

2) **Authenticate**

- For multi-account + per-account project IDs (recommended): run `opencode auth login`.
- For a quick single-account connect: open `opencode` and run `/connect`.
- Choose Google → **OAuth with Google (Antigravity)**.
- Sign in via the browser and return to Opencode. If the browser doesn’t open, use the displayed link.
- `opencode auth login` will ask for a project ID for each account, and after each sign-in you can add another account (up to 10).

3) **Declare the models you want**

Add Antigravity models under the `provider.google.models` section of your config:
```json
{
  "plugin": ["opencode-antigravity-auth"],
  "provider": {
    "google": {
      "models": {
        "gemini-3-pro-high": {
          "name": "Gemini 3 Pro High (Antigravity)",
          "limit": {
            "context": 1048576,
            "output": 65535
          }
        },
        "gemini-3-pro-low": {
          "name": "Gemini 3 Pro Low (Antigravity)",
          "limit": {
            "context": 1048576,
            "output": 65535
          }
        },
        "claude-sonnet-4-5": {
          "name": "Claude Sonnet 4.5 (Antigravity)",
          "limit": {
            "context": 200000,
            "output": 64000
          }
        },
        "claude-sonnet-4-5-thinking": {
          "name": "Claude Sonnet 4.5 Thinking (Antigravity)",
          "limit": {
            "context": 200000,
            "output": 64000
          }
        },
        "claude-opus-4-5-thinking": {
          "name": "Claude Opus 4.5 Thinking (Antigravity)",
          "limit": {
            "context": 200000,
            "output": 64000
          }
        },
        "gpt-oss-120b-medium": {
          "name": "GPT-OSS 120B Medium (Antigravity)",
          "limit": {
            "context": 131072,
            "output": 32768
          }
        }
      }
    }
  }
}
```

4) **Use a model**

```bash
opencode run "Hello world" --model=google/gemini-3-pro-high
```

## Multi-account load balancing

- Account pool is stored in `~/.config/opencode/antigravity-accounts.json` (or `%APPDATA%/opencode/antigravity-accounts.json` on Windows).
- This file contains OAuth refresh tokens; treat it like a password and don’t share/commit it.
- TUI `/connect` only supports single-account sign-in (no per-account project ID prompts). Use `opencode auth login` to add multiple accounts or set per-account project IDs.
- Each request picks the next account round-robin; on HTTP `429` the account is cooled down and the request retries with the next account.
- If Google revokes a refresh token (`invalid_grant`), that account is removed from the pool; rerun `opencode auth login` to add it back.

## Debugging

Enable verbose logging:

```bash
export OPENCODE_ANTIGRAVITY_DEBUG=1
```

Logs are written to the current directory (e.g., `antigravity-debug-<timestamp>.log`).

## Development

```bash
npm install
```

## Safety, usage, and risk notices

### Intended use

- Personal / internal development only
- Respect internal quotas and data handling policies
- Not for production services or bypassing intended limits

### Not suitable for

- Production application traffic
- High-volume automated extraction
- Any use that violates Acceptable Use Policies

### ⚠️ Warning (assumption of risk)

By using this plugin, you acknowledge and accept the following:

- **Terms of Service risk:** This approach may violate the Terms of Service of AI model providers (Anthropic, OpenAI, etc.). You are solely responsible for ensuring compliance with all applicable terms and policies.
- **Account risk:** Providers may detect this usage pattern and take punitive action, including suspension, permanent ban, or loss of access to paid subscriptions.
- **No guarantees:** Providers may change APIs, authentication, or policies at any time, which can break this method without notice.
- **Assumption of risk:** You assume all legal, financial, and technical risks. The authors and contributors of this project bear no responsibility for any consequences arising from your use.

Use at your own risk. Proceed only if you understand and accept these risks.

## Legal

- Not affiliated with Google. This is an independent open-source project and is not endorsed by, sponsored by, or affiliated with Google LLC.
- "Antigravity", "Gemini", "Google Cloud", and "Google" are trademarks of Google LLC.
- Software is provided "as is", without warranty. You are responsible for complying with Google's Terms of Service and Acceptable Use Policy.

## Credits

Built with help and inspiration from:

- [opencode-gemini-auth](https://github.com/jenslys/opencode-gemini-auth) — Gemini OAuth groundwork by [@jenslys](https://github.com/jenslys)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — Helpful reference for Antigravity API

## Support

If this plugin helps you, consider supporting its continued maintenance:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/S6S81QBOIR)


