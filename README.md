# Token Nerd - The 🐿️ who counts every nut

[![npm version](https://badge.fury.io/js/token-nerd.svg)](https://www.npmjs.com/package/token-nerd)
[![Node.js](https://img.shields.io/node/v/token-nerd.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Debug Claude Code context window issues with precision**

Token Nerd lets you see on a message-by-message basis how Claude's context window fills up, so you can troubleshoot why Claude could only touch one or two files before needing to compact in any given session.

## How It Works

Install the tool and set up your statusline to get:
- **Real token counter** in your statusline (`🐿️ 105,862 (68%)` so you know when auto-compact is coming)
- **Interactive analysis** - drill down into any session to find outputs that are total token hogs 

Once configured, everything runs automatically in the background. When Claude feels slow or hits limits unexpectedly, run `token-nerd` to see exactly what happened.


## Quick Start

```bash
# 1. Install globally
npm install -g token-nerd

# 2. Set up statusline manually (see Statusline Setup below)

# 3. Use Claude Code normally
# ✅ Statusline shows real token counts: 🐿️ 156,107 (100%)

# 4. Analyze anytime:
token-nerd  # Interactive analysis
```

## What you'll see when you run token-nerd and drill into sessions

Interactive terminal UI with live sorting and hierarchical view:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Session: ce03c353 | Total: 83,788 tokens | Sort: TOKENS ↓                                         │
│ Page 1/3 | Items 1-20 of 45                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘

   Time     [ Context ] | Token Impact              | Operation & Details
────────────────────────────────────────────────────────────────────────────────────────────────────
→ 9:17:11 PM [ ---,---] | ~35 est                   | 👤 User: take a look at the changed files...
  9:17:15 PM [ 016,009] | +37 actual (3 out)        | 🤖 Assistant: message
  9:17:18 PM [ ---,---] | [0.2KB → ~44 est]         | 📥 ToolResponse: 0.2KB → ~40 tokens
  9:17:21 PM [ 016,496] | +487 actual (1 out)       | 🤖 Assistant: message
  9:17:27 PM [ 033,977] | +17,481 actual (3 out)    | 🤖 Assistant: message
  9:17:40 PM [ 048,394] | +13,858 actual (29 out)   | 🤖 Assistant: TodoWrite: TodoWrite
  9:17:40 PM [ ---,---] |   [0.2KB → ~44 est]       |   📥 ToolResponse: TodoWrite
  9:18:02 PM [ 049,669] | +843 actual (41 out)      | 🤖 Assistant: Edit: correlation-engine.test.ts
  9:18:15 PM [ ---,---] |   [30.7KB → ~8,499 est]   |   📥 ToolResponse: correlation-engine.test.ts

Navigation: [↑↓] select | [Enter] details | [Tab] expand | [t]okens [c]hronological [o]peration | [q]uit
```


## Commands

### Interactive Analysis (Default)
```bash
token-nerd              # Browse sessions in tree view
token-nerd --session <session-id>  # Analyze specific session
```

### Session Management
```bash
token-nerd sessions     # List all sessions (flat view)
token-nerd stats        # Show current Claude session stats (requires claude CLI)
```

## Statusline Setup

Add real-time token counting to your Claude Code statusline:

### Option 1: New Statusline (if you don't have one)

Create `~/.claude/statusline-command.sh`:

```bash
#!/bin/bash
# Basic Claude Code statusline with token-nerd integration
TOKEN_NERD_OUTPUT=$(cat | npx token-nerd --statusline)
echo "${TOKEN_NERD_OUTPUT}"
```

Then add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/home/yourusername/.claude/statusline-command.sh"
  }
}
```

### Option 2: Enhance Existing Statusline

If you already have a statusline, add this line before your final `echo`:

```bash
TOKEN_NERD_OUTPUT=$(echo "$json" | npx token-nerd --statusline)
```

And modify your echo to include: `| $TOKEN_NERD_OUTPUT`

**Result**: Shows token counts as `🐿️ 150,107 (97%)`

### Statusline Testing
```bash
# Test the statusline command:
echo '{"transcript_path":"~/.claude/projects/session.jsonl"}' | npx token-nerd --statusline
```

### Cleanup/Uninstall
```bash
token-nerd cleanup      # Remove all configurations and restore backups
# OR
token-nerd --cleanup    # Same as above

# Then uninstall normally:
npm uninstall -g token-nerd
```

## Features

### 🔍 **Real-Time Monitoring**
- Accurate token counts in Claude's statusline (not estimates)
- Shows when you're approaching auto-compact context limits

### 📊 **Detailed Analysis**
- Message-by-message token breakdown
- Context window growth tracking
- Hierarchical view of bundled operations

### 🛠 **Debugging Tools**
- Identify expensive operations
- Cache hit/miss analysis  
- Time gap warnings (cache expiration)
- Drill-down into operation details

## FAQ

### Why is there a sudden token jump from 0 to 16,000+ tokens when Assistant responds?

This is **normal**! The jump shows the initial context size that Claude starts with in your session:

```
9:35:51 PM [ 000,000] | ~50 est                     | 👤 User: Caveat: The messages below...
9:36:15 PM [ 016,681] | +16,681 actual (2 out)      | 🤖 Assistant: message
```

The 16,681 tokens represent:
- Your initial message(s)  
- Project files loaded into context (via `/context` command)
- System prompts and configuration
- Claude Code's built-in context

**To see what's loaded**: Run `/context` during your Claude session to see exactly what files and content are taking up space.

The token counter shows `000,000` initially because it only tracks *processed* messages. When Claude responds, it processes everything at once, showing the true starting context size.

## Troubleshooting Context Issues

Common patterns to look for:

1. **Large File Reads**: Look for Read operations with high token costs
2. **Tool Response Size**: ToolResponse entries show `[12.5KB → ~3,378 est]` format  
3. **Cache Misses**: Operations marked with ⚠️ indicate cache expiration (>5min gaps)
4. **Context Spikes**: Look for `+X actual` values that are unexpectedly high 

## Requirements

> **_Only tested on Linux, but attempted to cover Windows and Mac. Open an issue if you're getting errors on those systems._**

- **Node.js**: >=18.0.0
- **Claude Code**: Latest version

## Contributing

Issues and PRs welcome! This tool helps debug Claude Code sessions more effectively.

## License

MIT © StupidIncarnate

---

**Note**: This tool is designed specifically for Claude Code. After installing with `npm install -g token-nerd`, follow the Statusline Setup section above to see context window changes in your statusline.