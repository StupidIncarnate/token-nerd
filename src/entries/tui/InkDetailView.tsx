import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { Bundle, Operation } from '../../types';
import { SessionState } from '../../lib/session-state';
import { TIME_CONSTANTS } from '../../config';

interface InkDetailViewProps {
  bundle: Bundle;
  sessionState: SessionState;
  scrollOffset: number;
  refreshTrigger: number;
}

export function InkDetailView({ bundle, sessionState, scrollOffset, refreshTrigger }: InkDetailViewProps) {
  const [allLines, setAllLines] = useState<string[]>([]);
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const { stdout } = useStdout();
  
  useEffect(() => {
    const lines = buildOperationLines(bundle);
    setAllLines(lines);
  }, [bundle]);
  
  useEffect(() => {
    if (allLines.length === 0) return;
    
    // Calculate dynamic visible lines based on terminal height
    const terminalHeight = stdout?.rows || 24; // Default fallback
    const reservedLines = 8; // Header (2) + bundle info (5) + controls (2) + scroll info (1) + margins
    const maxVisible = Math.max(5, terminalHeight - reservedLines); // At least 5 lines visible
    
    const maxOffset = Math.max(0, allLines.length - maxVisible);
    const clampedOffset = Math.min(Math.max(0, scrollOffset), maxOffset);
    
    // Update session state with clamped offset if needed
    sessionState.clampDetailScrollOffset({ maxOffset });
    
    const visible = allLines.slice(clampedOffset, clampedOffset + maxVisible);
    setVisibleLines(visible);
  }, [allLines, scrollOffset, refreshTrigger, stdout?.rows]); // Include terminal height in dependencies

  const getHeaderTitle = (): string => {
    const isSubAgentBundle = bundle.isSubAgent;
    const isLinkedBundle = bundle.id.startsWith('linked-');
    
    if (isSubAgentBundle) {
      return `SUB-AGENT DETAILS - ${bundle.operations.length} Operations`;
    } else if (isLinkedBundle) {
      return `LINKED TOOL OPERATIONS - ${bundle.operations.length} Operations`;  
    } else {
      return `BUNDLE DETAILS - ${bundle.operations.length} Operations`;
    }
  };

  // Calculate current maxVisible for display
  const terminalHeight = stdout?.rows || 24;
  const reservedLines = 8;
  const maxVisible = Math.max(5, terminalHeight - reservedLines);

  const renderBundleInfo = () => {
    const sessionId = bundle.operations[0]?.session_id || 'unknown';
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text>Bundle ID: {bundle.id}</Text>
        <Text>Session ID: {sessionId.slice(0, 8)}</Text>
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
  };
  
  return (
    <Box flexDirection="column" width={100}>
      {/* Header */}
      <Box borderStyle="single" paddingX={1}>
        <Text>{getHeaderTitle()}</Text>
      </Box>
      
      {/* Bundle Info */}
      <Box paddingX={1} marginTop={1}>
        {renderBundleInfo()}
      </Box>
      
      {/* Content with scroll info */}
      <Box paddingX={1}>
        <Text>Content (lines {scrollOffset + 1}-{Math.min(scrollOffset + maxVisible, allLines.length)} of {allLines.length}) [Terminal: {terminalHeight}h, Showing: {maxVisible}]:</Text>
      </Box>
      
      {/* Scroll indicators */}
      {scrollOffset > 0 && (
        <Box paddingX={1}>
          <Text color="gray">... ({scrollOffset} lines above)</Text>
        </Box>
      )}
      
      {/* Scrollable content */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {visibleLines.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </Box>
      
      {scrollOffset + maxVisible < allLines.length && (
        <Box paddingX={1}>
          <Text color="gray">... ({allLines.length - scrollOffset - maxVisible} lines below)</Text>
        </Box>
      )}
      
      {/* Controls */}
      <Box borderStyle="single" borderTop={true} paddingX={1} marginTop={1}>
        <Text color="gray">Controls: [↑↓/j/k] scroll | [ESC] back to list | [q]uit</Text>
      </Box>
    </Box>
  );
}

// Convert the DetailRenderer logic to pure functions
function buildOperationLines(bundle: Bundle): string[] {
  const allLines: string[] = [];
  
  bundle.operations.forEach((operation, index) => {
    let operationLines: string[] = [];
    
    if (operation.tool === 'System') {
      operationLines = renderSystemMessage(operation, index);
    } else if (operation.tool === 'ToolResponse') {
      operationLines = renderToolResponseMessage(operation, index);
    } else if (operation.tool === 'User') {
      operationLines = renderUserMessage(operation, index);
    } else if (operation.tool === 'Assistant') {
      operationLines = renderAssistantMessage(operation, index);
    } else {
      operationLines = renderGenericMessage(operation, index);
    }
    
    allLines.push(...operationLines);
    allLines.push(...renderOperationResponse(operation));
    allLines.push(`└${'─'.repeat(70)}`);
    allLines.push('');
  });
  
  return allLines;
}

function renderSystemMessage(operation: Operation, index: number): string[] {
  const lines: string[] = [];
  const width = 70; // Reasonable terminal width
  lines.push(`┌─ OPERATION ${index + 1}: ${operation.tool} ─${'─'.repeat(Math.max(1, width - 20 - operation.tool.length))}`);
  lines.push(`│ ⚠️ Hidden System Context`);
  lines.push(`│ Size: ${(operation.responseSize / 1024).toFixed(1)}KB`);
  lines.push(`│ Estimated Impact: ~${operation.tokens.toLocaleString()} tokens`);
  lines.push(`│ Timestamp: ${new Date(operation.timestamp).toLocaleString()}`);
  lines.push(`│ Session ID: ${operation.session_id}`);
  return lines;
}

function renderToolResponseMessage(operation: Operation, index: number): string[] {
  const lines: string[] = [];
  const width = 70;
  lines.push(`┌─ OPERATION ${index + 1}: ${operation.tool} ─${'─'.repeat(Math.max(1, width - 20 - operation.tool.length))}`);
  lines.push(`│ Size: ${(operation.responseSize / 1024).toFixed(1)}KB`);
  lines.push(`│ Estimated Tokens: ~${operation.tokens.toLocaleString()}`);
  lines.push(`│ Impact: This content will be processed in the next Assistant message`);
  lines.push(`│ Timestamp: ${new Date(operation.timestamp).toLocaleString()}`);
  lines.push(`│ Session ID: ${operation.session_id}`);
  return lines;
}

function renderUserMessage(operation: Operation, index: number): string[] {
  const lines: string[] = [];
  const width = 70;
  lines.push(`┌─ OPERATION ${index + 1}: ${operation.tool} ─${'─'.repeat(Math.max(1, width - 20 - operation.tool.length))}`);
  lines.push(`│ Message Length: ${operation.responseSize} chars`);
  lines.push(`│ Estimated Tokens: ~${operation.tokens.toLocaleString()}`);
  if (operation.timeGap && operation.timeGap > TIME_CONSTANTS.CACHE_EXPIRY_SECONDS) {
    lines.push(`│ ⚠️ Time Gap: ${Math.round(operation.timeGap/60)} minutes (cache may expire)`);
  }
  lines.push(`│ Timestamp: ${new Date(operation.timestamp).toLocaleString()}`);
  lines.push(`│ Session ID: ${operation.session_id}`);
  return lines;
}

function renderAssistantMessage(operation: Operation, index: number): string[] {
  const lines: string[] = [];
  const width = 70;
  lines.push(`┌─ OPERATION ${index + 1}: ${operation.tool} ─${'─'.repeat(Math.max(1, width - 20 - operation.tool.length))}`);
  lines.push(`│ Tokens: ${operation.tokens.toLocaleString()} (${operation.allocation})`);
  
  if (operation.cacheEfficiency !== undefined) {
    lines.push(`│ Cache Efficiency: ${operation.cacheEfficiency.toFixed(1)}%${operation.cacheEfficiency < 50 ? ' ⚠️ LOW' : ''}`);
  }
  
  if (operation.timeGap && operation.timeGap > TIME_CONSTANTS.CACHE_EXPIRY_SECONDS) {
    lines.push(`│ ⚠️ Time Gap: ${Math.round(operation.timeGap/60)} minutes (cache expired)`);
  }
  
  return lines;
}

function renderGenericMessage(operation: Operation, index: number): string[] {
  const lines: string[] = [];
  const width = 70;
  lines.push(`┌─ OPERATION ${index + 1}: ${operation.tool} ─${'─'.repeat(Math.max(1, width - 20 - operation.tool.length))}`);
  lines.push(`│ Tokens: ${operation.tokens.toLocaleString()} (${operation.allocation})`);
  
  if (operation.message_id) {
    lines.push(`│ Message ID: ${operation.message_id}`);
  }
  if (operation.contentPartIndex !== undefined) {
    lines.push(`│ Content Part: ${operation.contentPartIndex} (showing only this part)`);
  }
  
  lines.push(`│ Timestamp: ${new Date(operation.timestamp).toLocaleString()}`);
  lines.push(`│ Session ID: ${operation.session_id}`);
  
  return lines;
}

function renderOperationResponse(operation: Operation): string[] {
  const lines: string[] = [];
  
  lines.push(`│ Response Size: ${operation.responseSize.toLocaleString()} chars`);
  lines.push(`│ Sequence: ${operation.sequence || 'N/A'}`);
  lines.push(`│ Message ID: ${operation.message_id || 'N/A'}`);
  
  if (operation.tool !== 'Assistant') {
    lines.push(`│ Request Parameters:`);
    const paramsStr = JSON.stringify(operation.params, null, 2);
    paramsStr.split('\n').forEach(line => lines.push(`│   ${line}`));
    lines.push(`│`);
  }
  
  lines.push(`│ Response:`);
  
  let responseContent: string;
  if (typeof operation.response === 'string') {
    responseContent = operation.response;
  } else if (Array.isArray(operation.response)) {
    if (operation.contentPartIndex !== undefined && operation.response[operation.contentPartIndex]) {
      const part = operation.response[operation.contentPartIndex];
      if (part.type === 'text') {
        responseContent = part.text;
      } else if (part.type === 'tool_use') {
        responseContent = `${part.name}: ${JSON.stringify(part.input, null, 2)}`;
      } else {
        responseContent = JSON.stringify(part, null, 2);
      }
    } else {
      responseContent = operation.response.map((part: any) => {
        if (part.type === 'text') {
          return part.text;
        } else if (part.type === 'tool_use') {
          return `${part.name}: ${JSON.stringify(part.input, null, 2)}`;
        } else {
          return JSON.stringify(part, null, 2);
        }
      }).join('\n');
    }
  } else {
    responseContent = JSON.stringify(operation.response, null, 2);
  }
  
  responseContent.split('\n').forEach(line => lines.push(`│   ${line}`));
  
  return lines;
}