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

## Coding Standards

### Function Design Principles
- **Single Responsibility**: Each function must do exactly one thing well
- **Maximum 50 lines per function**: Break larger functions into focused helpers
- **Descriptive names**: Function names should clearly state their purpose
- **Pure functions when possible**: Avoid side effects, return values explicitly
- **Object parameters**: All function parameters must use object destructuring with inline types: `someFn({ someProp }: { someProp: string }): [returnTypes]`

### File Organization Rules
- **One primary concern per file**: Don't mix unrelated functionality
- **Maximum 200 lines per file**: Consider separation when files grow larger
- **Logical groupings**: Group related functions into focused modules
- **Clear dependencies**: Import only what you need, avoid circular dependencies

### Type Safety Requirements
- **No `any` types**: Use proper TypeScript interfaces and union types
- **Strict TypeScript mode**: Enable all strict compiler checks
- **Type guards for external data**: Validate runtime data with proper checks
- **Explicit return types**: Always declare what functions return

### Security & Safety
- **No shell injection**: Use Node.js APIs instead of shell commands when possible
- **Input validation**: Sanitize all user input before processing
- **Error handling**: Every operation that can fail must handle errors explicitly
- **No hardcoded secrets**: Use environment variables for sensitive data

### Code Quality Standards
- **No magic numbers**: Extract constants to named variables with clear meaning
- **Consistent error handling**: Use standardized error patterns across the codebase
- **Performance awareness**: Read files efficiently, avoid O(n²) algorithms
- **Test coverage**: Every public function must have corresponding tests

### Naming Conventions
- **Constants**: `UPPER_SNAKE_CASE` for configuration values
- **Functions**: `camelCase` with verb-noun pattern (`parseMessage`, `calculateTokens`)
- **Interfaces**: `PascalCase` with descriptive names (`MessageInfo`, `TokenUsage`)
- **Files**: `kebab-case.ts` matching their primary export

### Anti-Patterns to Avoid
- **God functions**: Functions doing multiple unrelated tasks
- **String manipulation**: Avoid complex regex for parsing structured data
- **Silent failures**: Always log or handle errors explicitly
- **Tight coupling**: Functions should not depend on global state
- **Mixed concerns**: Don't mix business logic with I/O operations

### Data Sources
- **JSONL transcripts** in `~/.claude/projects/` contain token usage

## Key Discoveries

`docs/JSONL-TOKEN-FIELDS-EXPLAINED.md` explains how the jsonl fields work from a calculation perspective
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
