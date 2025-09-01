import type { Operation, Bundle } from '../types';
import { formatOperationDetails } from './operation-factory';

export function getLinkedOperations(bundles: Bundle[], targetToolUseId: string): Operation[] {
  const linked: Operation[] = [];
  
  for (const bundle of bundles) {
    for (const op of bundle.operations) {
      // Find assistant messages that contain this tool_use_id
      if (op.tool === 'Assistant' && op.response) {
        const messageContent = Array.isArray(op.response) ? op.response : [];
        const hasTargetToolUse = messageContent.some((c: any) => 
          c.type === 'tool_use' && c.id === targetToolUseId
        );
        if (hasTargetToolUse) {
          linked.push(op);
        }
      }
      
      // Find tool responses and system messages with matching tool_use_id
      if (op.tool_use_id === targetToolUseId) {
        linked.push(op);
      }
    }
  }
  
  return linked.sort((a, b) => a.timestamp - b.timestamp);
}

export function enrichToolResponseDetails(finalBundles: Bundle[]): void {
  for (const bundle of finalBundles) {
    for (const op of bundle.operations) {
      if (op.tool === 'ToolResponse' && op.tool_use_id) {
        const linkedOps = getLinkedOperations(finalBundles, op.tool_use_id);
        const assistantOp = linkedOps.find(linkedOp => linkedOp.tool === 'Assistant');
        
        if (assistantOp && assistantOp.response && Array.isArray(assistantOp.response)) {
          const toolUse = assistantOp.response.find((c: any) => 
            c.type === 'tool_use' && c.id === op.tool_use_id
          );
          
          if (toolUse) {
            op.details = formatOperationDetails(toolUse.name, toolUse.input);
          }
        }
      }
    }
  }
}