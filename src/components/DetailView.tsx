import React from 'react';
import { Box, Text } from 'ink';
import type { Bundle } from '../types';
import { DetailUserMessage, DetailAgentMessage, DetailSystemMessage, DetailToolResponseMessage, DetailGenericMessage } from './';

interface DetailViewProps {
  bundle: Bundle;
  sessionId: string;
  scrollOffset: number;
}

function HeaderBox({ bundle }: { bundle: Bundle }) {
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
  
  return (
    <Box borderStyle="single" borderColor="cyan" marginBottom={1}>
      <Text bold>{headerTitle}</Text>
    </Box>
  );
}

function BundleInfoBox({ bundle, sessionId }: { bundle: Bundle; sessionId: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>Bundle ID: {bundle.id}</Text>
      <Text>Session ID: {sessionId}</Text>
      <Text>Total Tokens: {bundle.totalTokens.toLocaleString()}</Text>
      <Text>Time: {new Date(bundle.timestamp).toLocaleTimeString()}</Text>
      
      {bundle.isSubAgent && (
        <>
          <Text>Sub-Agent Type: {bundle.subAgentType || 'unknown'}</Text>
          <Text>Parent Task ID: {bundle.parentTaskId || 'unknown'}</Text>
          {bundle.duration && (
            <Text>Duration: {(bundle.duration / 1000).toFixed(1)}s</Text>
          )}
        </>
      )}
      
      {bundle.id.startsWith('linked-') && (
        <Text>Tool Use ID: {bundle.id.replace('linked-', '')}</Text>
      )}
    </Box>
  );
}

function OperationsList({ bundle, scrollOffset }: { bundle: Bundle; scrollOffset: number }) {
  const maxOffset = Math.max(0, bundle.operations.length - 3);
  const clampedOffset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const visibleOperations = bundle.operations.slice(clampedOffset, clampedOffset + 3);
  
  return (
    <Box flexDirection="column">
      <Text>Content (operations {clampedOffset + 1}-{Math.min(clampedOffset + 3, bundle.operations.length)} of {bundle.operations.length}):</Text>
      {visibleOperations.map((operation, index) => {
        const actualIndex = clampedOffset + index;
        
        switch (operation.tool) {
          case 'User':
            return <DetailUserMessage key={actualIndex} operation={operation} index={actualIndex} />;
          case 'System':
            return <DetailSystemMessage key={actualIndex} operation={operation} index={actualIndex} />;
          case 'ToolResponse':
            return <DetailToolResponseMessage key={actualIndex} operation={operation} index={actualIndex} />;
          case 'Assistant':
            return <DetailAgentMessage key={actualIndex} operation={operation} index={actualIndex} />;
          default:
            return <DetailGenericMessage key={actualIndex} operation={operation} index={actualIndex} />;
        }
      })}
    </Box>
  );
}

function Controls() {
  return (
    <Box borderStyle="single" borderColor="gray" marginTop={1}>
      <Text>[↑↓] scroll | [ESC] back to list</Text>
    </Box>
  );
}

export function DetailView({ bundle, sessionId, scrollOffset }: DetailViewProps) {
  return (
    <Box flexDirection="column">
      <HeaderBox bundle={bundle} />
      <BundleInfoBox bundle={bundle} sessionId={sessionId} />
      <OperationsList bundle={bundle} scrollOffset={scrollOffset} />
      <Controls />
    </Box>
  );
}