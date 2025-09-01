// Simplified terminal-based implementation for token analysis
import { correlateOperations, getLinkedOperations } from './correlation-engine';
import { getCurrentTokenCount, calculateCumulativeTotal, calculateRemainingCapacity, estimateTokensFromContent } from './token-calculator';
import { GenericListView } from './generic-list-view';
import * as readline from 'readline';
import { TIME_CONSTANTS } from '../config';
import type { Bundle, Operation, SortMode, TerminalState, ListItem, ListView, ListActions } from '../types';

// Utility function to calculate operation tokens for sorting
function getOperationTokens(op: Operation): number {
  if (op.tool === 'ToolResponse') {
    // Use estimated tokens for ToolResponse (~2,099 est)
    return estimateTokensFromContent(op.responseSize);
  } else if (op.tool === 'Assistant' && op.generationCost > 0) {
    // For Assistant messages, use output tokens (78 out)
    return op.generationCost;
  } else {
    // For User messages and others, use the operation tokens
    return op.tokens || 0;
  }
}

class TokenAnalyzer {
  private state: TerminalState;
  private rl: readline.Interface;
  private sessionId: string;
  private listView: GenericListView | null = null;

  constructor(sessionId: string, private jsonlPath?: string, private directMessageId?: string, private directContentPart?: number) {
    this.sessionId = sessionId;
    this.state = {
      bundles: [],
      sortMode: 'conversation',
      sortAscending: true,
      selectedIndex: 0,
      expanded: new Set(),
      viewingDetails: null,
      viewingSubAgent: null,
      detailScrollOffset: 0,
      shouldExit: false,
      exitCode: 0
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
        console.log('Session has no recorded operations.');
        console.log('Press any key to exit...');
        await this.waitForKey();
        this.cleanup();
        return;
      }

      // Check if we should go directly to detail view
      if (this.directMessageId) {
        this.goToDirectDetailView();
      }

      await this.render();
      this.setupKeyHandlers();
      await this.mainLoop();
      
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
          // Sort by per-operation token impact, not cumulative context
          const aOp = a.operations[0];
          const bOp = b.operations[0];
          
          const aValue = getOperationTokens(aOp);
          const bValue = getOperationTokens(bOp);
          
          result = aValue - bValue;
          break;
        case 'operation':
          const aOpTool = a.operations[0]?.tool || '';
          const bOpTool = b.operations[0]?.tool || '';
          result = aOpTool.localeCompare(bOpTool);
          break;
        case 'conversation':
          // Preserve the order from the correlation engine (conversation flow)
          const aOriginalIndex = this.state.bundles.findIndex(bundle => bundle.id === a.id);
          const bOriginalIndex = this.state.bundles.findIndex(bundle => bundle.id === b.id);
          result = aOriginalIndex - bOriginalIndex;
          break;
        default:
          return 0;
      }
      
