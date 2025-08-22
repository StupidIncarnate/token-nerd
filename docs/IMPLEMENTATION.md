# Implementation Plan

## CURRENT STATUS (Updated Aug 2025)

✅ **COMPLETED STEPS:**
- ✅ Step 0: MCP Server & Package Setup - **COMPLETED via postinstall script**
- ✅ Step 1: Hook Infrastructure - **COMPLETED with settings.json approach**
- ✅ Step 2: Session Tracking System - **COMPLETED**
- ❌ Step 3: Interactive TUI with Token Correlation - **PENDING**
- ❌ Step 4: Drill-Down Detail View - **PENDING**

**KEY ACHIEVEMENT**: Hooks are now firing and capturing data to Redis in real-time.

## Objective
Enable users to see a chronological, sortable list of ALL token-consuming operations across any session, with ability to drill into the actual content that caused token costs.

## Core Question We're Answering
"What specific operation caused that 45k token spike?"

---

## Step 0: MCP Server & Package Setup (1 hour)

### What we build
- MCP server that manages Redis lifecycle
- When Claude starts: MCP starts → Redis starts
- When Claude stops: MCP stops → Redis stops
- ✅ **COMPLETED**: Automatic setup via postinstall script adds server to ~/.claude.json
- ✅ **COMPLETED**: Automatic hook configuration in ~/.claude/settings.json

### What we build
- Main CLI entry point with commander
- ✅ **COMPLETED**: Automatic installation via postinstall script (no manual commands needed)
- Package.json with proper bin configuration

### Implementation Details
```typescript
// src/cli/index.ts
#!/usr/bin/env -S npx tsx

import { program } from 'commander';

// ✅ OBSOLETE: Manual install commands removed
// Now handled automatically by postinstall script via TokenNerdInstaller
program
  .option('--statusline', 'Output formatted token count for statusline')
  .action(() => {
    // Interactive TUI (coming soon)
  });

// Main command (default when no subcommand specified)
program
  .option('--session <id>', 'Select specific session')
  .option('--current', 'Use current project session')
  .action((options) => {
    // Launch interactive TUI with Ink
    // If no --session, use inquirer to select
  });

// package.json
{
  "name": "token-nerd",
  "bin": {
    "token-nerd": "./src/cli/index.ts"
  }
}
```

### User Acceptance Test
```bash
$ npm install -g token-nerd
# Postinstall script automatically runs:
✓ Added Token Nerd MCP server to ~/.claude.json
✓ Created symlink: ~/.config/claude/hooks/pre-tool-use -> token-nerd/src/hooks/pre-tool-use.ts
✓ Created symlink: ~/.config/claude/hooks/post-tool-use -> token-nerd/src/hooks/post-tool-use.ts
✓ Added hook configuration to ~/.claude/settings.json
✓ Created statusline integration
✓ Installation complete - restart Claude Code
```

---

## Step 1: Hook Infrastructure (2 hours) ✅ **COMPLETED**

**✅ COMPLETION STATUS (Aug 2025):**
- ✅ Modern settings.json configuration approach implemented
- ✅ Pre/post-tool-use hooks firing and writing to Redis
- ✅ Verified working with live Claude Code operations
- ✅ Session IDs, timestamps, response sizes all captured
- ✅ Large response handling (filesystem storage for >10KB responses)

### What we build
- Pre/post-tool-use hooks that write directly to Redis
- Redis is guaranteed to be running (via MCP server)
- Hooks receive session_id in JSON payload from Claude Code
- Response size calculation for proportional token allocation
- Large responses stored on filesystem, reference in Redis

### Implementation Details
```
# Hooks installed automatically by postinstall script
~/.config/claude/hooks/pre-tool-use    # Symlink to token-nerd/src/hooks/pre-tool-use.ts
~/.config/claude/hooks/post-tool-use   # Symlink to token-nerd/src/hooks/post-tool-use.ts

# Hook files have #!/usr/bin/env -S npx tsx shebang
# Made executable with chmod +x during install

# Pre-hook receives JSON via stdin and stores:
{
  session_id: string,
  tool_name: string,
  tool_input: { file_path?, command?, content?, ... }
}

// Hook reads from stdin:
const input = await readFromStdin();
const data = JSON.parse(input);

# Post-hook receives:
{
  session_id: string,
  tool_name: string,
  tool_response: { success, output, ... },
  message_id: string,  // Links to JSONL message
  usage?: {            // May include token data
    input_tokens?: number,
    cache_creation_input_tokens?: number
  }
}

// Post-hook can calculate and store estimated tokens immediately!

# Redis schema
session:<session_id>:operations:<timestamp> = {
  tool: string,
  params: object,
  response: object,
  responseSize: number,  # For proportional token allocation
  timestamp: number
}

# Redis connection (guaranteed by MCP server)
const redis = createClient({
  url: 'redis://localhost:6379',
  socket: { connectTimeout: 1000 }
})
```

