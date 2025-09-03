import {
  getOperationTokens,
  getOperationIcon, 
  getToolDisplay,
  getTokenMetadata,
  formatContextDisplay,
  getSortedBundles,
  calculateContextTotals,
  calculateContextDeltas
} from '../../lib/view-utils';
import type { Bundle, Operation, ListItem, TerminalState } from '../../types';

interface FlatItem {
  type: 'bundle' | 'operation';
  bundle: Bundle;
  operation?: Operation;
  index: number;
  isChild?: boolean;
}

export function getFlatOperationsForTokenSort({ bundles, sortAscending }: {
  bundles: Bundle[];
  sortAscending: boolean;
}): FlatItem[] {
  const items: FlatItem[] = [];
  
  const allOperations: Array<{ operation: Operation; bundle: Bundle }> = [];
  
  bundles.forEach(bundle => {
    bundle.operations.forEach(operation => {
      allOperations.push({ operation, bundle });
    });
  });
  
  allOperations.sort((a, b) => {
    const aValue = getOperationTokens({ op: a.operation });
    const bValue = getOperationTokens({ op: b.operation });
    return sortAscending ? aValue - bValue : bValue - aValue;
  });
  
  allOperations.forEach((item, index) => {
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

export function getFlatItemsForRegularSort({ sortedBundles, expanded }: {
  sortedBundles: Bundle[];
  expanded: Set<string>;
}): FlatItem[] {
  const items: FlatItem[] = [];
  const processedToolResponses = new Set<string>();
  
  sortedBundles.forEach((bundle, bundleIndex) => {
    const op = bundle.operations[0];
    
    if (op.tool === 'ToolResponse' && processedToolResponses.has(bundle.id)) {
      return;
    }
    
    if (op.tool === 'System' && op.tool_use_id) {
      return;
    }
    
    // Skip sub-agent bundles at top level - they'll be included as children
    if (bundle.isSubAgent) {
      return;
    }
    
    items.push({ type: 'bundle', bundle, index: bundleIndex });
    
    if (op.tool === 'Assistant' && op.response && Array.isArray(op.response)) {
      const toolUses = op.response.filter((c: any) => c.type === 'tool_use');
      
      if (toolUses.length > 0) {
        const relatedResponses: Bundle[] = [];
        const relatedSubAgents: Bundle[] = [];
        
        for (const toolUse of toolUses) {
          if (toolUse.name === 'Task') {
            // Find sub-agent bundle for this Task
            const subAgentBundle = sortedBundles.find(b => 
              b.isSubAgent && b.parentTaskId === toolUse.id
            );
            if (subAgentBundle) {
              relatedSubAgents.push(subAgentBundle);
            }
          }
          
          // Find response bundle for this tool use
          const responseBundle = sortedBundles.find(b => {
            const responseOp = b.operations[0];
            return responseOp.tool === 'ToolResponse' && responseOp.tool_use_id === toolUse.id;
          });
          
          if (responseBundle) {
            relatedResponses.push(responseBundle);
            processedToolResponses.add(responseBundle.id);
          }
        }
        
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
    
    if (expanded.has(bundle.id) && bundle.operations.length > 1) {
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

export function transformBundlesToListItems({ state }: { state: TerminalState }): ListItem[] {
  const flatItems = state.sortMode === 'tokens' 
    ? getFlatOperationsForTokenSort({ bundles: state.bundles, sortAscending: state.sortAscending })
    : getFlatItemsForRegularSort({ 
        sortedBundles: getSortedBundles({ 
          bundles: state.bundles, 
          sortMode: state.sortMode, 
          sortAscending: state.sortAscending 
        }),
        expanded: state.expanded 
      });
      
  const contextTotals = calculateContextTotals({ bundles: state.bundles });
  const contextDeltas = calculateContextDeltas({ bundles: state.bundles });
  
  return flatItems.map((item, index) => {
    const bundle = item.bundle;
    const op = item.operation || bundle.operations[0];
    const contextTotal = contextTotals.get(bundle.id) || 0;
    const contextDelta = contextDeltas.get(bundle.id) || 0;
    
    const contextStr = formatContextDisplay({
      contextTotal,
      prevContextTotal: index > 0 ? contextTotals.get(flatItems[index - 1].bundle.id) : undefined,
      isFirstItem: index === 0
    });
    
    const icon = getOperationIcon({ op, isSubAgent: bundle.isSubAgent });
    const toolDisplay = getToolDisplay({ op, isSubAgent: bundle.isSubAgent });
    const title = `${icon} ${toolDisplay}: ${op.details}`;
    
    const metadata = getTokenMetadata({ op, bundle, contextDelta, sortMode: state.sortMode });
    
    return {
      id: item.operation?.contentPartIndex !== undefined 
        ? `${bundle.id}[${item.operation.contentPartIndex}]` 
        : bundle.id,
      timestamp: item.operation?.timestamp || bundle.timestamp,
      icon,
      title,
      subtitle: contextStr,
      metadata,
      isChild: item.isChild,
      canExpand: !item.operation && bundle.operations.length > 1,
      isExpanded: state.expanded.has(bundle.id)
    };
  });
}