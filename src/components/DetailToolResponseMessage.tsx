import React from 'react';
import { Box, Text } from 'ink';
import type { Operation } from '../types';

interface DetailToolResponseMessageProps {
  operation: Operation;
  index: number;
}

export function DetailToolResponseMessage({ operation, index }: DetailToolResponseMessageProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="single" borderColor="green" flexDirection="column">
        <Text bold color="green">
          OPERATION {index + 1}: {operation.tool}
        </Text>
        
        <Text>Size: {(operation.responseSize / 1024).toFixed(1)}KB</Text>
        <Text>Estimated Tokens: ~{operation.tokens.toLocaleString()}</Text>
        <Text color="cyan">Impact: This content will be processed in the next Assistant message</Text>
        <Text>Timestamp: {new Date(operation.timestamp).toLocaleString()}</Text>
        <Text>Session ID: {operation.session_id}</Text>
      </Box>
    </Box>
  );
}