### User Acceptance Test
```bash
# User performs a Read operation in Claude Code
# Operations are written directly to Redis
# When user runs analyzer, data is available
$ npx token-nerd
# Shows all captured operations
```

### Success Criteria
- [x] Hooks fire on EVERY tool operation ✅ **VERIFIED WORKING**
- [x] Session ID correctly extracted from environment ✅ **VERIFIED WORKING**
- [x] Operations written to Redis (guaranteed running via MCP) ✅ **VERIFIED WORKING**
- [x] Both request (pre) and response (post) captured ✅ **VERIFIED WORKING**
- [x] Data automatically available when analyzer runs ✅ **VERIFIED WORKING**

### Before Moving On
User MUST verify hooks are capturing data by performing 2-3 operations and running the analyzer.
✅ **COMPLETED** - Verified hooks capturing live operations to Redis

---

## Step 2: Session Tracking System (2 hours) ✅ **COMPLETED**

**✅ COMPLETION STATUS (Aug 2025):**
- ✅ Session discovery implemented (`src/lib/session-tracker.ts`)
- ✅ JSONL file scanning and metadata extraction
- ✅ Project name detection from transcript files
- ✅ Session selection with inquirer integration
- ✅ Active vs idle session detection

### What we build
- Lightweight session discovery that only reads file metadata
- Token counts are ONLY parsed when user selects a specific session
- Cache results in memory for performance

### Implementation Details
```md
// When user runs 'npx token-nerd sessions':
1. Scan ~/.claude/projects/ for *.jsonl files (fs.readdir)
2. Get file stats (size, mtime) - DO NOT parse content
3. Show list with file size as proxy for tokens
4. Mark as "active" if modified < 5 min ago

// When user runs 'npx token-nerd' (no --session flag):
1. Use inquirer to show interactive session list
2. User selects with arrow keys and Enter
3. Once selected:
   - Check memory cache first
   - If cache miss or stale (>5 min old):
     - Parse JSONL to get actual token count  
     - Update memory cache
   - Display operations for that session

// When user runs 'npx token-nerd --session=<id>':
1. Skip selection, use provided session ID directly
2. Same cache/parse logic as above

// Memory cache (no Redis needed for session list)
const sessionCache = new Map();
// Cache entries expire after 5 minutes
```

### User Acceptance Test
```bash
# User has multiple Claude Code sessions open
$ npx token-nerd sessions

Active Sessions:
1. ce03c353 (token-nerd) - 83,788 tokens - ACTIVE NOW
2. 1d793c3d (codex-project) - 35,237 tokens - ACTIVE NOW
3. f2e31064 (token-nerd) - 152,000 tokens - 2 hours ago
```

### Success Criteria
- [ ] Shows ALL sessions from ~/.claude/projects
- [ ] Correctly identifies active vs idle (based on file modification time)
- [ ] Shows project associations and paths
- [ ] Token counts are accurate from JSONL
- [ ] User sees their actual sessions listed

### Before Moving On
User MUST see their current sessions accurately listed with correct projects and token counts.

---

## Step 3: Interactive TUI with Token Correlation (4 hours)

### What we build
- Interactive TUI using Ink (React for terminal)
- Hierarchical view with expandable bundles (Tab to expand/collapse)
- Live sorting without restarting:
  - 't' = sort by tokens (high to low)
  - 'c' = sort by time (chronological)
  - 'o' = sort by operation type
- Token correlation engine that merges hook data with JSONL:
  - Single operations get exact token counts
  - Bundled operations get proportional allocation based on response size
- Press Enter on any row to view full details
- 'q' to quit

### Implementation Details

