import { SessionState } from '../../lib/session-state';
import { getLinkedOperations } from '../../lib/correlation-engine';
import type { Bundle, ListItem, Operation } from '../../types';

// Bundle building parameter types following standards
export interface BuildDetailBundleParams {
  item: ListItem;
  bundle: Bundle;
  sessionState: SessionState;
}

export interface BuildLinkedBundleParams {
  bundle: Bundle;
  bundles: Bundle[];
}

export interface BuildContentPartBundleParams {
  messageId: string;
  contentPart: number;
  bundles: Bundle[];
}

export interface BuildFullMessageBundleParams {
  messageId: string;
  bundles: Bundle[];
}

/**
 * Build detail bundle from list item with proper content handling
 */
export function buildDetailBundleFromItem({
  item,
  bundle,
  sessionState
}: BuildDetailBundleParams): Bundle {
  const state = sessionState.getState();
  const bracketMatch = item.id.match(/^([^[\]]+)(?:\[(\d+)\])?$/);
  if (!bracketMatch) return bundle;
  
  const messageId = bracketMatch[1];
  const contentPart = bracketMatch[2] ? parseInt(bracketMatch[2], 10) : undefined;

  if (bundle.operations.length === 1 && bundle.operations[0].tool === 'ToolResponse') {
    return buildLinkedOperationsBundle({ bundle, bundles: state.bundles });
  } else if (contentPart !== undefined) {
    return buildContentPartBundle({ messageId, contentPart, bundles: state.bundles });
  } else {
    return buildFullMessageBundle({ messageId, bundles: state.bundles });
  }
}

/**
 * Build linked operations bundle for tool responses
 */
export function buildLinkedOperationsBundle({
  bundle,
  bundles
}: BuildLinkedBundleParams): Bundle {
  const toolResponseOp = bundle.operations[0];
  
  if (toolResponseOp.tool_use_id) {
    const linkedOps = getLinkedOperations(bundles, toolResponseOp.tool_use_id);
    return {
      id: `linked-${toolResponseOp.tool_use_id}`,
      timestamp: Math.min(...linkedOps.map(op => op.timestamp)),
      operations: linkedOps,
      totalTokens: linkedOps.reduce((sum, op) => sum + op.tokens, 0)
    };
  }
  return bundle;
}

/**
 * Build bundle for specific content part of a message
 */
export function buildContentPartBundle({
  messageId,
  contentPart,
  bundles
}: BuildContentPartBundleParams): Bundle {
  const targetBundle = bundles.find((b: Bundle) => 
    b.operations.some(op => op.message_id === messageId && op.contentPartIndex === contentPart)
  );
  
  if (targetBundle) {
    const targetOp = targetBundle.operations.find((op: Operation) => 
      op.message_id === messageId && op.contentPartIndex === contentPart
    );
    if (targetOp) {
      return {
        id: `${messageId}[${contentPart}]`,
        timestamp: targetOp.timestamp,
        operations: [targetOp],
        totalTokens: targetOp.tokens
      };
    }
  }
  
  return targetBundle || bundles.find((b: Bundle) => b.id === messageId) || bundles[0];
}

/**
 * Build bundle combining all operations for a message
 */
export function buildFullMessageBundle({
  messageId,
  bundles
}: BuildFullMessageBundleParams): Bundle {
  const allBundlesForMessage = bundles.filter((b: Bundle) => 
    b.operations.some(op => op.message_id === messageId)
  );
  
  if (allBundlesForMessage.length > 1) {
    const allOperations: Operation[] = [];
    allBundlesForMessage.forEach((b: Bundle) => {
      allOperations.push(...b.operations.filter(op => op.message_id === messageId));
    });
    
    allOperations.sort((a, b) => {
      const aIndex = a.contentPartIndex ?? 0;
      const bIndex = b.contentPartIndex ?? 0;
      return aIndex - bIndex;
    });
    
    return {
      id: messageId,
      timestamp: Math.min(...allOperations.map(op => op.timestamp)),
      operations: allOperations,
      totalTokens: allOperations.reduce((sum, op) => sum + op.tokens, 0)
    };
  } else {
    return allBundlesForMessage[0] || bundles[0];
  }
}