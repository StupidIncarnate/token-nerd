// Simplified terminal-based implementation for token analysis
import { correlateOperations, Bundle, Operation } from './correlation-engine';
import { getTokenCount, calculateCumulativeTotal, calculateConversationGrowth, calculateRemainingCapacity } from './token-calculator';
import * as readline from 'readline';

type SortMode = 'time' | 'tokens' | 'operation';

interface TerminalState {
  bundles: Bundle[];
  sortMode: SortMode;
  sortAscending: boolean;
  selectedIndex: number;
  expanded: Set<string>;
  viewingDetails: Bundle | null;
  detailScrollOffset: number;
}

class TokenAnalyzer {
  private state: TerminalState;
  private rl: readline.Interface;
  private sessionId: string;

  constructor(sessionId: string, private jsonlPath?: string) {
    this.sessionId = sessionId;
    this.state = {
      bundles: [],
      sortMode: 'time',
      sortAscending: true,
      selectedIndex: 0,
      expanded: new Set(),
      viewingDetails: null,
      detailScrollOffset: 0
    };

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Enable raw mode for single key presses
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    process.stdin.setEncoding('utf8');
  }

  async initialize(): Promise<void> {
    console.log(`Loading operations for session ${this.sessionId.slice(0, 8)}...`);
    
    try {
      this.state.bundles = await correlateOperations(this.sessionId, this.jsonlPath);
      
      if (this.state.bundles.length === 0) {
        console.log(`\nNo operations found for session ${this.sessionId.slice(0, 8)}`);
        console.log('Either no hooks data available or session has no recorded operations.');
        console.log('Press any key to exit...');
        await this.waitForKey();
        this.cleanup();
        return;
      }

      await this.render();
      this.setupKeyHandlers();
      
    } catch (error) {
      console.error('Failed to load operations:', error);
      this.cleanup();
    }
  }

  private getSortedBundles(): Bundle[] {
    return [...this.state.bundles].sort((a, b) => {
      let result: number;
      
      switch (this.state.sortMode) {
        case 'tokens':
          // For token sorting, prioritize context growth operations
          const aOp = a.operations[0];
          const bOp = b.operations[0];
          
          // Sort ToolResponses by size, others by tokens
          const aValue = aOp?.tool === 'ToolResponse' ? aOp.responseSize :
                        aOp?.contextGrowth > 0 ? aOp.contextGrowth : 
                        a.totalTokens;
          const bValue = bOp?.tool === 'ToolResponse' ? bOp.responseSize :
                        bOp?.contextGrowth > 0 ? bOp.contextGrowth :
                        b.totalTokens;
          
          result = aValue - bValue;
          break;
        case 'time':
          result = a.timestamp - b.timestamp;
          break;
        case 'operation':
          const aOpTool = a.operations[0]?.tool || '';
          const bOpTool = b.operations[0]?.tool || '';
          result = aOpTool.localeCompare(bOpTool);
          break;
        default:
          return 0;
      }
      
      return this.state.sortAscending ? result : -result;
    });
  }

  private getFlatItems(): Array<{ type: 'bundle' | 'operation'; bundle: Bundle; operation?: Operation; index: number }> {
    const items: Array<{ type: 'bundle' | 'operation'; bundle: Bundle; operation?: Operation; index: number }> = [];
    const sortedBundles = this.getSortedBundles();
    
    sortedBundles.forEach((bundle, bundleIndex) => {
      items.push({ type: 'bundle', bundle, index: bundleIndex });
      
      if (this.state.expanded.has(bundle.id) && bundle.operations.length > 1) {
        bundle.operations.forEach((operation, opIndex) => {
          items.push({ type: 'operation', bundle, operation, index: bundleIndex * 100 + opIndex });
        });
      }
    });
    
    return items;
  }

  private clearScreen(): void {
    process.stdout.write('\x1Bc'); // Reset terminal
    process.stdout.write('\x1B[2J\x1B[3J'); // Clear screen and scrollback
    process.stdout.write('\x1B[H'); // Move cursor to home
  }

