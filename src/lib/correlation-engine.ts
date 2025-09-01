import { parseJsonl } from './jsonl-utils';
import type { JsonlMessage } from '../types';
import { processMessage } from './message-parser';
import { 
  createSystemOperation,
  createUserOperation,
  createToolResponseOperation,
  createAssistantOperation
} from './operation-factory';
import { processSubAgents } from './sub-agent-processor';
import { enrichToolResponseDetails } from './correlation-utils';
import type { Operation, Bundle } from '../types';

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
  
  // Check if messages have parent-child relationships (UUID/parentUuid)
  const hasConversationStructure = allMessages.some(msg => 
    msg.content?.uuid || msg.content?.parentUuid
  );
  
  if (!hasConversationStructure) {
    // No parent-child relationships, use simple timestamp sorting
    return finalBundles.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  // Build conversation flow based on parent-child relationships
  const conversationFlow: Bundle[] = [];
  const processedBundles = new Set<string>();
  
  // Helper function to find all messages that respond to a given UUID
  function findResponsesTo(targetUuid: string): Bundle[] {
    return finalBundles.filter(bundle => {
      const bundleMessage = allMessages.find(msg => msg.id === bundle.id);
      return bundleMessage?.content?.parentUuid === targetUuid;
    }).sort((a, b) => {
      // Sort responses by JSONL order when timestamps are unreliable
      const aIndex = allMessages.findIndex(msg => msg.id === a.id);
      const bIndex = allMessages.findIndex(msg => msg.id === b.id);
      return aIndex - bIndex;
    });
  }
  
  // Start with messages that have no parent (conversation starters)
  const rootMessages = finalBundles.filter(bundle => {
    const bundleMessage = allMessages.find(msg => msg.id === bundle.id);
    return !bundleMessage?.content?.parentUuid;
  }).sort((a, b) => a.timestamp - b.timestamp);
  
  // Process each conversation thread
  function processConversationThread(bundle: Bundle): void {
    if (processedBundles.has(bundle.id)) return;
    
    conversationFlow.push(bundle);
    processedBundles.add(bundle.id);
    
    // Find and process all direct responses to this message
    const bundleMessage = allMessages.find(msg => msg.id === bundle.id);
    if (bundleMessage) {
      // Use the UUID of the current message as the target that others respond to
      const messageUuid = bundleMessage.content?.uuid;
      if (messageUuid) {
        const responses = findResponsesTo(messageUuid);
        responses.forEach(response => processConversationThread(response));
      }
    }
  }
  
  // Process all root conversation threads
  rootMessages.forEach(rootBundle => processConversationThread(rootBundle));
  
  // Add any remaining bundles that weren't part of a conversation thread (fallback)
  finalBundles.forEach(bundle => {
    if (!processedBundles.has(bundle.id)) {
      conversationFlow.push(bundle);
    }
  });
  
  return conversationFlow;
}

// Re-export for backward compatibility
export { getLinkedOperations } from './correlation-utils';