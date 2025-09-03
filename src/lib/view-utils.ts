import { calculateCumulativeTotal, estimateTokensFromContent } from './token-calculator';
import type { Bundle, Operation, SortMode } from '../types';

export function getOperationTokens({ op }: { op: Operation }): number {
  if (op.tool === 'ToolResponse') {
    return estimateTokensFromContent(op.responseSize);
  } else if (op.tool === 'Assistant' && op.generationCost > 0) {
    return op.generationCost;
  } else {
    return op.tokens || 0;
  }
}

export function getOperationIcon({ op, isSubAgent }: { op: Operation; isSubAgent?: boolean }): string {
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

export function getToolDisplay({ op, isSubAgent }: { op: Operation; isSubAgent?: boolean }): string {
  if (isSubAgent) {
    return 'Sub-Agent';
  }
  
  return op.tool === 'Assistant' ? 'Main Agent' : op.tool;
}

export function getTokenMetadata({
  op,
  bundle,
  contextDelta,
  sortMode
}: {
  op: Operation;
  bundle: Bundle;
  contextDelta: number;
  sortMode?: SortMode;
}): string {
  if (bundle.isSubAgent) {
    return '-';
  } else if (op.tool === 'ToolResponse') {
    const sizeKB = (op.responseSize / 1024).toFixed(1);
    const estimatedTokens = estimateTokensFromContent(op.responseSize);
    return `[${sizeKB}KB → ~${estimatedTokens.toLocaleString()} est]`;
  } else if (op.tool === 'User') {
    return `~${op.tokens} est`;
  } else if (contextDelta > 0) {
    if (sortMode === 'tokens') {
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

export function formatContextDisplay({
  contextTotal,
  prevContextTotal,
  isFirstItem
}: {
  contextTotal: number;
  prevContextTotal?: number;
  isFirstItem: boolean;
}): string {
  if (!isFirstItem && prevContextTotal !== undefined) {
    return contextTotal === prevContextTotal ? '---,---' : contextTotal.toLocaleString('en-US', { 
      minimumIntegerDigits: 6, 
      useGrouping: true 
    });
  } else {
    return contextTotal.toLocaleString('en-US', { 
      minimumIntegerDigits: 6, 
      useGrouping: true 
    });
  }
}

export function formatSubAgentContextDisplay({ contextTotal }: { contextTotal: number }): string {
  return contextTotal > 0 
    ? `${(contextTotal / 1000).toFixed(0).padStart(3)},${(contextTotal % 1000).toString().padStart(3, '0')}`
    : '---,---';
}

export function getSortedBundles({ bundles, sortMode, sortAscending }: {
  bundles: Bundle[];
  sortMode: SortMode;
  sortAscending: boolean;
}): Bundle[] {
  return [...bundles].sort((a, b) => {
    let result: number;
    
    switch (sortMode) {
      case 'tokens':
        const aOp = a.operations[0];
        const bOp = b.operations[0];
        
        const aValue = getOperationTokens({ op: aOp });
        const bValue = getOperationTokens({ op: bOp });
        
        result = aValue - bValue;
        break;
      case 'operation':
        const aOpTool = a.operations[0]?.tool || '';
        const bOpTool = b.operations[0]?.tool || '';
        result = aOpTool.localeCompare(bOpTool);
        break;
      case 'conversation':
        const aOriginalIndex = bundles.findIndex(bundle => bundle.id === a.id);
        const bOriginalIndex = bundles.findIndex(bundle => bundle.id === b.id);
        result = aOriginalIndex - bOriginalIndex;
        break;
      default:
        return 0;
    }
    
    return sortAscending ? result : -result;
  });
}

export function calculateContextTotals({ bundles }: { bundles: Bundle[] }): Map<string, number> {
  const contextTotals = new Map<string, number>();
  let runningTotal = 0;
  
  bundles.forEach(b => {
    const op = b.operations[0];
    if (op.usage && op.allocation === 'exact') {
      runningTotal = calculateCumulativeTotal(op.usage);
    }
    contextTotals.set(b.id, runningTotal);
  });
  
  return contextTotals;
}

export function calculateContextDeltas({ bundles }: { bundles: Bundle[] }): Map<string, number> {
  const contextDeltas = new Map<string, number>();
  let previousTotal = 0;
  
  bundles.forEach(b => {
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