      return this.state.sortAscending ? result : -result;
    });
  }

  private getFlatOperations(): Array<{ type: 'bundle' | 'operation'; bundle: Bundle; operation?: Operation; index: number; isChild?: boolean }> {
    // For token sorting: flat list of all operations, no hierarchical relationships
    const items: Array<{ type: 'bundle' | 'operation'; bundle: Bundle; operation?: Operation; index: number; isChild?: boolean }> = [];
    
    // Extract all individual operations from bundles
    const allOperations: Array<{ operation: Operation; bundle: Bundle }> = [];
    
    this.state.bundles.forEach(bundle => {
      bundle.operations.forEach(operation => {
        allOperations.push({ operation, bundle });
      });
    });
    
    // Sort by individual operation token value
    allOperations.sort((a, b) => {
      const aValue = getOperationTokens(a.operation);
      const bValue = getOperationTokens(b.operation);
      return this.state.sortAscending ? aValue - bValue : bValue - aValue;
    });
    
    // Convert back to display format - create synthetic single-operation bundles
    allOperations.forEach((item, index) => {
      // Create a synthetic bundle containing only this operation
      const syntheticBundle: Bundle = {
        id: item.bundle.id,
        timestamp: item.operation.timestamp,
        operations: [item.operation],
        totalTokens: item.operation.tokens
      };
      
      items.push({
        type: 'bundle',
        bundle: syntheticBundle,
        operation: item.operation,
        index: index,
        isChild: false
      });
    });
    
    return items;
  }

  private transformBundlesToListItems(): ListItem[] {
    const flatItems = this.state.sortMode === 'tokens' 
      ? this.getFlatOperations()
      : this.getFlatItems();
      
    const contextTotals = this.calculateContextTotals();
    const contextDeltas = this.calculateContextDeltas();
    
    return flatItems.map((item, index) => {
      const bundle = item.bundle;
      const op = item.operation || bundle.operations[0];
      const contextTotal = contextTotals.get(bundle.id) || 0;
      const contextDelta = contextDeltas.get(bundle.id) || 0;
      
      // Format context display
      let contextStr: string;
      if (index > 0) {
        const prevItem = flatItems[index - 1];
        const prevContextTotal = contextTotals.get(prevItem.bundle.id) || 0;
        contextStr = contextTotal === prevContextTotal ? '---,---' : contextTotal.toLocaleString('en-US', { 
          minimumIntegerDigits: 6, 
          useGrouping: true 
        });
      } else {
        contextStr = contextTotal.toLocaleString('en-US', { 
          minimumIntegerDigits: 6, 
          useGrouping: true 
        });
      }
      
      // Get icon and title
      const icon = this.getOperationIcon(op, bundle.isSubAgent);
      const toolDisplay = this.getToolDisplay(op, bundle.isSubAgent);
      const title = `${icon} ${toolDisplay}: ${op.details}`;
      
      // Get token metadata
      const metadata = this.getTokenMetadata(op, bundle, contextDelta);
      
      return {
        id: item.operation?.contentPartIndex !== undefined ? `${bundle.id}[${item.operation.contentPartIndex}]` : bundle.id,
        timestamp: item.operation?.timestamp || bundle.timestamp,
        icon,
        title,
        subtitle: contextStr,
        metadata,
        isChild: item.isChild,
        canExpand: !item.operation && bundle.operations.length > 1,
        isExpanded: this.state.expanded.has(bundle.id)
      };
    });
  }

  private getFlatItems(): Array<{ type: 'bundle' | 'operation'; bundle: Bundle; operation?: Operation; index: number; isChild?: boolean }> {
    const items: Array<{ type: 'bundle' | 'operation'; bundle: Bundle; operation?: Operation; index: number; isChild?: boolean }> = [];
    const sortedBundles = this.getSortedBundles();
    
    // Track which ToolResponse bundles have been shown as children
    const processedToolResponses = new Set<string>();
    
    sortedBundles.forEach((bundle, bundleIndex) => {
      const op = bundle.operations[0];
      
      // Skip ToolResponse bundles that should be shown as children
      if (op.tool === 'ToolResponse' && processedToolResponses.has(bundle.id)) {
        return;
      }
      
      // Skip System messages that have a tool_use_id (they'll show in detail view of related tool)
      if (op.tool === 'System' && op.tool_use_id) {
        return;
      }
      
      // Skip sub-agent bundles here - they'll be shown as children after their parent Task
      if (bundle.isSubAgent) {
        return;
      }
      
      items.push({ type: 'bundle', bundle, index: bundleIndex });
      
      // If this is an Assistant message with tool calls, find related ToolResponse bundles and sub-agents
      if (op.tool === 'Assistant' && op.response && Array.isArray(op.response)) {
        const toolUses = op.response.filter((c: any) => c.type === 'tool_use');
        
        if (toolUses.length > 0) {
          // Find ToolResponse bundles that match these tool_use_ids
          const relatedResponses: Bundle[] = [];
          const relatedSubAgents: Bundle[] = [];
          
          for (const toolUse of toolUses) {
            // Find regular tool response bundles (for all tool types including Task)
            const responseBundle = sortedBundles.find(b => {
              const responseOp = b.operations[0];
              return responseOp.tool === 'ToolResponse' && responseOp.tool_use_id === toolUse.id;
            });
            
            if (responseBundle) {
              relatedResponses.push(responseBundle);
              processedToolResponses.add(responseBundle.id);
            }
            
            // Also find sub-agent bundles for Task tools
            if (toolUse.name === 'Task') {
              const subAgentBundle = sortedBundles.find(b => 
                b.isSubAgent && b.parentTaskId === toolUse.id
              );
              if (subAgentBundle) {
                relatedSubAgents.push(subAgentBundle);
              }
            }
          }
          
          // Combine responses and sub-agents, then sort by timestamp for proper chronological order
          const allChildren: Bundle[] = [...relatedResponses, ...relatedSubAgents];
          allChildren
            .sort((a, b) => a.timestamp - b.timestamp)
            .forEach((childBundle, childIndex) => {
              items.push({ 
                type: 'bundle', 
                bundle: childBundle, 
                index: bundleIndex * 100 + childIndex + 1,
                isChild: true
              });
            });
        }
      }
      
      // Handle expanded view for multi-operation bundles
      if (this.state.expanded.has(bundle.id) && bundle.operations.length > 1) {
        bundle.operations.forEach((operation, opIndex) => {
          items.push({ 
            type: 'operation', 
            bundle, 
            operation, 
            index: bundleIndex * 1000 + opIndex,
            isChild: true
          });
        });
      }
    });
    
    return items;
  }

  private calculateContextTotals(): Map<string, number> {
    const contextTotals = new Map<string, number>();
    let runningTotal = 0;
    
    this.state.bundles.forEach(b => {
      const op = b.operations[0];
      if (op.usage && op.allocation === 'exact') {
        runningTotal = calculateCumulativeTotal(op.usage);
      }
      contextTotals.set(b.id, runningTotal);
    });
    
    return contextTotals;
  }

  private calculateContextDeltas(): Map<string, number> {
    const contextDeltas = new Map<string, number>();
    let previousTotal = 0;
    
    this.state.bundles.forEach(b => {
      const op = b.operations[0];
      let contextDelta = 0;
      
      if (op.usage && op.allocation === 'exact') {
        const currentTotal = calculateCumulativeTotal(op.usage);
        contextDelta = currentTotal - previousTotal;
        previousTotal = currentTotal;
      }
      
      contextDeltas.set(b.id, contextDelta);
    });
    
    return contextDeltas;
  }

  private getOperationIcon(op: Operation, isSubAgent?: boolean): string {
    if (isSubAgent) {
      return '🤖‍💻';
    }
    
    switch(op.tool) {
      case 'User': return '👤';
      case 'ToolResponse': return '📥';
      case 'Assistant': return '🤖';
      case 'Context': return '📊';
      case 'Read': return '📖';
      case 'Write': return '✏️';
      case 'Edit': return '📝';
      case 'Bash': return '💻';
      case 'LS': return '📁';
      case 'Glob': return '🔍';
      case 'Grep': return '🔎';
      default: return '⚙️';
    }
  }

  private getToolDisplay(op: Operation, isSubAgent?: boolean): string {
    if (isSubAgent) {
      return 'Sub-Agent';
    }
    
    return op.tool === 'Assistant' ? 'Main Agent' : op.tool;
  }

  private getTokenMetadata(op: Operation, bundle: Bundle, contextDelta: number): string {
    if (bundle.isSubAgent) {
      return '-';
    } else if (op.tool === 'ToolResponse') {
      const sizeKB = (op.responseSize / 1024).toFixed(1);
      const estimatedTokens = estimateTokensFromContent(op.responseSize);
      return `[${sizeKB}KB → ~${estimatedTokens.toLocaleString()} est]`;
    } else if (op.tool === 'User') {
      return `~${op.tokens} est`;
    } else if (contextDelta > 0) {
      if (this.state.sortMode === 'tokens') {
        if (op.generationCost > 0) {
          return `(${op.generationCost.toLocaleString()} out)`;
        } else {
          return `${op.tokens.toLocaleString()} tokens`;
        }
      } else {
        let result = `+${contextDelta.toLocaleString()} actual`;
        if (op.generationCost > 0) {
          result += ` (${op.generationCost.toLocaleString()} out)`;
        }
        return result;
      }
    } else if (op.generationCost > 0) {
      return `(${op.generationCost.toLocaleString()} out)`;
    } else {
      return `${op.tokens.toLocaleString()} tokens`;
    }
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
    
    if (this.state.viewingSubAgent) {
      // Use generic list view for sub-agent view
      const items = this.transformSubAgentOperationsToListItems(this.state.viewingSubAgent);
      const header = `SUB-AGENT: ${this.state.viewingSubAgent.operations[0].details || 'Sub-agent operations'} | ${this.state.viewingSubAgent.operations.length} Operations`;
      
      const listView: ListView = {
        header,
        items,
        selectedIndex: this.state.selectedIndex,
      };

      const actions: ListActions = {
        onSelect: (item, index) => this.handleSubAgentSelect(item, index),
        onBack: () => { 
          this.state.viewingSubAgent = null; 
          this.state.selectedIndex = 0; 
        },
        onQuit: () => { this.state.shouldExit = true; this.state.exitCode = 0; },
        onSelectionChange: (newIndex) => { this.state.selectedIndex = newIndex; }
      };

      if (!this.listView) {
        this.listView = new GenericListView(listView, actions);
      } else {
        this.listView.updateView(listView);
        this.listView.updateActions(actions);
      }

      this.listView.render();
      return;
    }

    // Use generic list view for main view
    const items = this.transformBundlesToListItems();
    const totalTokens = this.jsonlPath ? await getCurrentTokenCount(this.jsonlPath) : 0;
    
    // Pagination
    const itemsPerPage = 20;
    const currentPage = Math.floor(this.state.selectedIndex / itemsPerPage);
    const startIndex = currentPage * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, items.length);
    
    const sortDirection = this.state.sortAscending ? '↑' : '↓';
    const header = `Session: ${this.sessionId.slice(0, 8)} | Total: ${totalTokens.toLocaleString()} tokens | Sort: ${this.state.sortMode.toUpperCase()} ${sortDirection}`;
    
    const listView: ListView = {
      header,
      items,
      selectedIndex: this.state.selectedIndex,
      sortMode: this.state.sortMode,
      sortAscending: this.state.sortAscending,
      pagination: {
        currentPage: currentPage + 1,
        totalPages: Math.ceil(items.length / itemsPerPage),
        itemsPerPage,
        startIndex,
        endIndex
      }
    };

    const actions: ListActions = {
      onSelect: (item, index) => this.handleListSelect(item, index),
      onBack: () => { this.state.shouldExit = true; this.state.exitCode = 2; },
      onQuit: () => { this.state.shouldExit = true; this.state.exitCode = 0; },
      onToggleExpand: (item, index) => this.handleToggleExpand(item, index),
      onSelectionChange: (newIndex) => { this.state.selectedIndex = newIndex; }
    };

    if (!this.listView) {
      this.listView = new GenericListView(listView, actions);
    } else {
      this.listView.updateView(listView);
      this.listView.updateActions(actions);
    }

    this.listView.render();
  }

  private handleListSelect(item: ListItem, index: number): void {
    // Parse the item ID to extract message ID and optional content part
    const bracketMatch = item.id.match(/^([^[\]]+)(?:\[(\d+)\])?$/);
    if (!bracketMatch) return;
    
    const messageId = bracketMatch[1];
    const contentPart = bracketMatch[2] ? parseInt(bracketMatch[2], 10) : undefined;
    
    // Find the corresponding bundle(s)
    const bundle = this.state.bundles.find(b => b.id === messageId);
    if (!bundle) return;

    // Handle selection based on bundle type
    if (bundle.isSubAgent) {
      this.state.viewingSubAgent = bundle;
      this.state.selectedIndex = 0;
    } else if (bundle.operations.length === 1 && bundle.operations[0].tool === 'ToolResponse') {
      // Show linked operations for ToolResponse
      const toolResponseOp = bundle.operations[0];
      if (toolResponseOp.tool_use_id) {
        const linkedOps = getLinkedOperations(this.state.bundles, toolResponseOp.tool_use_id);
        const linkedBundle: Bundle = {
          id: `linked-${toolResponseOp.tool_use_id}`,
          timestamp: Math.min(...linkedOps.map(op => op.timestamp)),
          operations: linkedOps,
          totalTokens: linkedOps.reduce((sum, op) => sum + op.tokens, 0)
        };
        this.state.viewingDetails = linkedBundle;
      } else {
        this.state.viewingDetails = bundle;
      }
    } else if (contentPart !== undefined) {
      // Show specific content part - find the bundle with matching message ID and content part
      const targetBundle = this.state.bundles.find(b => 
        b.operations.some(op => op.message_id === messageId && op.contentPartIndex === contentPart)
      );
      
      if (targetBundle) {
        // Create synthetic bundle with just the specific content part operation
        const targetOp = targetBundle.operations.find(op => 
          op.message_id === messageId && op.contentPartIndex === contentPart
        );
        if (targetOp) {
          const syntheticBundle: Bundle = {
            id: `${messageId}[${contentPart}]`,
            timestamp: targetOp.timestamp,
            operations: [targetOp],
            totalTokens: targetOp.tokens
          };
          this.state.viewingDetails = syntheticBundle;
        } else {
          this.state.viewingDetails = targetBundle;
        }
      } else {
        this.state.viewingDetails = bundle;
      }
    } else {
      // Show whole message (all content parts) - need to find ALL bundles with this message ID
      const allBundlesForMessage = this.state.bundles.filter(b => 
        b.operations.some(op => op.message_id === messageId)
      );
      
      if (allBundlesForMessage.length > 1) {
        // Combine all operations from all bundles with this message ID
        const allOperations: Operation[] = [];
        allBundlesForMessage.forEach(b => {
          allOperations.push(...b.operations.filter(op => op.message_id === messageId));
        });
        
        // Sort by contentPartIndex to maintain proper order
        allOperations.sort((a, b) => {
          const aIndex = a.contentPartIndex ?? 0;
          const bIndex = b.contentPartIndex ?? 0;
          return aIndex - bIndex;
        });
        
        const combinedBundle: Bundle = {
          id: messageId,
          timestamp: Math.min(...allOperations.map(op => op.timestamp)),
          operations: allOperations,
          totalTokens: allOperations.reduce((sum, op) => sum + op.tokens, 0)
        };
        
        this.state.viewingDetails = combinedBundle;
      } else {
        this.state.viewingDetails = bundle;
      }
    }
    
    this.state.detailScrollOffset = 0;
  }

  private handleToggleExpand(item: ListItem, index: number): void {
    if (item.canExpand) {
      if (this.state.expanded.has(item.id)) {
        this.state.expanded.delete(item.id);
      } else {
        this.state.expanded.add(item.id);
      }
    }
  }

  private handleSubAgentSelect(item: ListItem, index: number): void {
    // For sub-agent view, show detail view for selected operation
    const subAgentBundle = this.state.viewingSubAgent!;
    const selectedOp = subAgentBundle.operations[index];
    
    // Create a single-operation bundle for detail view
    const detailBundle: Bundle = {
      id: `subagent-op-${selectedOp.timestamp}`,
      timestamp: selectedOp.timestamp,
      operations: [selectedOp],
      totalTokens: selectedOp.tokens
    };
    
    this.state.viewingDetails = detailBundle;
    this.state.detailScrollOffset = 0;
  }

  private transformSubAgentOperationsToListItems(subAgentBundle: Bundle): ListItem[] {
    let contextTotal = 0;
    
    return subAgentBundle.operations.map((op, index) => {
      // Calculate context growth for this operation
      let contextDelta = 0;
      if (op.usage && op.allocation === 'exact') {
        contextDelta = op.usage.cache_creation_input_tokens || 0;
      }
      
      // Format context display
      const contextStr = contextTotal > 0 
        ? `${(contextTotal / 1000).toFixed(0).padStart(3)},${(contextTotal % 1000).toString().padStart(3, '0')}`
        : '---,---';
      
      // Get icon and title (sub-agent context)
      const icon = this.getOperationIcon(op, true);
      const toolDisplay = this.getToolDisplay(op, true);
      const title = `${icon} ${toolDisplay}: ${op.details}`;
      
      // Get token metadata for sub-agent operations
      let metadata: string;
      if (op.tool === 'ToolResponse') {
        const sizeKB = (op.responseSize / 1024).toFixed(1);
        const estimatedTokens = estimateTokensFromContent(op.responseSize);
        metadata = `[${sizeKB}KB → ~${estimatedTokens.toLocaleString()} est]`;
      } else if (op.tool === 'User') {
        metadata = `~${op.tokens} est`;
      } else if (contextDelta > 0) {
        metadata = `+${contextDelta.toLocaleString()} actual`;
        if (op.generationCost && op.generationCost > 0) {
          metadata += ` (${op.generationCost.toLocaleString()} out)`;
        }
      } else if (op.generationCost && op.generationCost > 0) {
        metadata = `(${op.generationCost.toLocaleString()} out)`;
      } else {
        metadata = `~${op.tokens} est`;
      }
      
      // Update context for next operation
      if (op.usage && op.allocation === 'exact') {
        contextTotal += op.usage.cache_creation_input_tokens || 0;
      }
      
      return {
        id: `${subAgentBundle.id}-op-${index}`,
        timestamp: op.timestamp,
        icon,
        title,
        subtitle: contextStr,
        metadata,
        isChild: false,
        canExpand: false,
        isExpanded: false
      };
    });
  }

  private renderDetails(): void {
    const bundle = this.state.viewingDetails!;
    
    this.clearScreen();
    
    // Check if this is a sub-agent bundle
    const isSubAgentBundle = bundle.isSubAgent;
    const isLinkedBundle = bundle.id.startsWith('linked-');
    
    let headerTitle: string;
    if (isSubAgentBundle) {
      headerTitle = `SUB-AGENT DETAILS - ${bundle.operations.length} Operations`;
    } else if (isLinkedBundle) {
      headerTitle = `LINKED TOOL OPERATIONS - ${bundle.operations.length} Operations`;
    } else {
      headerTitle = `BUNDLE DETAILS - ${bundle.operations.length} Operations`;
    }
    
    console.log(`┌${'─'.repeat(78)}┐`);
    console.log(`│ ${headerTitle}`);
    console.log(`└${'─'.repeat(78)}┘\n`);
    
    console.log(`Bundle ID: ${bundle.id}`);
    console.log(`Session ID: ${this.sessionId}`);
    console.log(`Total Tokens: ${bundle.totalTokens.toLocaleString()}`);
    console.log(`Time: ${new Date(bundle.timestamp).toLocaleTimeString()}`);
    
    if (isSubAgentBundle) {
      console.log(`Sub-Agent Type: ${bundle.subAgentType || 'unknown'}`);
      console.log(`Parent Task ID: ${bundle.parentTaskId || 'unknown'}`);
      if (bundle.duration) {
        console.log(`Duration: ${(bundle.duration / 1000).toFixed(1)}s`);
      }
    } else if (isLinkedBundle) {
      const toolUseId = bundle.id.replace('linked-', '');
      console.log(`Tool Use ID: ${toolUseId}`);
    }
    
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
        allLines.push(`│ Timestamp: ${new Date(operation.timestamp).toLocaleString()}`);
        allLines.push(`│ Session ID: ${operation.session_id}`);
      } else if (operation.tool === 'ToolResponse') {
        allLines.push(`│ Size: ${(operation.responseSize / 1024).toFixed(1)}KB`);
        allLines.push(`│ Estimated Tokens: ~${operation.tokens.toLocaleString()}`);
        allLines.push(`│ Impact: This content will be processed in the next Assistant message`);
        allLines.push(`│ Timestamp: ${new Date(operation.timestamp).toLocaleString()}`);
        allLines.push(`│ Session ID: ${operation.session_id}`);
      } else if (operation.tool === 'User') {
        allLines.push(`│ Message Length: ${operation.responseSize} chars`);
        allLines.push(`│ Estimated Tokens: ~${operation.tokens.toLocaleString()}`);
        if (operation.timeGap && operation.timeGap > TIME_CONSTANTS.CACHE_EXPIRY_SECONDS) {
          allLines.push(`│ ⚠️ Time Gap: ${Math.round(operation.timeGap/60)} minutes (cache may expire)`);
        }
        allLines.push(`│ Timestamp: ${new Date(operation.timestamp).toLocaleString()}`);
        allLines.push(`│ Session ID: ${operation.session_id}`);
      } else {
        allLines.push(`│ Tokens: ${operation.tokens.toLocaleString()} (${operation.allocation})`);
        
        // Show operation metadata
        if (operation.message_id) {
          allLines.push(`│ Message ID: ${operation.message_id}`);
        }
        if (operation.contentPartIndex !== undefined) {
          allLines.push(`│ Content Part: ${operation.contentPartIndex} (showing only this part)`);
        }
        if (operation.sequence !== undefined) {
          allLines.push(`│ Sequence: ${operation.sequence}`);
        }
        allLines.push(`│ Timestamp: ${new Date(operation.timestamp).toLocaleString()}`);
        allLines.push(`│ Session ID: ${operation.session_id}`);
        
        // Show token breakdown
        if (operation.contextGrowth > 0 || operation.generationCost > 0) {
          allLines.push(`│ Breakdown:`);
          if (operation.contextGrowth > 0) {
            allLines.push(`│   Cache Creation: ${operation.contextGrowth.toLocaleString()} (from cache_creation_input_tokens)`);
          }
          if (operation.generationCost > 0) {
            allLines.push(`│   Generation Cost: ${operation.generationCost.toLocaleString()} (output tokens)`);
          }
        }
        
        // Show cache metrics
        if (operation.cacheEfficiency !== undefined) {
          allLines.push(`│ Cache Efficiency: ${operation.cacheEfficiency.toFixed(1)}%${operation.cacheEfficiency < 50 ? ' ⚠️ LOW' : ''}`);
        }
        
        if (operation.timeGap && operation.timeGap > TIME_CONSTANTS.CACHE_EXPIRY_SECONDS) {
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
      
      // Handle different response types properly
      let responseContent: string;
      if (typeof operation.response === 'string') {
        responseContent = operation.response;
      } else if (Array.isArray(operation.response)) {
        // If contentPartIndex is specified, show only that specific part
        if (operation.contentPartIndex !== undefined && operation.response[operation.contentPartIndex]) {
          const part = operation.response[operation.contentPartIndex];
          if (part.type === 'text') {
            responseContent = part.text;
          } else if (part.type === 'tool_use') {
            responseContent = `${part.name}: ${JSON.stringify(part.input, null, 2)}`;
          } else {
            responseContent = JSON.stringify(part, null, 2);
          }
        } else {
          // Show all parts (default behavior for operations without contentPartIndex)
          responseContent = operation.response.map((part: any) => {
            if (part.type === 'text') {
              return part.text;
            } else if (part.type === 'tool_use') {
              return `${part.name}: ${JSON.stringify(part.input, null, 2)}`;
            } else {
              return JSON.stringify(part, null, 2);
            }
          }).join('\n');
        }
      } else {
        responseContent = JSON.stringify(operation.response, null, 2);
      }
      
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



  private async mainLoop(): Promise<void> {
    while (!this.state.shouldExit) {
      await new Promise<void>((resolve) => {
        const handleKey = async (key: Buffer) => {
          const keyStr = key.toString();
          
          if (this.state.viewingDetails) {
            this.handleDetailsKeys(keyStr);
          } else {
            // Both main view and sub-agent view use generic list component now
            // Handle sort keys for main view, then delegate to generic component
            if (!this.state.viewingSubAgent) {
              this.handleMainKeys(keyStr);
            } else {
              // For sub-agent view, delegate directly to generic list component
              if (this.listView) {
                this.listView.handleKey(keyStr);
              }
            }
          }
          
          if (!this.state.shouldExit) {
            await this.render();
          }
          
          process.stdin.off('data', handleKey);
          resolve();
        };
        
        process.stdin.on('data', handleKey);
      });
    }
    
    this.cleanup();
  }

  private setupKeyHandlers(): void {
    // This method is now empty since mainLoop handles key processing
  }

  private handleMainKeys(key: string): void {
    // Handle sort keys first
    switch (key) {
      case 't':
        if (this.state.sortMode === 'tokens') {
          this.state.sortAscending = !this.state.sortAscending;
        } else {
          this.state.sortMode = 'tokens';
          this.state.sortAscending = false; // Default to descending for tokens (high to low)
        }
        this.state.selectedIndex = 0;
        return;
      case 'c':
        if (this.state.sortMode === 'conversation') {
          this.state.sortAscending = !this.state.sortAscending;
        } else {
          this.state.sortMode = 'conversation';
          this.state.sortAscending = true; // Default to ascending for conversation (chronological flow)
        }
        this.state.selectedIndex = 0;
        return;
      case 'o':
        if (this.state.sortMode === 'operation') {
          this.state.sortAscending = !this.state.sortAscending;
        } else {
          this.state.sortMode = 'operation';
          this.state.sortAscending = true; // Default to ascending for operation (A-Z)
        }
        this.state.selectedIndex = 0;
        return;
    }

    // Let generic list view handle other keys
    if (this.listView) {
      this.listView.handleKey(key);
    }
  }

  private handleDetailsKeys(key: string): void {
    switch (key) {
      case '\u001b': // ESC
        // Check if we came from a sub-agent view
        if (this.state.viewingDetails?.id.startsWith('subagent-op-') && this.state.viewingSubAgent) {
          // Go back to sub-agent list view, not main view
          this.state.viewingDetails = null;
          this.state.detailScrollOffset = 0;
        } else {
          // Normal detail view, go back to main view
          this.state.viewingDetails = null;
          this.state.detailScrollOffset = 0;
        }
        break;
      case '\u001b[A': // Up arrow
        this.state.detailScrollOffset = Math.max(0, this.state.detailScrollOffset - 1);
        break;
      case '\u001b[B': // Down arrow
        this.state.detailScrollOffset = this.state.detailScrollOffset + 1;
        break;
      case 'q':
      case '\u0003': // Ctrl+C
        this.state.shouldExit = true;
        this.state.exitCode = 0;
        break;
    }
  }


  private async waitForKey(): Promise<void> {
    return new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }


  private goToDirectDetailView(): void {
    // Find the bundle that matches the direct message ID
    const targetBundle = this.state.bundles.find(bundle => 
      bundle.operations.some(op => op.message_id === this.directMessageId)
    );
    
    if (!targetBundle) {
      console.error(`❌ Message ID ${this.directMessageId} not found in session`);
      this.state.shouldExit = true;
      this.state.exitCode = 1;
      return;
    }
    
    // If contentPart is specified, find the specific bundle with that content part
    if (this.directContentPart !== undefined) {
      // Find the bundle that contains the specific content part
      const targetBundleWithPart = this.state.bundles.find(b => 
        b.operations.some(op => 
          op.message_id === this.directMessageId && op.contentPartIndex === this.directContentPart
        )
      );
      
      if (!targetBundleWithPart) {
        console.error(`❌ Content part ${this.directContentPart} not found for message ID ${this.directMessageId}`);
        this.state.shouldExit = true;
        this.state.exitCode = 1;
        return;
      }
      
      // Find the specific operation within that bundle
      const targetOp = targetBundleWithPart.operations.find(op => 
        op.message_id === this.directMessageId && op.contentPartIndex === this.directContentPart
      );
      
      if (!targetOp) {
        console.error(`❌ Operation not found for content part ${this.directContentPart}`);
        this.state.shouldExit = true;
        this.state.exitCode = 1;
        return;
      }
      
      // Create synthetic bundle with just this operation
      const syntheticBundle: Bundle = {
        id: `${this.directMessageId}[${this.directContentPart}]`,
        timestamp: targetOp.timestamp,
        operations: [targetOp],
        totalTokens: targetOp.tokens
      };
      
      this.state.viewingDetails = syntheticBundle;
    } else {
      // No content part specified - show whole message (all parts from all bundles)
      const allBundlesForMessage = this.state.bundles.filter(b => 
        b.operations.some(op => op.message_id === this.directMessageId)
      );
      
      if (allBundlesForMessage.length > 1) {
        // Combine all operations from all bundles with this message ID
        const allOperations: Operation[] = [];
        allBundlesForMessage.forEach(b => {
          allOperations.push(...b.operations.filter(op => op.message_id === this.directMessageId));
        });
        
        // Sort by contentPartIndex to maintain proper order
        allOperations.sort((a, b) => {
          const aIndex = a.contentPartIndex ?? 0;
          const bIndex = b.contentPartIndex ?? 0;
          return aIndex - bIndex;
        });
        
        const combinedBundle: Bundle = {
          id: this.directMessageId!,
          timestamp: Math.min(...allOperations.map(op => op.timestamp)),
          operations: allOperations,
          totalTokens: allOperations.reduce((sum, op) => sum + op.tokens, 0)
        };
        
        this.state.viewingDetails = combinedBundle;
      } else {
        this.state.viewingDetails = targetBundle;
      }
    }
    
    this.state.detailScrollOffset = 0;
  }

  private cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    this.rl.close();
    console.clear();
  }

  getExitCode(): number {
    return this.state.exitCode;
  }
}

export async function launchTUI(sessionId: string, jsonlPath?: string, messageId?: string, contentPart?: number): Promise<number> {
  const analyzer = new TokenAnalyzer(sessionId, jsonlPath, messageId, contentPart);
  await analyzer.initialize();
  return analyzer.getExitCode();
}