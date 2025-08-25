# Token Nerd

Token Nerd lets you see on a message by message basis how Claude's context window is filling up so you can troubleshoot why during certain sessions, Claude was only able to touch one file before needing to compact. 

## How It Works

1. **Automatic Installation** - `npm install -g token-nerd` sets up everything via postinstall script
2. **MCP Server** - Starts with Claude Code, manages Redis lifecycle
3. **Hooks** - Capture every tool operation in `~/.claude/settings.json`
4. **Statusline** - Shows real token counts from JSONL transcript parsing
5. **Interactive TUI** - Lets you correlate context window spikes and scaling window fills

This will install an MCP hook that watches all tool calls and stores their payloads in redis for later viewing via `token-nerd`. Once you've installed the package and closed any Claude sessions, it will start recording data as soon as you open a Claude session. When you run into a troubling Claude session, you can launch the tool and start troubleshooting your session. 

If you have a statusline already, it will tack on an indicator. Otherwise, it will also add a statusline bit to your Claude session so you can spot things in real time. As well as know when you're actually getting close to compacting. 

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
token-nerd  # Interactive analysis
```

## What You'll See when you run token-nerd

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


## How To Troubleshoot Context Window Gorging
That is indeed the question. Once there's good numbers to display, I'll fill this in. 

## Architecture

- **TypeScript** - CLI tools
- **Redis** - Operation storage
- **Hooks** - Pre/post tool tracking
- **JSONL** - Token source of truth

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.