  private async render(): Promise<void> {
    if (this.state.viewingDetails) {
      this.renderDetails();
      return;
    }

    this.clearScreen();

    // Get session total from JSONL (not sum of individual operations)
    const totalTokens = this.jsonlPath ? await getTokenCount(this.jsonlPath) : 0;
    const flatItems = this.getFlatItems();
    
    // Pagination for long lists
    const itemsPerPage = 20;
    const currentPage = Math.floor(this.state.selectedIndex / itemsPerPage);
    const startIndex = currentPage * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, flatItems.length);
    const visibleItems = flatItems.slice(startIndex, endIndex);

    // Header
    const sortDirection = this.state.sortAscending ? '↑' : '↓';
    console.log(`┌${'─'.repeat(78)}┐`);
    console.log(`│ Session: ${this.sessionId.slice(0, 8)} | Total: ${totalTokens.toLocaleString()} tokens | Sort: ${this.state.sortMode.toUpperCase()} ${sortDirection}`);
    console.log(`│ Page ${currentPage + 1}/${Math.ceil(flatItems.length / itemsPerPage)} | Items ${startIndex + 1}-${endIndex} of ${flatItems.length}`);
    console.log(`└${'─'.repeat(78)}┘\n`);

    // Calculate actual context window deltas (what each message adds)
    const contextTotals = new Map<string, number>();
    const contextDeltas = new Map<string, number>();
    
    let previousTotal = 0;
    let runningTotal = 0;
    
    this.state.bundles.forEach(b => {
      const op = b.operations[0];
      let contextDelta = 0;
      
      if (op.usage && op.allocation === 'exact') {
        // Get cumulative total for this message
        const currentTotal = calculateCumulativeTotal(op.usage);
        
        // Calculate actual context delta (what this message added)
        contextDelta = currentTotal - previousTotal;
        previousTotal = currentTotal;
        runningTotal = currentTotal;
      }
      // For messages without usage (User messages), use the last known total
      
      // Store both values for display
      contextTotals.set(b.id, runningTotal);
      contextDeltas.set(b.id, contextDelta);
    });
    
