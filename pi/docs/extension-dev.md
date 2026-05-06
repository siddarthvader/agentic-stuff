# Pi Extension Development Guide

This guide covers creating extensions for the pi coding agent.

## Quick Start

Create a new extension:

```typescript
// extensions/my-extension.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // React to events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  // Register tools
  pi.registerTool({
    name: "my_tool",
    description: "What this tool does",
    parameters: Type.Object({...}),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return { content: [{ type: "text", text: "Result" }] };
    }
  });

  // Register commands  
  pi.registerCommand("my-cmd", {
    description: "Custom command",
    handler: async (args, ctx) => {
      ctx.ui.notify("Command executed!", "success");
    }
  });
}
```

## Extension Categories

### 1. System Prompt Extensions
Inject context, rules, or project-specific knowledge:
- **claude-skills.ts** - Load skills from `.claude/skills/`
- **project-rules.ts** - Load coding standards
- **context-injector.ts** - Add project context

### 2. Tool Extensions  
Add new capabilities:
- **database-tools.ts** - SQL query tools
- **api-tools.ts** - REST/GraphQL testing
- **docker-tools.ts** - Container management

### 3. Workflow Extensions
Automate development workflows:
- **git-workflow.ts** - Auto-commit, branching
- **test-runner.ts** - Run tests on file changes
- **deploy-tools.ts** - Deployment automation

### 4. UI Extensions
Enhance the user interface:
- **status-monitors.ts** - Custom status displays
- **progress-trackers.ts** - Task progress visualization
- **custom-editors.ts** - Specialized input modes

### 5. Integration Extensions
Connect to external services:
- **jira-integration.ts** - Issue tracking
- **slack-notifications.ts** - Team alerts
- **monitoring-tools.ts** - System health checks

## Best Practices

### Error Handling
```typescript
pi.on("tool_call", async (event, ctx) => {
  try {
    // Extension logic
    if (shouldBlock(event)) {
      return { block: true, reason: "Blocked by policy" };
    }
  } catch (error) {
    console.warn("Extension error:", error);
    // Never throw - just log and continue
  }
});
```

### UI Safety
```typescript
pi.on("session_start", async (_event, ctx) => {
  if (ctx.hasUI) {
    ctx.ui.notify("Extension loaded", "info");
  }
  // Always check ctx.hasUI in print/JSON modes
});
```

### Cleanup
```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  // Clear status displays
  if (ctx.hasUI) {
    ctx.ui.setStatus("my-extension", undefined);
    ctx.ui.setWidget("my-widget", undefined);
  }
  
  // Close connections, clear timers, etc.
  cleanup();
});
```

### State Management
```typescript
// Store state in tool results for proper branching
pi.registerTool({
  name: "stateful_tool",
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    updateInternalState(params);
    
    return {
      content: [{ type: "text", text: "Updated" }],
      details: { state: getCurrentState() } // For reconstruction
    };
  }
});

// Reconstruct state from session history
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && 
        entry.message.role === "toolResult" &&
        entry.message.toolName === "stateful_tool") {
      reconstructState(entry.message.details?.state);
    }
  }
});
```

## Repo Workflow

This repository is a pi package. `package.json` declares:

```json
{
  "pi": {
    "extensions": ["./pi/extensions"]
  }
}
```

After installing the repo once, every `.ts` or `.js` file in `pi/extensions/` is auto-discovered by pi.

### One-Time Install

Global install for your user:

```bash
pi install /home/d2du/code/ug/agentic-stuff
```

Project-local install, written to `.pi/settings.json`:

```bash
pi install -l /home/d2du/code/ug/agentic-stuff
```

Do not symlink `~/.pi/agent/extensions` to this repo. Prefer the package/settings workflow above.

### Adding a New Extension

1. Create the extension:

```bash
$EDITOR pi/extensions/my-extension.ts
```

2. Export the standard factory:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("my-cmd", {
    description: "Run my command",
    handler: async (_args, ctx) => {
      ctx.ui.notify("my extension works", "info");
    },
  });
}
```

3. Test load/syntax:

```bash
pi -e ./pi/extensions/my-extension.ts --version
```

4. Reload a running pi session:

```text
/reload
```

No settings edits are needed for each new extension.

## Testing Extensions

### Syntax Check
```bash
pi -e ./pi/extensions/my-extension.ts --version
```

### Isolated Testing
```bash
pi -e ./pi/extensions/my-extension.ts -p "test prompt"
```

### Integration Testing
```bash
# Test with real project
cd /path/to/project
pi -e /home/d2du/code/ug/agentic-stuff/pi/extensions/my-extension.ts
```

## Distribution

### Local Package
```bash
pi install /path/to/agentic-stuff
```

This writes a local path into `~/.pi/agent/settings.json` under `packages` and uses the repo's `package.json` `pi` manifest.

### Git Package
```json
// settings.json
{
  "packages": [
    "git:github.com/user/agentic-stuff"
  ]
}
```

### NPM Package
```json
// package.json
{
  "name": "@user/pi-extensions",
  "pi": {
    "extensions": ["./dist/my-extension.js"]
  }
}
```

## Resources

- [Pi Extensions Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [TUI Components](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/tui.md)
- [Example Extensions](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)