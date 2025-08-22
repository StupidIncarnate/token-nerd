# Token Nerd

**DUAL-COMPONENT SYSTEM**: Replace Claude's inaccurate statusline estimates with real token counts AND provide detailed drill-down analysis.

## The Problem

Claude Code's statusline shows inaccurate estimates (40-75k when actual is 130-180k). You need to know:
- What operations caused token spikes
- Which files are expensive to read
- How to optimize your workflow

## Quick Start

```bash
# 1. Install globally (automatic setup)
npm install -g token-nerd

# 2. Restart Claude Code
# Everything is configured automatically

# 3. Use Claude Code normally
# ✅ Statusline shows real token counts: 🐿️ 156,107 (100%)
# ✅ All operations captured for analysis

# 4. Analyze anytime:
token-nerd  # Interactive analysis (coming soon)
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

## Current Status

**✅ COMPONENT 1: STATUSLINE INTEGRATION** 
- Real-time accurate token counts in Claude's statusline
- Shows format: `🐿️ 156,107 (100%)` with proper percentage warnings
- Works immediately after installation

**🚧 COMPONENT 2: ANALYSIS CLI**
- ✅ Operation capture (hooks writing to Redis)
- ✅ Session tracking and selection
- ❌ Interactive TUI (coming soon)
- ❌ Token correlation engine (coming soon)

## How It Works

1. **Automatic Installation** - `npm install -g` sets up everything via postinstall script
2. **MCP Server** - Starts with Claude Code, manages Redis lifecycle  
3. **Hooks** - Capture every tool operation in `~/.claude/settings.json`
4. **Statusline** - Shows real token counts from JSONL transcript parsing
5. **Future: Interactive TUI** - Will correlate operations with token costs

## Implementation

See [IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for build steps and acceptance criteria.

## Architecture

- **TypeScript** - CLI tools
- **Redis** - Operation storage
- **Hooks** - Pre/post tool tracking
- **JSONL** - Token source of truth

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.