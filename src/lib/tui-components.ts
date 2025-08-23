// Simplified terminal-based implementation for token analysis
import { correlateOperations, Bundle, Operation } from './correlation-engine';
import { getTokenCount } from './token-calculator';
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
          result = a.totalTokens - b.totalTokens;
          break;
        case 'time':
          result = a.timestamp - b.timestamp;
          break;
        case 'operation':
          const aOp = a.operations[0]?.tool || '';
          const bOp = b.operations[0]?.tool || '';
          result = aOp.localeCompare(bOp);
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
        
        let description: string;
        let tokensDisplay: string;
        
        if (bundle.operations.length === 1) {
          const op = bundle.operations[0];
          description = `${op.tool}: ${op.details}`;
          tokensDisplay = `${bundle.totalTokens.toLocaleString()} tokens`;
        } else {
          description = `Bundle (${bundle.operations.length} ops)`;
          tokensDisplay = `${bundle.totalTokens.toLocaleString()} tokens`;
        }
        
        const line = `${prefix}${timeStr} | ${tokensDisplay} | ${description}`;
        if (isSelected) {
          console.log(`\x1b[44m${line.padEnd(80)}\x1b[0m`); // Blue background
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
      allLines.push(`│ Tokens: ${operation.tokens.toLocaleString()} (${operation.allocation})`);
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