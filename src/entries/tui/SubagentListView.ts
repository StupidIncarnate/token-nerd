import {
  getOperationTokens,
  getOperationIcon,
  getToolDisplay,
  formatSubAgentContextDisplay
} from '../../lib/view-utils';
import type { Bundle, ListItem } from '../../types';

export function transformSubAgentOperationsToListItems({ subAgentBundle }: {
  subAgentBundle: Bundle;
}): ListItem[] {
  let contextTotal = 0;
  
  return subAgentBundle.operations.map((op, index) => {
    let contextDelta = 0;
    if (op.usage && op.allocation === 'exact') {
      contextDelta = op.usage.cache_creation_input_tokens || 0;
    }
    
    const contextStr = formatSubAgentContextDisplay({ contextTotal });
    
    const icon = getOperationIcon({ op, isSubAgent: true });
    const toolDisplay = getToolDisplay({ op, isSubAgent: true });
    const title = `${icon} ${toolDisplay}: ${op.details}`;
    
    let metadata: string;
    if (op.tool === 'ToolResponse') {
      const sizeKB = (op.responseSize / 1024).toFixed(1);
      const estimatedTokens = getOperationTokens({ op });
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