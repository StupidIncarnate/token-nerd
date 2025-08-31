import * as path from 'path';
import { parseJsonl, JsonlMessage } from './jsonl-utils';
import { estimateTokensFromContent } from './token-calculator';
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

function formatOperationDetails(tool: string, params: any): string {
  switch (tool.toLowerCase()) {
    case 'read':
      return params?.file_path ? path.basename(params.file_path) : 'file';
    case 'write':
      return params?.file_path ? path.basename(params.file_path) : 'file';
    case 'edit':
      return params?.file_path ? path.basename(params.file_path) : 'file';
    case 'bash':
      const cmd = params?.command || '';
      return cmd.length > 30 ? cmd.substring(0, 30) + '...' : cmd;
    case 'glob':
      return params?.pattern || 'pattern';
    case 'grep':
      return params?.pattern || 'pattern';
    default:
      return tool;
  }
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
    const isUser = msg.content?.type === 'user' || msg.content?.message?.role === 'user';
    const isAssistant = msg.content?.type === 'assistant' || msg.content?.message?.role === 'assistant';
    const isSystem = msg.content?.type === 'system' || msg.content?.message?.role === 'system';
    const isToolResult = isUser && msg.content?.message?.content?.[0]?.type === 'tool_result';
    
    // Calculate time gap
    const timeGap = lastTimestamp ? (msg.timestamp - lastTimestamp) / 1000 : 0;
    lastTimestamp = msg.timestamp;
    
    if (isSystem) {
      // System message - often contains hidden prompts
      // Extract toolUseID if present
      let toolUseId: string | undefined;
      if (msg.content && typeof msg.content === 'object' && msg.content.toolUseID) {
        toolUseId = msg.content.toolUseID;
      }
      
      const systemOp: Operation = {
        tool: 'System',
        params: {},
        response: msg.content || 'System prompt',
        responseSize: JSON.stringify(msg.content).length,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        tool_use_id: toolUseId,
        tokens: estimateTokensFromContent(JSON.stringify(msg.content)),
        generationCost: 0,
        contextGrowth: 0,
        timeGap,
        allocation: 'estimated',
        details: 'Hidden system prompt/context',
        // Sub-agent support
        isSidechain: msg.isSidechain || false
      };
      
      bundles.push({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [systemOp],
        totalTokens: systemOp.tokens
      });
    } else if (isUser && !isToolResult) {
      // User message - create an entry for it
      const userText = typeof msg.content?.message?.content === 'string' 
        ? msg.content.message.content 
        : msg.content?.message?.content?.[0]?.text || 'User message';
        
      const userOp: Operation = {
        tool: 'User',
        params: {},
        response: userText,
        responseSize: userText.length,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        tokens: estimateTokensFromContent(userText), // Rough estimate
        generationCost: 0,
        contextGrowth: 0, // Will be counted in next assistant message
        timeGap,
        allocation: 'estimated',
        details: userText.replace(/\s+/g, ' ').substring(0, 50) + (userText.length > 50 ? '...' : ''),
        // Sub-agent support
        isSidechain: msg.isSidechain || false
      };
      
      bundles.push({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [userOp],
        totalTokens: userOp.tokens
      });
    } else if (isToolResult) {
      // Tool response - THIS is often the hidden context gorger!
      const toolResult = msg.content?.message?.content?.[0];
      
      // Calculate actual response size - toolResult.content might be a string or array
      let resultSize = 0;
      if (toolResult?.content) {
        if (typeof toolResult.content === 'string') {
          resultSize = toolResult.content.length;
        } else {
          // If it's an array or object, stringify it to get the full size
          resultSize = JSON.stringify(toolResult.content).length;
        }
      }
      
      const estimatedTokens = estimateTokensFromContent(resultSize);
      
      const toolResponseOp: Operation = {
        tool: 'ToolResponse',
        params: { tool_use_id: toolResult?.tool_use_id },
        response: toolResult?.content || '',
        responseSize: resultSize,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        tool_use_id: toolResult?.tool_use_id,
        tokens: estimatedTokens,
        generationCost: 0,
        contextGrowth: 0,  // Don't count estimated values in context growth
        allocation: 'estimated',
        details: `${(resultSize / 1024).toFixed(1)}KB → ~${estimatedTokens.toLocaleString()} est`,
        // Sub-agent support
        isSidechain: msg.isSidechain || false
      };
      
      bundles.push({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [toolResponseOp],
        totalTokens: estimatedTokens
      });
    } else if (isAssistant && msg.usage) {
      // Create unique key combining message ID and content hash for deduplication
      const msgContent = msg.content?.message?.content;
      const contentKey = msg.id + '-' + JSON.stringify(msgContent || '').substring(0, 50);
      
      // Skip only true duplicates (same ID and same content)
      if (processedMessageIds.has(contentKey)) {
        continue;
      }
      processedMessageIds.add(contentKey);
      
      // Assistant message - process with all metrics
      const contextGrowth = msg.usage?.cache_creation_input_tokens || 0;
      const generationCost = msg.usage?.output_tokens || 0;
      const cacheRead = msg.usage?.cache_read_input_tokens || 0;
      const messageTokens = contextGrowth || generationCost;
      
      // Calculate cache efficiency
      const totalProcessed = contextGrowth + cacheRead;
      const cacheEfficiency = totalProcessed > 0 ? (cacheRead / totalProcessed) * 100 : 0;
      
      // Extract ephemeral cache data
      const ephemeral5m = msg.usage?.cache_creation?.ephemeral_5m_input_tokens || 0;
      const ephemeral1h = msg.usage?.cache_creation?.ephemeral_1h_input_tokens || 0;
      
      const messageContent = msg.content?.message?.content;
      const hasToolUse = Array.isArray(messageContent) && messageContent.some((c: any) => c.type === 'tool_use');
      
      // Add warning to details if cache expired
      let details = 'message';
      if (timeGap > 300) { // 5 minutes
        details = `⚠️ Cache expired (${Math.round(timeGap/60)}min gap)`;
      }
      
      // Create operation for this assistant message
      let tool = 'Assistant';
      let params = {};
      
      if (hasToolUse) {
        const toolUses = messageContent.filter((c: any) => c.type === 'tool_use');
        if (toolUses.length === 1) {
          // Single tool call
          const toolUse = toolUses[0];
          const toolName = toolUse.name || 'Unknown';
          params = toolUse.input || {};
          const toolDetails = formatOperationDetails(toolName, params);
          details = `${toolName}: ${toolDetails}`;
          if (timeGap > 300) {
            details = `⚠️ ${details} (cache expired)`;
          }
        } else {
          // Multiple tool calls
          details = `${toolUses.length} tool calls`;
          if (timeGap > 300) {
            details = `⚠️ ${details} (cache expired)`;
          }
        }
      }
      
      // For multi-part messages, determine which content part this represents
      let contentPartIndex: number | undefined;
      if (messageContent && Array.isArray(messageContent) && messageContent.length === 1) {
        // This message contains exactly one content part - track the order for this message ID
        const messageId = msg.id;
        if (!messageContentPartIndex.has(messageId)) {
          messageContentPartIndex.set(messageId, 0);
          contentPartIndex = 0;
        } else {
          const currentIndex = messageContentPartIndex.get(messageId)! + 1;
          messageContentPartIndex.set(messageId, currentIndex);
          contentPartIndex = currentIndex;
        }
      }
      
      const operation: Operation = {
        tool,
        params,
        response: messageContent || msg.content,
        responseSize: JSON.stringify(messageContent || msg.content).length,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        usage: msg.usage,
        tokens: messageTokens,
        generationCost,
        contextGrowth,
        ephemeral5m,
        ephemeral1h,
        cacheEfficiency,
        timeGap,
        allocation: 'exact',
        details,
        // Sub-agent support
        isSidechain: msg.isSidechain || false,
        contentPartIndex
      };
      
      
      bundles.push({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [operation],
        totalTokens: messageTokens
      });
    }
  }
  
  // Separate main operations from sidechain operations
  const sidechainBundles = bundles.filter(b => b.operations[0].isSidechain);
  const mainBundles = bundles.filter(b => !b.operations[0].isSidechain);
  
  // Mark sidechain bundles as sub-agent operations and link to parent tasks
  const taskBundles = mainBundles.filter(b => {
    const op = b.operations[0];
    return op.tool === 'Assistant' && op.response && Array.isArray(op.response) &&
           op.response.some((content: any) => content.type === 'tool_use' && content.name === 'Task');
  });
  
  // Create sub-agent bundles by grouping sidechain operations by task
  const subAgentBundles: Bundle[] = [];
  
  for (const taskBundle of taskBundles) {
    const taskOp = taskBundle.operations[0];
    const taskUses = (taskOp.response as any[]).filter((c: any) => c.type === 'tool_use' && c.name === 'Task');
    
    for (const taskUse of taskUses) {
      // Find the ToolResponse for this specific task to get the session boundaries
      const taskResponse = allMessages.find(msg => {
        const isToolResult = (msg.content?.type === 'user' || msg.content?.message?.role === 'user') && 
                           msg.content?.message?.content?.[0]?.type === 'tool_result';
        return isToolResult && msg.content.message.content[0].tool_use_id === taskUse.id;
      });
      
      if (!taskResponse) continue;
      
      // Find sidechain operations that belong to this specific task
      // Use the Task response content to identify which sidechain operations belong to this task
      const taskResponseContent = taskResponse.content.message.content[0].content;
      
      // Parse the task response to extract session information or other identifiers
      let taskSessionInfo: any = null;
      try {
        if (Array.isArray(taskResponseContent) && taskResponseContent[0]?.type === 'text') {
          // Try to extract session info from the response text
          const responseText = taskResponseContent[0].text || '';
          // This is a heuristic - look for patterns that might identify the specific task
          taskSessionInfo = { responseText, taskId: taskUse.id };
        }
      } catch (e) {
        // Fallback to timestamp-based grouping if parsing fails
      }
      
      // Find sidechain operations by content matching with Task prompt
      const taskPrompt = taskUse.input?.prompt || '';
      
      // Find the first sidechain operation that matches the Task prompt
      const firstSidechainOp = sidechainBundles.find(b => {
        const op = b.operations[0];
        if (op.tool === 'User' && typeof op.response === 'string') {
          return op.response === taskPrompt;
        }
        return false;
      });
      
      if (!firstSidechainOp) {
        continue; // No matching sidechain found for this Task
      }
      
      // Collect all sidechain operations by following the parentUuid chain
      const subAgentUuids = new Set<string>();
      const taskSidechainBundles: Bundle[] = [];
      
      // Start with the first sidechain operation UUID
      const startUuid = firstSidechainOp.operations[0].message_id;
      const toProcess = [startUuid];
      
      while (toProcess.length > 0) {
        const currentUuid = toProcess.pop()!;
        if (subAgentUuids.has(currentUuid)) continue;
        subAgentUuids.add(currentUuid);
        
        // Find the bundle with this UUID
        const bundle = sidechainBundles.find(b => b.operations[0].message_id === currentUuid);
        if (bundle) {
          taskSidechainBundles.push(bundle);
        }
        
        // Find child messages that have this UUID as parentUuid
        const childMessages = allMessages.filter(msg => 
          msg.content?.parentUuid === currentUuid && msg.isSidechain
        );
        
        for (const childMsg of childMessages) {
          const childUuid = childMsg.content?.uuid || childMsg.id;  // Use content.uuid or fallback to id
          if (childUuid && !subAgentUuids.has(childUuid)) {
            toProcess.push(childUuid);
          }
        }
      }
      
      if (taskSidechainBundles.length > 0) {
        // Mark all operations in these bundles as belonging to this sub-agent
        const allSubAgentOps: Operation[] = [];
        taskSidechainBundles.forEach(bundle => {
          bundle.operations.forEach(op => {
            op.parentTaskId = taskUse.id;
            op.subAgentType = taskUse.input?.subagent_type || 'general-purpose';
            allSubAgentOps.push(op);
          });
        });
        
        // Sort by timestamp
        allSubAgentOps.sort((a, b) => a.timestamp - b.timestamp);
        
        // Create sub-agent bundle
        const subAgentBundle: Bundle = {
          id: `subagent-${taskUse.id}`,
          timestamp: allSubAgentOps[0].timestamp,
          operations: allSubAgentOps,
          totalTokens: allSubAgentOps.reduce((sum, op) => sum + op.tokens, 0),
          isSubAgent: true,
          subAgentType: taskUse.input?.subagent_type || 'general-purpose',
          parentTaskId: taskUse.id,
          operationCount: allSubAgentOps.length,
          duration: allSubAgentOps.length > 1 ? allSubAgentOps[allSubAgentOps.length - 1].timestamp - allSubAgentOps[0].timestamp : 0
        };
        
        // Set description based on task
        const description = taskUse.input?.description || 'Sub-agent task';
        if (allSubAgentOps.length > 0) {
          allSubAgentOps[0].details = description;
        }
        
        subAgentBundles.push(subAgentBundle);
      }
    }
  }
  
  // Return only main bundles + sub-agent bundles (no individual sidechain bundles)
  const finalBundles: Bundle[] = [...mainBundles];
  
  // Insert sub-agent bundles after their parent Task operations
  for (let i = 0; i < finalBundles.length; i++) {
    const bundle = finalBundles[i];
    const op = bundle.operations[0];
    
    if (op.tool === 'Assistant' && op.response && Array.isArray(op.response)) {
      const taskUses = op.response.filter((c: any) => c.type === 'tool_use' && c.name === 'Task');
      
      // Insert sub-agent bundles after this task bundle
      let insertIndex = i + 1;
      for (const taskUse of taskUses) {
        const subAgentBundle = subAgentBundles.find(b => b.parentTaskId === taskUse.id);
        if (subAgentBundle) {
          finalBundles.splice(insertIndex, 0, subAgentBundle);
          insertIndex++; // Adjust for next insertion
          i++; // Skip the inserted bundle in main loop
        }
      }
    }
  }
  
  // Post-process to enrich ToolResponse details with filenames from linked operations
  for (const bundle of finalBundles) {
    for (const op of bundle.operations) {
      if (op.tool === 'ToolResponse' && op.tool_use_id) {
        // Find the assistant message that created this tool_use_id
        const linkedOps = getLinkedOperations(finalBundles, op.tool_use_id);
        const assistantOp = linkedOps.find(linkedOp => linkedOp.tool === 'Assistant');
        
        if (assistantOp && assistantOp.response && Array.isArray(assistantOp.response)) {
          const toolUse = assistantOp.response.find((c: any) => 
            c.type === 'tool_use' && c.id === op.tool_use_id
          );
          
          if (toolUse) {
            const filename = formatOperationDetails(toolUse.name, toolUse.input);
            op.details = filename; // Override the size details with filename
          }
        }
      }
    }
  }
  
  return finalBundles.sort((a, b) => a.timestamp - b.timestamp);
}

// Find all operations linked by tool_use_id
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

// Helper function to check if an operation is linked to a task through parentUuid chain
function isLinkedToTask(op: Operation, taskId: string, allMessages: JsonlMessage[]): boolean {
  // Find the message that contains this operation
  let currentMsg = allMessages.find(msg => 
    msg.id === op.message_id || 
    msg.content?.uuid === op.message_id ||
    msg.content?.message?.id === op.message_id
  );
  
  while (currentMsg?.content?.parentUuid) {
    // Find parent message by UUID
    const parentMsg = allMessages.find(msg => msg.content?.uuid === currentMsg?.content?.parentUuid);
    if (!parentMsg) break;
    
    // Check if parent message contains our task ID
    const parentContent = parentMsg.content?.message?.content;
    if (parentContent && Array.isArray(parentContent)) {
      const hasTaskId = parentContent.some((c: any) => 
        c.type === 'tool_use' && c.id === taskId
      );
      if (hasTaskId) {
        return true;
      }
    }
    
    currentMsg = parentMsg;
  }
  
  return false;
}