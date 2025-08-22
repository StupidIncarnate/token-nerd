# Token Nerd Architecture

## CRITICAL ARCHITECTURE DECISION: MCP SERVER

**We use an MCP server as a Redis lifecycle manager.**

What the MCP server does:
- **Starts with Claude Code** - Launched automatically via ~/.claude.json
- **Ensures Redis is running** - Starts Redis if not already running
- **Keeps Redis alive** - Redis stays up as long as Claude Code is running
- **Shuts down cleanly** - Stops Redis when Claude Code exits

This guarantees hooks always have Redis available to write to.

## Tech Stack

### Core Technologies
- **MCP Server**: Long-running process for data collection
- **Language**: TypeScript
- **Runtime**: Node.js
- **Storage**: Redis (guaranteed to be running via MCP server)
- **CLI Framework**: Commander + Inquirer
- **TUI Framework**: Ink (React for terminals)

### Storage Layer
- **Redis**: Stores operation data from hooks (guaranteed running via MCP)
  - Direct connection from hooks
  - No offline queue needed (Redis always available)
  - MCP server ensures Redis is running before hooks fire

### Hook Layer
- **Pre-tool-use hooks**: TypeScript executables using tsx
  - Tool name, parameters, timestamps
  - File paths and sizes
- **Post-tool-use hooks**: TypeScript executables using tsx
  - Tool responses (file contents, command output)
  - Success/failure status
  - Actual data that creates cache

### CLI Tools Layer
- **TypeScript**: All CLI tools written in TypeScript
- **Commander**: CLI argument parsing
- **Inquirer**: Interactive prompts for session selection
- **Ink**: Interactive terminal UI with React components
  - Live sortable tables
  - Keyboard navigation
  - Real-time updates without re-running commands

### Data Flow
1. Claude Code starts → MCP server starts → Redis starts
2. Claude Code performs operation
3. Pre-hook captures request → writes to Redis
4. Post-hook captures response → writes to Redis
5. User runs npx token-nerd → reads from Redis
6. CLI correlates with JSONL token data
7. Displays results in interactive TUI

## Key Components

### Redis Schema
```
# Operation logs
operations:<timestamp> = {
  tool: string,
  params: object,
  response: object,
  estimatedTokens: number
}

# Session tracking
session:<id>:operations = [timestamp, timestamp, ...]
session:<id>:token_spikes = [{ time, delta, total }, ...]

# Correlation data
correlation:<timestamp> = {
  operation: timestamp,
  tokenSpike: number,
  confidence: percentage
}
```

### CLI Commands
- `npx token-nerd`: Interactive TUI with hierarchical view
  - Press 't' to sort by tokens
  - Press 'c' for chronological sort
  - Press Tab to expand/collapse bundles
  - Press Enter to view operation details
- `npx token-nerd install-hooks`: One-time hook setup

## Design Decisions

### Why this architecture?
- **Simple** - MCP just manages Redis lifecycle
- **Reliable** - Redis is always running when hooks fire
- **No data loss** - Direct Redis writes, no queuing needed
- **Clean** - Everything shuts down when Claude Code exits

### Why TypeScript?
- Type safety for complex data structures
- Better IDE support
- Consistent with hook scripts
- Easier refactoring