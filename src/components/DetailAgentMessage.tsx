import React from 'react';
import { Box, Text } from 'ink';
import { TIME_CONSTANTS } from '../config';
import type { Operation } from '../types';

interface DetailAgentMessageProps {
  operation: Operation;
  index: number;
}

export function DetailAgentMessage({ operation, index }: DetailAgentMessageProps) {
  const renderResponseContent = () => {
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
    return responseContent;
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="single" borderColor="magenta" flexDirection="column">
        <Text bold color="magenta">
          OPERATION {index + 1}: {operation.tool}
        </Text>
        
        <Text>Tokens: {operation.tokens.toLocaleString()} ({operation.allocation})</Text>
        
        {operation.cacheEfficiency !== undefined && (
          <Text color={operation.cacheEfficiency < 50 ? "yellow" : "green"}>
            Cache Efficiency: {operation.cacheEfficiency.toFixed(1)}%{operation.cacheEfficiency < 50 ? ' ⚠️ LOW' : ''}
          </Text>
        )}
        
        {operation.timeGap && operation.timeGap > TIME_CONSTANTS.CACHE_EXPIRY_SECONDS && (
          <Text color="yellow">
            ⚠️ Time Gap: {Math.round(operation.timeGap/60)} minutes (cache expired)
          </Text>
        )}
        
        <Text>Timestamp: {new Date(operation.timestamp).toLocaleString()}</Text>
        <Text>Session ID: {operation.session_id}</Text>
        
        {(operation.contextGrowth > 0 || operation.generationCost > 0) && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Breakdown:</Text>
            {operation.contextGrowth > 0 && (
              <Text>  Cache Creation: {operation.contextGrowth.toLocaleString()} (from cache_creation_input_tokens)</Text>
            )}
            {operation.generationCost > 0 && (
              <Text>  Generation Cost: {operation.generationCost.toLocaleString()} (output tokens)</Text>
            )}
          </Box>
        )}
        
        <Box marginTop={1} flexDirection="column">
          <Text>Response Size: {operation.responseSize.toLocaleString()} chars</Text>
          <Text>Sequence: {operation.sequence || 'N/A'}</Text>
          <Text>Message ID: {operation.message_id || 'N/A'}</Text>
          
          <Box marginTop={1} flexDirection="column">
            <Text bold>Response:</Text>
            <Box marginLeft={2}>
              <Text>{renderResponseContent()}</Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}