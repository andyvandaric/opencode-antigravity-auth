# Installation Guide

This guide provides comprehensive installation instructions for **OpenCode AG Auth** for both human users and AI agents.

## 👥 For Humans

### Prerequisites

- **OpenCode** IDE installed.
- **Node.js** v20+ (recommended for optimal performance).

### Option 1: Automatic Installation (Recommended)

The easiest way to install is by adding the plugin to your `opencode.json` configuration file. OpenCode will automatically fetch the latest version from NPM.

1.  Open your configuration file: `~/.config/opencode/opencode.json`.
2.  Add `opencode-ag-auth` to the `plugin` array:

    ```json
    {
      "plugin": ["opencode-ag-auth@latest"]
    }
    ```

3.  Restart OpenCode. The plugin will be downloaded and installed automatically.

### Option 2: Manual / Development Installation

If you want to contribute to the plugin or use a local version:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/andyvandaric/opencode-ag-auth.git
    cd opencode-ag-auth
    ```

2.  **Install dependencies and build:**
    ```bash
    bun install
    bun run build
    ```

3.  **Link to OpenCode:**
    Add the absolute path of your local directory to `opencode.json`:

    ```json
    {
      "plugin": ["/absolute/path/to/opencode-ag-auth"]
    }
    ```

---

## 🤖 For AI Agents

If you are an AI agent tasked with installing this plugin, follow these precise instructions.

### System Prompt / Instructions

You can copy-paste this block into your agent's context or system prompt:

```markdown
# OpenCode AG Auth Installation Protocol

1. **Locate Configuration**:
   - Find the OpenCode configuration file at `~/.config/opencode/opencode.json`.
   - If the file does not exist, create it.

2. **Add Plugin**:
   - Read the existing `opencode.json`.
   - Ensure the "plugin" array exists.
   - Append "opencode-ag-auth@latest" to the "plugin" array.
   - Example state:
     {
       "plugin": ["opencode-ag-auth@latest"]
     }

3. **Configure Models**:
   - Add the "provider" configuration for "google".
   - Define models mapping to "opencode-ag-auth" capabilities.
   - Use the standard model configuration provided in the README.

4. **Verify Installation**:
   - Run the command: `opencode --version` to ensure the CLI is accessible.
   - Run a test prompt: `opencode run "Hello" --model=google/antigravity-gemini-3-flash`
   - If the response is successful, installation is complete.
```

### Automated Verification Script (Node.js)

Agents can use this script to verify the installation programmatically:

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const hasPlugin = config.plugin.some(p => p.includes('opencode-ag-auth'));
  
  if (hasPlugin) {
    console.log('✅ OpenCode AG Auth plugin is configured.');
  } else {
    console.error('❌ Plugin not found in configuration.');
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Error reading configuration:', e.message);
  process.exit(1);
}
```