#### Token Correlation Logic
```typescript
// lib/correlation-engine.ts
// This is the core logic that enables granular token tracking

async function correlateOperations(sessionId: string) {
  // 1. Read hook logs from Redis (individual operations + response sizes)
  const operations = await redis.get(`session:${sessionId}:operations:*`);
  
  // 2. Read JSONL messages (total tokens per message)
  const jsonlPath = `~/.claude/projects/${sessionId}.jsonl`;
  const messages = parseJSONL(jsonlPath);
  
  // 3. Match operations to messages by timestamp/message_id
  const correlated = operations.map(op => {
    const message = messages.find(m => m.id === op.message_id);
    
    // 4. For single operation: Assign all tokens to that operation
    if (message.operations.length === 1) {
      return { ...op, tokens: message.usage.total_tokens, allocation: 'exact' };
    }
    
    // 5. For multiple operations: Distribute proportionally by response size
    const totalResponseSize = message.operations.reduce((sum, o) => sum + o.responseSize, 0);
    const proportion = op.responseSize / totalResponseSize;
    const allocatedTokens = Math.round(message.usage.total_tokens * proportion);
    
    return { ...op, tokens: allocatedTokens, allocation: 'proportional' };
  });
  
  return correlated;
}
```

#### Interactive TUI Component
```typescript
// src/cli/index.ts - Interactive TUI with Ink
import React, { useState, useEffect } from 'react';
import { render, Text, Box, useInput } from 'ink';
import { correlateOperations } from '../lib/correlation-engine';

const TokenAnalyzer = ({ sessionId }) => {
  const [operations, setOperations] = useState([]);
  const [sortMode, setSortMode] = useState('time');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState(new Set());
  
  useEffect(() => {
    // Load and correlate operations on mount
    correlateOperations(sessionId).then(setOperations);
  }, [sessionId]);
  
  // Group operations by timestamp/message_id for bundled operations
  const grouped = operations.reduce((acc, op) => {
    const key = op.message_id || op.timestamp;
    if (!acc[key]) {
      acc[key] = {
        id: key,
        timestamp: op.timestamp,
        operations: [],
        totalTokens: 0
      };
    }
    acc[key].operations.push(op);
    acc[key].totalTokens += op.tokens;
    return acc;
  }, {});
  
  const bundles = Object.values(grouped);
  
  useInput((input, key) => {
    if (input === 't') setSortMode('tokens');
    if (input === 'c') setSortMode('time');
    if (input === 'o') setSortMode('operation');
    if (key.tab) {
      const bundle = bundles[selectedIndex];
      if (bundle.operations.length > 1) {
        if (expanded.has(bundle.id)) {
          expanded.delete(bundle.id);
        } else {
          expanded.add(bundle.id);
        }
        setExpanded(new Set(expanded));
      }
    }
    if (key.return) viewDetails(bundles[selectedIndex]);
    if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
    if (key.downArrow) setSelectedIndex(Math.min(bundles.length - 1, selectedIndex + 1));
  });

  const sorted = [...bundles].sort((a, b) => {
    if (sortMode === 'tokens') return b.totalTokens - a.totalTokens;
    if (sortMode === 'time') return a.timestamp - b.timestamp;
    return a.operations[0].operation.localeCompare(b.operations[0].operation);
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" paddingX={1}>
        <Text>Session: {sessionId} | Total: {totalTokens} | Sort: {sortMode.toUpperCase()}</Text>
      </Box>
      
      {sorted.map((bundle, i) => (
        <Box key={bundle.id} flexDirection="column">
          <Text backgroundColor={i === selectedIndex ? 'blue' : undefined}>
            {bundle.operations.length > 1 ? (expanded.has(bundle.id) ? '▼' : '▶') : ' '}
            {' '}{bundle.timestamp} | {bundle.totalTokens.toLocaleString()} tokens | 
            {bundle.operations.length > 1 
              ? ` Bundle (${bundle.operations.length} ops)` 
              : ` ${bundle.operations[0].tool}: ${bundle.operations[0].details}`}
          </Text>
          
          {expanded.has(bundle.id) && bundle.operations.map(op => (
            <Text key={`${bundle.id}-${op.tool}`} dimColor>
              {'  └─ '}{op.tool}: {op.details} ({op.tokens.toLocaleString()} tokens - {op.allocation})
            </Text>
          ))}
        </Box>
      ))}
      
      <Text dimColor>
        Controls: [t]okens | [c]hronological | [Tab] expand | [↑↓] navigate | [Enter] view | [q]uit
      </Text>
    </Box>
  );
};

// Main CLI entry point
if (!options.session) {
  // Use inquirer for session selection first
  const session = await selectSession();
  // Then render Ink TUI
  render(<TokenAnalyzer operations={operations} />);
}
```