    // Operations list (paginated)
    visibleItems.forEach((item, i) => {
      const actualIndex = startIndex + i;
      const isSelected = actualIndex === this.state.selectedIndex;
      const prefix = isSelected ? '→ ' : '  ';
      
      if (item.type === 'bundle') {
        const bundle = item.bundle;
        const expandIcon = bundle.operations.length > 1 
          ? (this.state.expanded.has(bundle.id) ? '▼' : '▶') 
          : ' ';
        
        const timeStr = new Date(bundle.timestamp).toLocaleTimeString();
        const contextTotal = contextTotals.get(bundle.id) || 0;
        const contextStr = contextTotal.toLocaleString('en-US', { 
          minimumIntegerDigits: 6, 
          useGrouping: true 
        }).padStart(8);
        
        const contextDelta = contextDeltas.get(bundle.id) || 0;
        const capacity = calculateRemainingCapacity(contextTotal);
        
        let description: string;
        let tokensDisplay: string;
        let icon: string;
        
        if (bundle.operations.length === 1) {
          const op = bundle.operations[0];
          
          // Choose icon based on tool type
          switch(op.tool) {
            case 'User': icon = '👤'; break;
            case 'ToolResponse': icon = '📥'; break;
            case 'Assistant': icon = '🤖'; break;
            case 'Context': icon = '📊'; break;
            case 'Read': icon = '📖'; break;
            case 'Write': icon = '✏️'; break;
            case 'Edit': icon = '📝'; break;
            case 'Bash': icon = '💻'; break;
            case 'LS': icon = '📁'; break;
            default: icon = '🔧';
          }
          
          // Add cache expiration warning to description if present
          const cacheWarning = op.details.includes('⚠️') ? '' : 
                              (op.timeGap && op.timeGap > 300) ? ' ⚠️' : '';
          description = `${icon} ${op.tool}: ${op.details}${cacheWarning}`;
          
          // Format tokens based on operation type - show actual context delta
          if (op.tool === 'ToolResponse') {
            // Show size for tool responses
            tokensDisplay = `[${op.details}]`;
          } else if (op.tool === 'User') {
            // Show estimated tokens for user messages
            tokensDisplay = `~${op.tokens} est`;
          } else if (contextDelta > 0) {
            // Show actual context window delta (what this message added)
            tokensDisplay = `+${contextDelta.toLocaleString()} context`;
            if (op.generationCost > 0) {
              tokensDisplay += ` (${op.generationCost.toLocaleString()} gen)`;
            }
          } else if (op.generationCost > 0) {
            tokensDisplay = `${op.generationCost.toLocaleString()} gen`;
          } else {
            tokensDisplay = `${op.tokens.toLocaleString()} tokens`;
          }
        } else {
          icon = '📦';
          description = `${icon} Bundle (${bundle.operations.length} ops)`;
          tokensDisplay = `${bundle.totalTokens.toLocaleString()} tokens`;
        }
        
        // Add capacity warning if near limit
        const capacityWarning = capacity.isNearLimit ? ' ⚠️' : '';
        const remainingStr = `${Math.round(capacity.remaining/1000)}k left`;
        
        const line = `${prefix}${timeStr} [${contextStr}] | ${tokensDisplay.padEnd(25)} | ${description}${capacityWarning}`;
        if (isSelected) {
          console.log(`\x1b[44m${line.padEnd(100)}\x1b[0m`); // Blue background
        } else {
          console.log(line);
        }
      } else {
        // Operation under expanded bundle
        const op = item.operation!;
        const timeStr = new Date(op.timestamp).toLocaleTimeString();
        const tokensStr = `${op.tokens.toLocaleString()} tokens - ${op.allocation}`;
        
        const line = `${prefix}    └─ ${op.tool}: ${op.details} (${tokensStr})`;
        if (isSelected) {
          console.log(`\x1b[44m${line.padEnd(80)}\x1b[0m`); // Blue background
        } else {
          console.log(`\x1b[2m${line}\x1b[0m`); // Dimmed
        }
      }
    });
    
    // Add spacing if fewer items than page size
    for (let i = visibleItems.length; i < itemsPerPage; i++) {
      console.log('');
    }

