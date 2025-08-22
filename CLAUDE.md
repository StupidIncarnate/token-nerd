# CLAUDE.md

Project context for Claude when working on Token Nerd.

## CRITICAL REMINDER TO MYSELF

**I MUST update ALL documentation when I make ANY change.** My tendency to update one file and forget the others is actively harmful.

When I make ANY change, I MUST:
1. Update README.md, docs/IMPLEMENTATION.md, docs/ARCHITECTURE.md, and CLAUDE.md
2. Update all affected code files
3. Remove obsolete files
4. Verify command syntax is consistent everywhere
5. Check that all examples work

My past mistakes to NOT repeat:
- Changed to complex architectures without thinking it through
- Removed --view and --sort flags from code but left them in docs
- Left old .js files next to new .ts files
- Thought "updating README is enough" when 4 other docs needed changes
- **DELETED STATUSLINE INTEGRATION FILES - NEVER DO THIS AGAIN**

**My rule: If I change it in one place, I MUST update it everywhere or I'm sabotaging the project.**

## Project Goal

**DUAL-COMPONENT SYSTEM**: Replace Claude's inaccurate statusline estimates with real token counts AND provide detailed drill-down analysis.

## Core Problem

Claude Code's statusline shows inaccurate estimates. Users need to see:
1. **REAL-TIME**: Accurate token counts in statusline (not estimates)
2. **ANALYSIS**: What operations they performed and token costs
3. **DRILL-DOWN**: The actual content that caused token costs

## CRITICAL: Two Integral Components

**COMPONENT 1: STATUSLINE INTEGRATION** (`src/statusline/get-real-tokens.ts`)
- **NEVER DELETE THIS FILE** - It's core functionality, not a helper
- Replaces Claude's inaccurate statusline with real counts from JSONL
- Shows clean format: `🐿️ 117,360 (75%)` with proper spacing
- Users see accurate progress in real-time while working

**COMPONENT 2: ANALYSIS CLI** (`token-nerd`)
- Interactive drill-down to see what operations caused token usage
- Press 't' for token sorting, Enter for details
- Historical analysis across sessions

## Technical Approach