### User Acceptance Test
```bash
$ npx token-nerd

# First shows session selection
Select session (↑↓ to navigate, Enter to select):
> ● ce03c353 (token-nerd) - 83,788 tokens [ACTIVE]
  ○ 1d793c3d (codex-project) - 35,237 tokens [ACTIVE]

# After selection, shows hierarchical view with bundles
Session: ce03c353 | Total: 83,788 tokens | Sort: TIME

  10:32:15 | 1,234 tokens | Read: src/config.ts
▶ 10:32:18 | 45,670 tokens | Bash: npm test
▶ 10:32:45 | 12,890 tokens | Bundle (3 ops)
  10:33:02 | 890 tokens | Edit: src/small.ts

Controls: [t]okens | [c]hronological | [Tab] expand | [↑↓] navigate | [Enter] view | [q]uit

# User presses Tab on the Bundle - it expands to show children
Session: ce03c353 | Total: 83,788 tokens | Sort: TIME

  10:32:15 | 1,234 tokens | Read: src/config.ts
▶ 10:32:18 | 45,670 tokens | Bash: npm test
▼ 10:32:45 | 12,890 tokens | Bundle (3 ops)
  └─ Read: src/large.ts (8,234 tokens - proportional)
  └─ Edit: src/api.ts (3,456 tokens - proportional)
  └─ Write: src/new.ts (1,200 tokens - proportional)
  10:33:02 | 890 tokens | Edit: src/small.ts

# User presses 't' - re-sorts by token cost (bundles sorted by total)
Session: ce03c353 | Total: 83,788 tokens | Sort: TOKENS

▶ 10:32:18 | 45,670 tokens | Bash: npm test
▼ 10:32:45 | 12,890 tokens | Bundle (3 ops)
  └─ Read: src/large.ts (8,234 tokens - proportional)
  └─ Edit: src/api.ts (3,456 tokens - proportional)
  └─ Write: src/new.ts (1,200 tokens - proportional)
  10:32:15 | 1,234 tokens | Read: src/config.ts
  10:33:02 | 890 tokens | Edit: src/small.ts
```

### Success Criteria
- [ ] Session selection uses arrow keys (via inquirer)
- [ ] Hierarchical view shows bundled operations that can be expanded with Tab
- [ ] Live sorting with keyboard shortcuts (t/c/o) without restarting
- [ ] Token correlation works correctly:
  - [ ] Single operations show "exact" allocation
  - [ ] Bundled operations show "proportional" allocation
  - [ ] Total tokens for bundles match JSONL message totals
- [ ] Summary provides enough context to identify expensive operations
- [ ] User can quickly identify what caused token spikes

### Before Moving On
User MUST be able to see their operations sorted by token cost and identify expensive operations.

---

## Step 4: Drill-Down Detail View (2 hours)

### What we build
- Press Enter on any row to view full operation details
- Modal overlay shows complete payload and response
- Scrollable view for large outputs
- ESC to return to main list

### Implementation Details
```tsx
// Integrated into the Ink TUI
const [viewingDetails, setViewingDetails] = useState(null);

useInput((input, key) => {
  if (viewingDetails) {
    // Detail view controls
    if (key.escape) setViewingDetails(null);
    if (key.upArrow) scrollUp();
    if (key.downArrow) scrollDown();
  } else {
    // Main list controls
    if (key.return) {
      const selected = bundles[selectedIndex];
      // Fetch full payload from Redis or filesystem
      const details = await fetchOperationDetails(selected);
      setViewingDetails(details);
    }
  }
});

// Storage strategy in post-hook
if (response.length < 10000) {
  redis.set(`operation:${timestamp}:response`, JSON.stringify(response));
} else {
  // Store large responses on filesystem
  fs.writeFileSync(`~/.claude/token-nerd/responses/${session_id}/${timestamp}.json`, response);
  redis.set(`operation:${timestamp}:response`, `file://${timestamp}.json`);
}