    // Controls
    console.log('\n' + '─'.repeat(80));
    console.log('Controls: [t]okens | [c]hronological | [o]peration | [Tab] expand | [↑↓] navigate | [Enter] details | [q]uit');
    console.log('Press sort keys again to toggle asc/desc (↑↓)');
  }

  private renderDetails(): void {
    const bundle = this.state.viewingDetails!;
    
    this.clearScreen();
    
    console.log(`┌${'─'.repeat(78)}┐`);
    console.log(`│ BUNDLE DETAILS - ${bundle.operations.length} Operations`);
    console.log(`└${'─'.repeat(78)}┘\n`);
    
    console.log(`Bundle ID: ${bundle.id}`);
    console.log(`Total Tokens: ${bundle.totalTokens.toLocaleString()}`);
    console.log(`Time: ${new Date(bundle.timestamp).toLocaleTimeString()}`);
    console.log('');
    
    // Build combined content with headers
    const allLines: string[] = [];
    
    bundle.operations.forEach((operation, index) => {
      allLines.push(`┌─ OPERATION ${index + 1}: ${operation.tool} ─${'─'.repeat(Math.max(1, 50 - operation.tool.length))}`);
      
      // Show different info based on operation type
      if (operation.tool === 'System') {
        allLines.push(`│ ⚠️ Hidden System Context`);
        allLines.push(`│ Size: ${(operation.responseSize / 1024).toFixed(1)}KB`);
        allLines.push(`│ Estimated Impact: ~${operation.tokens.toLocaleString()} tokens`);
      } else if (operation.tool === 'ToolResponse') {
        allLines.push(`│ Size: ${(operation.responseSize / 1024).toFixed(1)}KB`);
        allLines.push(`│ Estimated Tokens: ~${operation.tokens.toLocaleString()}`);
        allLines.push(`│ Impact: This content will be processed in the next Assistant message`);
      } else if (operation.tool === 'User') {
        allLines.push(`│ Message Length: ${operation.responseSize} chars`);
        allLines.push(`│ Estimated Tokens: ~${operation.tokens.toLocaleString()}`);
        if (operation.timeGap && operation.timeGap > 300) {
          allLines.push(`│ ⚠️ Time Gap: ${Math.round(operation.timeGap/60)} minutes (cache may expire)`);
        }
      } else {
        allLines.push(`│ Tokens: ${operation.tokens.toLocaleString()} (${operation.allocation})`);
        
        // Show context growth vs generation split
        if (operation.contextGrowth > 0 || operation.generationCost > 0) {
          allLines.push(`│ Breakdown:`);
          if (operation.contextGrowth > 0) {
            allLines.push(`│   Context Growth: +${operation.contextGrowth.toLocaleString()} (new content added)`);
          }
          if (operation.generationCost > 0) {
            allLines.push(`│   Generation Cost: ${operation.generationCost.toLocaleString()} (output tokens)`);
          }
        }
        
        // Show cache metrics
        if (operation.cacheEfficiency !== undefined) {
          allLines.push(`│ Cache Efficiency: ${operation.cacheEfficiency.toFixed(1)}%${operation.cacheEfficiency < 50 ? ' ⚠️ LOW' : ''}`);
        }
        
        if (operation.timeGap && operation.timeGap > 300) {
          allLines.push(`│ ⚠️ Time Gap: ${Math.round(operation.timeGap/60)} minutes (cache expired)`);
        }
        
        // Show ephemeral cache info
        if (operation.ephemeral5m || operation.ephemeral1h) {
          allLines.push(`│ Ephemeral Cache:`);
          if (operation.ephemeral5m) {
            allLines.push(`│   5-min: ${operation.ephemeral5m.toLocaleString()} tokens`);
          }
          if (operation.ephemeral1h) {
            allLines.push(`│   1-hour: ${operation.ephemeral1h.toLocaleString()} tokens`);
          }
        }
        
        // Show full token breakdown if available
        if (operation.usage) {
          allLines.push(`│ Full Usage:`);
          if (operation.usage.cache_creation_input_tokens) {
            allLines.push(`│   Cache Creation: ${operation.usage.cache_creation_input_tokens.toLocaleString()}`);
          }
          if (operation.usage.cache_read_input_tokens) {
            allLines.push(`│   Cache Read: ${operation.usage.cache_read_input_tokens.toLocaleString()}`);
          }
          if (operation.usage.input_tokens) {
            allLines.push(`│   Input: ${operation.usage.input_tokens.toLocaleString()}`);
          }
          if (operation.usage.output_tokens) {
            allLines.push(`│   Output: ${operation.usage.output_tokens.toLocaleString()}`);
          }
        }
      }
      
      allLines.push(`│ Response Size: ${operation.responseSize.toLocaleString()} chars`);
      allLines.push(`│ Sequence: ${operation.sequence || 'N/A'}`);
      allLines.push(`│ Message ID: ${operation.message_id || 'N/A'}`);
      
      if (operation.tool !== 'Assistant') {
        allLines.push(`│ Request Parameters:`);
        const paramsStr = JSON.stringify(operation.params, null, 2);
        paramsStr.split('\n').forEach(line => allLines.push(`│   ${line}`));
        allLines.push(`│`);
      }
      
      allLines.push(`│ Response:`);
      const responseContent = typeof operation.response === 'string' 
        ? operation.response 
        : JSON.stringify(operation.response, null, 2);
      
      responseContent.split('\n').forEach(line => allLines.push(`│   ${line}`));
      
      allLines.push(`└${'─'.repeat(78)}`);
      allLines.push('');
    });
    
    // Handle scrolling
    const maxOffset = Math.max(0, allLines.length - 20);
    this.state.detailScrollOffset = Math.min(this.state.detailScrollOffset, maxOffset);
    this.state.detailScrollOffset = Math.max(0, this.state.detailScrollOffset);
    
    const visibleLines = allLines.slice(
      this.state.detailScrollOffset, 
      this.state.detailScrollOffset + 20
    );
    
    console.log(`Content (lines ${this.state.detailScrollOffset + 1}-${Math.min(this.state.detailScrollOffset + 20, allLines.length)} of ${allLines.length}):`);
    visibleLines.forEach(line => console.log(line));
    
    console.log('\n' + '─'.repeat(80));
    console.log('[↑↓] scroll | [ESC] back to list');
  }

  private setupKeyHandlers(): void {
    process.stdin.on('data', async (key: Buffer) => {
      const keyStr = key.toString();
      
      if (this.state.viewingDetails) {
        this.handleDetailsKeys(keyStr);
      } else {
        this.handleMainKeys(keyStr);
      }
      
      await this.render();
    });
  }

  private handleMainKeys(key: string): void {
    const flatItems = this.getFlatItems();
    
    switch (key) {
      case 't':
        if (this.state.sortMode === 'tokens') {
          this.state.sortAscending = !this.state.sortAscending;
        } else {
          this.state.sortMode = 'tokens';
          this.state.sortAscending = false; // Default to descending for tokens (high to low)
        }
        this.state.selectedIndex = 0;
        break;
      case 'c':
        if (this.state.sortMode === 'time') {
          this.state.sortAscending = !this.state.sortAscending;
        } else {
          this.state.sortMode = 'time';
          this.state.sortAscending = true; // Default to ascending for time (chronological)
        }
        this.state.selectedIndex = 0;
        break;
      case 'o':
        if (this.state.sortMode === 'operation') {
          this.state.sortAscending = !this.state.sortAscending;
        } else {
          this.state.sortMode = 'operation';
          this.state.sortAscending = true; // Default to ascending for operation (A-Z)
        }
        this.state.selectedIndex = 0;
        break;
      case 'q':
      case '\u0003': // Ctrl+C
        this.cleanup();
        break;
      case '\t': // Tab
        if (flatItems.length > 0) {
          const item = flatItems[this.state.selectedIndex];
          if (item.type === 'bundle' && item.bundle.operations.length > 1) {
            if (this.state.expanded.has(item.bundle.id)) {
              this.state.expanded.delete(item.bundle.id);
            } else {
              this.state.expanded.add(item.bundle.id);
            }
          }
        }
        break;
      case '\r': // Enter
        if (flatItems.length > 0) {
          const item = flatItems[this.state.selectedIndex];
          this.state.viewingDetails = item.bundle;
          this.state.detailScrollOffset = 0;
        }
        break;
      case '\u001b[A': // Up arrow
        this.state.selectedIndex = Math.max(0, this.state.selectedIndex - 1);
        break;
      case '\u001b[B': // Down arrow
        this.state.selectedIndex = Math.min(flatItems.length - 1, this.state.selectedIndex + 1);
        break;
    }
  }

  private handleDetailsKeys(key: string): void {
    switch (key) {
      case '\u001b': // ESC
        this.state.viewingDetails = null;
        this.state.detailScrollOffset = 0;
        break;
      case '\u001b[A': // Up arrow
        this.state.detailScrollOffset = Math.max(0, this.state.detailScrollOffset - 1);
        break;
      case '\u001b[B': // Down arrow
        this.state.detailScrollOffset = this.state.detailScrollOffset + 1;
        break;
      case 'q':
      case '\u0003': // Ctrl+C
        this.cleanup();
        break;
    }
  }

  private async waitForKey(): Promise<void> {
    return new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }


  private cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    this.rl.close();
    console.clear();
    process.exit(0);
  }
}

export async function launchTUI(sessionId: string, jsonlPath?: string): Promise<void> {
  const analyzer = new TokenAnalyzer(sessionId, jsonlPath);
  await analyzer.initialize();
}