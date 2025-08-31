import { parseJsonl, JsonlMessage } from './jsonl-utils';
import { processMessage } from './message-parser';
import { 
  createSystemOperation,
  createUserOperation,
  createToolResponseOperation,
  createAssistantOperation
} from './operation-factory';
import { processSubAgents } from './sub-agent-processor';
import { enrichToolResponseDetails } from './correlation-utils';
export { JsonlMessage };

export interface Operation {
  tool: string;
  params: any;
  response: any;
  responseSize: number;
  timestamp: number;
  session_id: string;
  message_id?: string;
  sequence?: number;
  tool_use_id?: string;  // Links tool requests to responses
  contentPartIndex?: number; // For multi-part messages, which part this represents
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    total_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
  tokens: number;  // Primary metric for display (context growth)
  generationCost: number;  // Output tokens (what was generated)
  contextGrowth: number;  // Cache creation tokens (new context added)
  ephemeral5m?: number;  // 5-minute cache tokens
  ephemeral1h?: number;  // 1-hour cache tokens
  cacheEfficiency?: number;  // Percentage of cache reuse
  timeGap?: number;  // Seconds since last message
  allocation: 'exact' | 'proportional' | 'estimated';
  details: string;
  // Sub-agent support
  isSidechain?: boolean;  // True if this is part of a sub-agent execution
  subAgentId?: string;    // Unique identifier for the sub-agent session
  subAgentType?: string;  // Type of sub-agent (e.g., 'general-purpose')
  parentTaskId?: string;  // Tool use ID of the parent Task operation
}

export interface Bundle {
  id: string;
  timestamp: number;
  operations: Operation[];
  totalTokens: number;
  // Sub-agent support
  isSubAgent?: boolean;     // True if this bundle represents a sub-agent
  subAgentType?: string;    // Type of sub-agent
  parentTaskId?: string;    // Tool use ID of the parent Task operation
  operationCount?: number;  // Number of operations in sub-agent
  duration?: number;        // Duration in milliseconds
}

export async function correlateOperations(sessionId: string, jsonlPath?: string): Promise<Bundle[]> {
  // Get ALL messages from JSONL (including user messages)
  const allMessages = jsonlPath ? parseJsonl(jsonlPath) : [];
  
  if (allMessages.length === 0) {
    return [];
  }
  
  // Process ALL messages to understand the full conversation flow
  const bundles: Bundle[] = [];
  const processedMessageIds = new Set<string>();  // Track processed message IDs to avoid duplicates
  const messageContentPartIndex = new Map<string, number>(); // Track content part index for multi-part messages

  let lastTimestamp = 0;
  
  for (const msg of allMessages) {
    const timeGap = lastTimestamp ? (msg.timestamp - lastTimestamp) / 1000 : 0;
    lastTimestamp = msg.timestamp;
    
    const bundle = processMessage(
      msg, 
      sessionId, 
      timeGap, 
      processedMessageIds, 
      messageContentPartIndex,
      createSystemOperation,
      createUserOperation,
      createToolResponseOperation,
      createAssistantOperation
    );
    if (bundle) {
      bundles.push(bundle);
    }
  }
  
  const sidechainBundles = bundles.filter(b => b.operations[0].isSidechain);
  const mainBundles = bundles.filter(b => !b.operations[0].isSidechain);
  
  const subAgentBundles = processSubAgents(mainBundles, sidechainBundles, allMessages);
  
  const finalBundles: Bundle[] = [...mainBundles];
  
  for (let i = 0; i < finalBundles.length; i++) {
    const bundle = finalBundles[i];
    const op = bundle.operations[0];
    
    if (op.tool === 'Assistant' && op.response && Array.isArray(op.response)) {
      const taskUses = op.response.filter((c: any) => c.type === 'tool_use' && c.name === 'Task');
      
      let insertIndex = i + 1;
      for (const taskUse of taskUses) {
        const subAgentBundle = subAgentBundles.find(b => b.parentTaskId === taskUse.id);
        if (subAgentBundle) {
          finalBundles.splice(insertIndex, 0, subAgentBundle);
          insertIndex++;
          i++;
        }
      }
    }
  }
  
  enrichToolResponseDetails(finalBundles);
  
  return finalBundles.sort((a, b) => a.timestamp - b.timestamp);
}

// Re-export for backward compatibility
export { getLinkedOperations } from './correlation-utils';