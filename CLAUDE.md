# CLAUDE.md

Project context for Claude when working on Token Nerd.

## Project Goal

**DUAL-COMPONENT SYSTEM**: Replace Claude's inaccurate statusline estimates with real token counts AND provide detailed drill-down analysis.

## Core Problem

Claude Code's statusline shows inaccurate estimates. Users need to see:
1. **REAL-TIME**: Accurate token counts in statusline (not estimates)
2. **ANALYSIS**: What operations they performed and token costs
3. **DRILL-DOWN**: The actual content that caused token costs

## Technical Approach

### Data Sources
- **JSONL transcripts** in `~/.claude/projects/` contain token usage
- **Pre/post hooks** capture operation details as they happen
- **Redis** stores operation data (MCP server ensures it's always running)

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

# Type checking (manual)
npx tsc --noEmit
```
