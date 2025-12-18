# Antigravity OAuth Plugin for Opencode

[![npm version](https://img.shields.io/npm/v/opencode-antigravity-auth.svg)](https://www.npmjs.com/package/opencode-antigravity-auth)

Enable Opencode to authenticate against **Antigravity** (Google's IDE) via OAuth so you can use Antigravity rate limits and access models like `gemini-3-pro-high` and `claude-opus-4-5-thinking` with your Google credentials.

## What you get

- **Google OAuth sign-in** (multi-account via `opencode auth login`) with automatic token refresh
- **Multi-account load balancing** Automatically cycle through multiple Google accounts to maximize rate limits
- **Real-time SSE streaming** including thinking blocks and incremental output
- **Advanced Claude support** Interleaved thinking, stable multi-turn signatures, and validated tool calling
- **Automatic endpoint fallback** between Antigravity API endpoints (daily → autopush → prod)
- **Antigravity API compatibility** for OpenAI-style requests
- **Debug logging** for requests and responses
- **Drop-in setup** Opencode auto-installs the plugin from config

## Quick start

### Step 1: Create your config file

If this is your first time using Opencode, create the config directory first:

```bash
mkdir -p ~/.config/opencode
```

Then create or edit the config file at `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-antigravity-auth@1.2.0"]
}
```

> **Note:** You can also use a project-local `.opencode.json` file in your project root instead. The global config at `~/.config/opencode/opencode.json` applies to all projects.

### Step 2: Authenticate

Run the authentication command:

```bash
opencode auth login
```

1. Select **Google** as the provider
2. Select **OAuth with Google (Antigravity)**
3. **Project ID prompt:** You'll see this prompt:
   ```
   Project ID (leave blank to use your default project):
   ```
   **Just press Enter to skip this** — it's optional and only needed if you want to use a specific Google Cloud project. Most users can leave it blank.
4. Sign in via the browser and return to Opencode. If the browser doesn't open, copy the displayed URL manually.
5. After signing in, you can add more Google accounts (up to 10) for load balancing, or press Enter to finish.

> **Alternative:** For a quick single-account setup without project ID options, open `opencode` and use the `/connect` command instead.

### Step 3: Add the models you want to use

Open the **same config file** you created in Step 1 (`~/.config/opencode/opencode.json`) and add the models under `provider.google.models`:

```json
{
  "plugin": ["opencode-antigravity-auth@1.2.0"],
  "provider": {
    "google": {
      "models": {
        "gemini-3-pro-high": {
          "name": "Gemini 3 Pro High (Antigravity)",
          "limit": {
            "context": 1048576,
            "output": 65535
          },
          "modalities": {
            "input": ["text", "image", "pdf"],
            "output": ["text"]
          }
        },
        "gemini-3-pro-low": {
          "name": "Gemini 3 Pro Low (Antigravity)",
          "limit": {
            "context": 1048576,
            "output": 65535
          },
          "modalities": {
            "input": ["text", "image", "pdf"],
            "output": ["text"]
          }
        },
        "gemini-3-flash": {
          "name": "Gemini 3 Flash (Antigravity)",
          "limit": {
            "context": 1048576,
            "output": 65536
          },
          "modalities": {
            "input": ["text", "image", "pdf"],
            "output": ["text"]
          }
        },
        "claude-sonnet-4-5": {
          "name": "Claude Sonnet 4.5 (Antigravity)",
          "limit": {
            "context": 200000,
            "output": 64000
          },
          "modalities": {
            "input": ["text", "image", "pdf"],
            "output": ["text"]
          }
        },
        "claude-sonnet-4-5-thinking": {
          "name": "Claude Sonnet 4.5 Thinking (Antigravity)",
          "limit": {
            "context": 200000,
            "output": 64000
          },
          "modalities": {
            "input": ["text", "image", "pdf"],
            "output": ["text"]
          }
        },
        "claude-opus-4-5-thinking": {
          "name": "Claude Opus 4.5 Thinking (Antigravity)",
          "limit": {
            "context": 200000,
            "output": 64000
          },
          "modalities": {
            "input": ["text", "image", "pdf"],
            "output": ["text"]
          }
        },
        "gpt-oss-120b-medium": {
          "name": "GPT-OSS 120B Medium (Antigravity)",
          "limit": {
            "context": 131072,
            "output": 32768
          },
          "modalities": {
            "input": ["text", "image", "pdf"],
            "output": ["text"]
          }
        }
      }
    }
  }
}
```

> **Tip:** You only need to add the models you plan to use. The example above includes all available models, but you can remove any you don't need. The `modalities` field enables image and PDF support in the TUI.

### Step 4: Use a model

```bash
opencode run "Hello world" --model=google/gemini-3-pro-high
```

Or start the interactive TUI and select a model from the model picker:

```bash
opencode
```

## Multi-account load balancing

The plugin supports multiple Google accounts to maximize rate limits and provide automatic failover.

### How it works

- **Round-robin selection:** Each request uses the next account in the pool
- **Automatic failover:** On HTTP `429` (rate limit), the plugin automatically switches to the next available account
- **Smart cooldown:** Rate-limited accounts are temporarily cooled down and automatically become available again after the cooldown expires
- **Single-account retry:** If you only have one account, the plugin waits for the rate limit to reset and retries automatically
- **Toast notifications:** The TUI shows which account is being used and when switching occurs

### Adding accounts

**CLI flow (`opencode auth login`):**

When you run `opencode auth login` and already have accounts saved, you'll be prompted:

```
2 account(s) saved:
  1. user1@gmail.com
  2. user2@gmail.com

(a)dd new account(s) or (f)resh start? [a/f]:
```

- Press `a` to add more accounts to your existing pool
- Press `f` to clear all existing accounts and start fresh

**TUI flow (`/connect`):**

The `/connect` command in the TUI adds accounts non-destructively — it will never clear your existing accounts. To start fresh via TUI, run `opencode auth logout` first, then `/connect`.

### Account storage

- Account pool is stored in `~/.config/opencode/antigravity-accounts.json` (or `%APPDATA%\opencode\antigravity-accounts.json` on Windows)
- This file contains OAuth refresh tokens; **treat it like a password** and don't share or commit it
- The plugin automatically syncs with OpenCode's auth state — if you log out via OpenCode, stale account storage is cleared automatically

### Automatic account recovery

- If Google revokes a refresh token (`invalid_grant`), that account is automatically removed from the pool
- Rerun `opencode auth login` to re-add the account

## Architecture & Flow

For contributors and advanced users, see the detailed documentation:

- **[Claude Model Flow](docs/CLAUDE_MODEL_FLOW.md)** - Full request/response flow, improvements, and fixes
- **[Antigravity API Spec](docs/ANTIGRAVITY_API_SPEC.md)** - API reference and schema support matrix

## Streaming & thinking

This plugin supports **real-time SSE streaming**, meaning you see thinking blocks and text output incrementally as they are generated.

### Claude Thinking & Tools

For models like `claude-opus-4-5-thinking`:

- **Interleaved Thinking:** The plugin automatically enables `anthropic-beta: interleaved-thinking-2025-05-14`. This allows Claude to think *between* tool calls and after tool results, improving complex reasoning.
- **Smart System Hints:** A system instruction is silently added to encourage the model to "think" before and during tool use.
- **Multi-turn Stability:** Thinking signatures are cached and restored using a stable `sessionId`, preventing "invalid signature" errors in long conversations.
- **Thinking Budget Safety:** If a thinking budget is enabled, the plugin ensures output token limits are high enough to avoid budget-related errors.
- **Tool Use:** Tool calls and responses are assigned proper IDs, and tool calling is set to validated mode for better Claude compatibility.

**Troubleshooting:** If you see signature errors in multi-turn tool loops, restart `opencode` to reset the plugin session/signature cache.

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


