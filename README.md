# Token Nerd

[![npm version](https://badge.fury.io/js/token-nerd.svg)](https://www.npmjs.com/package/token-nerd)
[![Node.js](https://img.shields.io/node/v/token-nerd.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Debug Claude Code context window issues with precision**

Token Nerd lets you see on a message-by-message basis how Claude's context window is filling up, so you can troubleshoot why during certain sessions Claude was only able to touch one file before needing to compact. 

## How It Works

1. **Automatic Installation** - `npm install -g token-nerd` sets up everything via postinstall script
2. **MCP Server** - Starts with Claude Code, manages Redis lifecycle
3. **Hooks** - Capture every tool operation in `~/.claude/settings.json`
4. **Statusline** - Shows real token counts from JSONL transcript parsing
5. **Interactive TUI** - Lets you correlate context window spikes and scaling window fills

The installation sets up:
- **MCP server** that automatically manages Redis for data storage
- **Tool hooks** that capture every Claude operation with precise timing
- **Statusline integration** showing real token counts (not estimates)
- **Interactive analysis tools** for session troubleshooting

After installation, restart Claude Code and it begins capturing data immediately. Run `token-nerd` anytime to analyze your sessions. 

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
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Session: ce03c353 | Total: 83,788 tokens | Sort: TOKENS ↓                                         │
│ Page 1/3 | Items 1-20 of 45                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘

   Time     [ Context ] | Token Impact              | Operation & Details
────────────────────────────────────────────────────────────────────────────────────────────────────
   10:32:15 [015,234] | +4,343 actual (120 out) | 🤖 Assistant: Read: large-file.ts
   10:32:16 [---,---] | [12.5KB → ~3,378 est]   |   📥 ToolResponse: large-file.ts
   10:32:45 [019,577] | +2,890 actual (85 out)  | 🤖 Assistant: 2 tool calls
   10:33:02 [---,---] | ~45 est                  |   👤 User: Can you fix the bug?
   10:33:15 [020,123] | 546 tokens               | 🤖 Assistant: message

Navigation: [↑↓] select | [Enter] details | [Tab] expand | [t]okens [c]hronological [o]peration | [q]uit
```


## Commands

### Interactive Analysis (Default)
```bash
token-nerd              # Browse sessions in tree view
token-nerd browse       # Same as above
token-nerd --session <session-id>  # Analyze specific session
```

### Session Management
```bash
token-nerd sessions     # List all sessions (flat view)
token-nerd stats        # Show current Claude session stats (requires claude CLI)
```

### Statusline Integration
```bash
# Automatically configured during installation
# Shows real token counts in Claude Code statusline as: 🐿️ 156,107 (100%)
# No manual setup required - works immediately after npm install + Claude restart
```

## Features

### 🔍 **Real-Time Monitoring**
- Accurate token counts in Claude's statusline (not estimates)
- Shows when you're approaching auto-compact context limits
- Real-time cache efficiency metrics

### 📊 **Detailed Analysis**
- Message-by-message token breakdown
- Context window growth tracking
- Hierarchical view of bundled operations

### 🛠 **Debugging Tools**
- Identify expensive operations
- Cache hit/miss analysis  
- Time gap warnings (cache expiration)
- Drill-down into operation details
- Linked operation analysis (tool requests → responses)

## Troubleshooting Context Issues

Common patterns to look for:

1. **Large File Reads**: Look for Read operations with high token costs
2. **Tool Response Size**: ToolResponse entries show `[12.5KB → ~3,378 est]` format
3. **Cache Misses**: Operations marked with ⚠️ indicate cache expiration (>5min gaps)
4. **Context Spikes**: Look for `+X actual` values that are unexpectedly high
5. **Linked Operations**: Press Enter on ToolResponse to see full tool execution chain 

## Requirements

- **Node.js**: >=18.0.0
- **Claude Code**: Latest version
- **Redis**: Automatically managed by MCP server

## Architecture

Token Nerd uses a dual-component architecture:

1. **Data Collection**: 
   - MCP server manages Redis lifecycle
   - Pre/post tool hooks capture operation details
   - JSONL transcripts provide token source of truth

2. **Analysis Interface**:
   - Interactive TUI for session exploration  
   - Real-time statusline integration
   - Correlation engine matches operations to token costs

## Contributing

Issues and PRs welcome! This tool helps debug Claude Code sessions more effectively.

## License

MIT © StupidIncarnate

---

**Note**: This tool is designed specifically for Claude Code and requires proper installation to function. The automatic setup handles all configuration during `npm install`.