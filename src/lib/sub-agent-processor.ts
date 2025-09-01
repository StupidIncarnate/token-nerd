import type { JsonlMessage, Operation, Bundle } from '../types';

export function findTaskBundles(mainBundles: Bundle[]): Bundle[] {
  return mainBundles.filter(b => {
    const op = b.operations[0];
    return op.tool === 'Assistant' && op.response && Array.isArray(op.response) &&
           op.response.some((content: any) => content.type === 'tool_use' && content.name === 'Task');
  });
}

export function findFirstSidechainOperation(sidechainBundles: Bundle[], taskPrompt: string): Bundle | undefined {
  return sidechainBundles.find(b => {
    const op = b.operations[0];
    if (op.tool === 'User' && typeof op.response === 'string') {
      return op.response === taskPrompt;
    }
    return false;
  });
}

export function traverseUuidChain(
  startUuid: string, 
  sidechainBundles: Bundle[], 
  allMessages: JsonlMessage[]
): Bundle[] {
  const subAgentUuids = new Set<string>();
  const taskSidechainBundles: Bundle[] = [];
  const toProcess = [startUuid];
  
  while (toProcess.length > 0) {
    const currentUuid = toProcess.pop()!;
    if (subAgentUuids.has(currentUuid)) continue;
    subAgentUuids.add(currentUuid);
    
    const bundle = sidechainBundles.find(b => b.operations[0].message_id === currentUuid);
    if (bundle) {
      taskSidechainBundles.push(bundle);
    }
    
    const childMessages = allMessages.filter(msg => 
      msg.content?.parentUuid === currentUuid && msg.isSidechain
    );
    
    for (const childMsg of childMessages) {
      const childUuid = childMsg.content?.uuid || childMsg.id;
      if (childUuid && !subAgentUuids.has(childUuid)) {
        toProcess.push(childUuid);
      }
    }
  }
  
  return taskSidechainBundles;
}

export function createSubAgentBundle(taskSidechainBundles: Bundle[], taskUse: any): Bundle {
  const allSubAgentOps: Operation[] = [];
  taskSidechainBundles.forEach(bundle => {
    bundle.operations.forEach((op: Operation) => {
      op.parentTaskId = taskUse.id;
      op.subAgentType = taskUse.input?.subagent_type || 'general-purpose';
      allSubAgentOps.push(op);
    });
  });
  
  allSubAgentOps.sort((a, b) => a.timestamp - b.timestamp);
  
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
  
  const description = taskUse.input?.description || 'Sub-agent task';
  if (allSubAgentOps.length > 0) {
    allSubAgentOps[0].details = description;
  }
  
  return subAgentBundle;
}

export function processSubAgents(mainBundles: Bundle[], sidechainBundles: Bundle[], allMessages: JsonlMessage[]): Bundle[] {
  const taskBundles = findTaskBundles(mainBundles);
  const subAgentBundles: Bundle[] = [];
  
  for (const taskBundle of taskBundles) {
    const taskOp = taskBundle.operations[0];
    const taskUses = (taskOp.response as any[]).filter((c: any) => c.type === 'tool_use' && c.name === 'Task');
    
    for (const taskUse of taskUses) {
      const taskResponse = allMessages.find(msg => {
        const isToolResult = (msg.content?.type === 'user' || msg.content?.message?.role === 'user') && 
                           msg.content?.message?.content?.[0]?.type === 'tool_result';
        return isToolResult && msg.content.message.content[0].tool_use_id === taskUse.id;
      });
      
      if (!taskResponse) continue;
      
      const taskPrompt = taskUse.input?.prompt || '';
      const firstSidechainOp = findFirstSidechainOperation(sidechainBundles, taskPrompt);
      
      if (!firstSidechainOp) continue;
      
      const startUuid = firstSidechainOp.operations[0].message_id;
      if (!startUuid) continue;
      
      const taskSidechainBundles = traverseUuidChain(startUuid, sidechainBundles, allMessages);
      
      if (taskSidechainBundles.length > 0) {
        const subAgentBundle = createSubAgentBundle(taskSidechainBundles, taskUse);
        subAgentBundles.push(subAgentBundle);
      }
    }
  }
  
  return subAgentBundles;
}