import React from 'react';
import { Box, Text } from 'ink';
import { TIME_CONSTANTS } from '../config';
import type { Operation } from '../types';

interface DetailUserMessageProps {
  operation: Operation;
  index: number;
}

export function DetailUserMessage({ operation, index }: DetailUserMessageProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="single" borderColor="blue" flexDirection="column">
        <Text bold color="blue">
          OPERATION {index + 1}: {operation.tool}
        </Text>
        
        <Text>Message Length: {operation.responseSize} chars</Text>
        <Text>Estimated Tokens: ~{operation.tokens.toLocaleString()}</Text>
        
        {operation.timeGap && operation.timeGap > TIME_CONSTANTS.CACHE_EXPIRY_SECONDS && (
          <Text color="yellow">
            ⚠️ Time Gap: {Math.round(operation.timeGap/60)} minutes (cache may expire)
          </Text>
        )}
        
        <Text>Timestamp: {new Date(operation.timestamp).toLocaleString()}</Text>
        <Text>Session ID: {operation.session_id}</Text>
        
        <Box marginTop={1} flexDirection="column">
          <Text>Response Size: {operation.responseSize.toLocaleString()} chars</Text>
          <Text>Sequence: {operation.sequence || 'N/A'}</Text>
          <Text>Message ID: {operation.message_id || 'N/A'}</Text>
          
          <Box marginTop={1} flexDirection="column">
            <Text bold>Response:</Text>
            <Box marginLeft={2}>
              <Text>{typeof operation.response === 'string' ? operation.response : JSON.stringify(operation.response, null, 2)}</Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}