### Data Sources
- **JSONL transcripts** in `~/.claude/projects/` contain token usage
- **Pre/post hooks** capture operation details as they happen
- **Redis** stores operation data (MCP server ensures it's always running)

### Key Components

**Clean Installer Architecture** (`src/installers/`)
- **NEVER GO BACK TO MESSY SCRIPTS** - Use the class-based system
- `TokenNerdInstaller` - Main orchestrator with atomic install/uninstall
- `McpInstaller` - Configures MCP server in `~/.claude.json`
- `HooksInstaller` - Creates symlinks in `~/.config/claude/hooks/`
- `StatuslineInstaller` - Integrates with Claude's statusline
- `BackupManager` - Handles backup/restore of system files
- All installers extend `BaseInstaller` with common functionality

**Statusline Integration** (`~/.claude/statusline-command.sh`)
- **INSTALLED AUTOMATICALLY** - postinstall sets this up via installers
- Calls `npx token-nerd --statusline` to show accurate counts
- Backs up existing statusline, enhances or creates new one
- **NEVER DELETE** - This is how users see real-time progress

**Hooks** (`~/.config/claude/hooks/`)
- `pre-tool-use` - TypeScript executable that captures tool name, parameters
- `post-tool-use` - TypeScript executable that captures tool response/output

**CLI Tools** (global after `npm install -g token-nerd`)
- `token-nerd` - Interactive TUI (coming soon - currently just statusline works)
- `token-nerd --statusline` - Returns formatted token count for statusline

**Storage** (Redis via MCP server)
```
session:<id>:operations:<timestamp> = {
  tool: string,
  params: object,
  response: object,
  estimatedTokens: number
}
```
MCP server ensures Redis is always running when hooks fire.

## Implementation Steps

See [IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for detailed build plan with acceptance criteria.

## Key Discoveries

- Actual token limit is ~156k, not 200k as displayed
- `cache_creation_input_tokens` shows new cache added per message
- `cache_read_input_tokens` shows cache reused from previous messages
- Token growth is linear (accumulation), not exponential

## Development Commands

```bash
# Install globally (sets up EVERYTHING automatically)
npm install -g token-nerd
# Restart claude

# Check statusline working
echo '{"transcript_path":"~/.claude/projects/session.jsonl"}' | npx token-nerd --statusline

# Debug statusline
DEBUG=1 npx tsx src/statusline/get-real-tokens.ts ~/.claude/projects/session-id.jsonl

# Test local changes
npm test
npm pack
npm install -g ./token-nerd-0.1.0.tgz

# Run specific test suites
npm test -- src/installers/utils.test.ts
npm test -- src/installers/

# Lint and type checking
npm run lint
npm run typecheck
```

## Clean Architecture - DO NOT MESS WITH

```
src/
├── statusline/
│   ├── get-real-tokens.ts      # STATUSLINE INTEGRATION - CORE COMPONENT
│   └── config.ts               # Token formatting logic
├── cli/index.ts                # Main CLI entry point with --statusline flag
├── installers/                 # CLEAN CLASS-BASED ARCHITECTURE
│   ├── types.ts                # Interfaces and types
│   ├── utils.ts                # Centralized path utilities
│   ├── backup-manager.ts       # Handles system file backups
│   ├── base-installer.ts       # Abstract base class
│   ├── mcp-installer.ts        # MCP server configuration
│   ├── hooks-installer.ts      # Hook symlink management  
│   ├── statusline-installer.ts # Statusline integration
│   ├── token-nerd-installer.ts # Main orchestrator
│   └── *.test.ts              # Comprehensive test coverage (155 tests)
├── hooks/                      # Pre/post tool hooks (TypeScript)
├── lib/                        # Session tracking, TUI components
└── mcp-server/                 # Redis lifecycle management

# INSTALLED FILES
~/.claude/statusline-command.sh     # CREATED BY INSTALLERS
~/.config/claude/hooks/pre-tool-use # SYMLINK TO src/hooks/
~/.config/claude/hooks/post-tool-use# SYMLINK TO src/hooks/
~/.claude.json                      # ENHANCED WITH MCP SERVER
```

## Testing Approach

**Comprehensive Test Suite: 155 tests across 6 suites**
- `utils.test.ts` - 29 tests covering all path utilities
- `backup-manager.test.ts` - 34 tests for backup/restore
- `mcp-installer.test.ts` - 24 tests for MCP configuration 
- `hooks-installer.test.ts` - 24 tests for symlink management
- `statusline-installer.test.ts` - 25 tests for statusline integration
- `token-nerd-installer.test.ts` - 19 tests for atomic install/uninstall

Always test with real session data:
- Session `82e15896`: Died at 136k tokens (showed ~40k)
- Session `f2e31064`: ~117k tokens (showed ~63k)

**Test Commands:**
```bash
npm test                    # All tests
npm test -- --watch       # Watch mode
npm test -- --coverage    # Coverage report
```

Verify Redis is running: `redis-cli ping` should return PONG.

## Current Status

✅ **COMPLETED:**
- Clean class-based installer architecture
- Comprehensive test coverage (155/155 tests passing)
- Statusline integration working (`🐿️ 117,360 (75%)`)
- MCP server with proper JSON-RPC protocol
- Atomic install/uninstall with rollback
- System file backup management
- Cross-platform path utilities (Windows/Unix)
- Proper hook directory structure (`~/.config/claude/hooks/`)

🚧 **TODO:**
- Interactive TUI for analysis CLI
- Session selection and historical analysis
- Operation detail drill-down

**NEVER GO BACKWARDS:** The clean architecture is working perfectly. Don't revert to messy scripts.