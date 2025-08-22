# Token Nerd

Track and analyze actual token usage in Claude Code sessions. See exactly which operations consume tokens and optimize your workflows.

## The Problem

Claude Code's statusline shows inaccurate estimates (40-75k when actual is 130-180k). You need to know:
- What operations caused token spikes
- Which files are expensive to read
- How to optimize your workflow

## Quick Start

```bash
# 1. Install MCP server and hooks (one-time setup)
npx token-nerd install-mcp    # Adds Redis manager to ~/.claude.json
npx token-nerd install-hooks  # Installs operation capture hooks

# 2. Restart Claude Code
# MCP server starts Redis automatically

# 3. Use Claude Code normally
# All operations are captured to Redis

# 4. Analyze anytime:
npx token-nerd  # View your token usage
```

## What You'll See

Interactive terminal UI with live sorting and hierarchical view:

```
Session: ce03c353 | Total: 83,788 tokens | Sort: TOKENS

▶ 45,670 tokens | Bash: npm test
▼ 12,890 tokens | Bundle (3 ops)
  └─ Read: src/large.ts (8,234 tokens - proportional)
  └─ Edit: src/api.ts (3,456 tokens - proportional)
  └─ Write: src/new.ts (1,200 tokens - proportional)
  1,234 tokens | Read: src/config.ts

Controls: [t]okens | [c]hronological | [Tab] expand | [Enter] view
```

## How It Works

1. **MCP Server** starts when Claude Code starts, ensures Redis is running
2. **Hooks** capture every tool operation and write to Redis
3. **JSONL** provides total tokens per message
4. **Correlation Engine** allocates tokens:
   - Single operation = exact count
   - Multiple operations = proportional by response size
5. **Interactive TUI** lets you explore without restarting

## Implementation

See [IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for build steps and acceptance criteria.

## Architecture

- **TypeScript** - CLI tools
- **Redis** - Operation storage
- **Hooks** - Pre/post tool tracking
- **JSONL** - Token source of truth

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.