// Render detail view overlay
{viewingDetails && (
  <Box borderStyle="double" padding={1}>
    <Box flexDirection="column">
      <Text bold>Operation Details</Text>
      <Text>Tool: {viewingDetails.tool}</Text>
      <Text>Tokens: {viewingDetails.tokens}</Text>
      <Text>---Request---</Text>
      <Text>{JSON.stringify(viewingDetails.params, null, 2)}</Text>
      <Text>---Response--- (lines {scrollOffset}-{scrollOffset+20})</Text>
      <ScrollableText content={viewingDetails.response} />
      <Text dimColor>↑↓ scroll | ESC back</Text>
    </Box>
  </Box>
)}
```

### User Acceptance Test
```bash
# User is viewing the main list
Session: ce03c353 | Total: 83,788 tokens | Sort: TOKENS

▶ 10:32:18 | 45,670 tokens | Bash: npm test          <-- highlighted
▼ 10:32:45 | 12,890 tokens | Bundle (3 ops)
  └─ Read: src/large.ts (8,234 tokens)
  └─ Edit: src/api.ts (3,456 tokens)
  └─ Write: src/new.ts (1,200 tokens)

# User presses Enter on the Bash operation - detail view appears as overlay

╔══════════════════ Operation Details ═══════════════════╗
║ Tool: Bash                                             ║
║ Time: 10:32:18                                         ║
║ Tokens: 45,670 (exact - single operation)              ║
║                                                         ║
║ ─── Request ───                                        ║
║ {                                                       ║
║   "command": "npm test",                               ║
║   "cwd": "/home/project"                               ║
║ }                                                       ║
║                                                         ║
║ ─── Response (lines 1-20 of 8,234) ───                 ║
║ > my-project@1.0.0 test                                ║
║ > jest --coverage                                      ║
║                                                         ║
║ PASS src/app.test.ts                                   ║
║   ✓ should return user (23ms)                          ║
║   ✓ should handle errors (5ms)                         ║
║                                                         ║
║ Test Suites: 15 passed, 15 total                       ║
║ Tests:       248 passed, 248 total                     ║
║                                                         ║
║ [↑↓] scroll | [ESC] back to list                       ║
╚═════════════════════════════════════════════════════════╝
```

### Success Criteria
- [ ] Can view FULL response for any operation
- [ ] Large outputs are paginated/scrollable
- [ ] Response content matches what caused token cost
- [ ] User can identify WHY operation was expensive
- [ ] Search within response works

### Before Moving On
User MUST be able to drill into their most expensive operation and see the actual output.

---


## Final Validation

### Complete User Flow Test
```bash
# 1. User performs expensive operation (read large file)
# 2. Hooks capture operation and response size
# 3. JSONL shows token spike for that message
# 4. User runs: npx token-nerd
# 5. Presses 't' to sort by tokens
# 6. Sees the expensive operation at top with calculated token cost
# 7. Presses Enter to drill into details
# 8. Sees full response content that caused the spike
# 9. Confirms: "Yes, this 200KB file content caused the 45k spike"
```

### Success Metrics
- [ ] User can identify expensive operations within 30 seconds
- [ ] Token costs make sense (large files = more tokens)
- [ ] Tool provides actionable insights
- [ ] User knows what to optimize


## Dependencies
```json
{
  "dependencies": {
    "redis": "^4.0.0",
    "commander": "^9.0.0",
    "inquirer": "^9.0.0",
    "tsx": "^3.0.0",
    "ink": "^4.0.0",
    "react": "^18.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "@types/react": "^18.0.0"
  }
}
```

## File Structure
```
token-nerd/
├── src/
│   ├── hooks/
│   │   ├── pre-tool-use.ts      # #!/usr/bin/env -S npx tsx
│   │   └── post-tool-use.ts     # #!/usr/bin/env -S npx tsx
│   ├── cli/
│   │   └── index.ts              # Main CLI entry point
│   ├── commands/
│   │   └── install-hooks.ts
│   ├── lib/
│   │   ├── redis-client.ts      # Redis client for analysis
│   │   ├── session-tracker.ts
│   │   ├── operation-store.ts
│   │   ├── correlation-engine.ts   # Merges hook data with JSONL for proportional allocation
│   │   └── tui-components.ts       # Ink components for interactive UI
│   └── config.ts
├── package.json
└── tsconfig.json
```