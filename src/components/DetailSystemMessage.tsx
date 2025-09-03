import React from 'react';
import { Box, Text } from 'ink';
import type { Operation } from '../types';

interface DetailSystemMessageProps {
  operation: Operation;
  index: number;
}

export function DetailSystemMessage({ operation, index }: DetailSystemMessageProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="single" borderColor="red" flexDirection="column">
        <Text bold color="red">
          OPERATION {index + 1}: {operation.tool}
        </Text>
        
        <Text color="yellow">⚠️ Hidden System Context</Text>
        <Text>Size: {(operation.responseSize / 1024).toFixed(1)}KB</Text>
        <Text>Estimated Impact: ~{operation.tokens.toLocaleString()} tokens</Text>
        <Text>Timestamp: {new Date(operation.timestamp).toLocaleString()}</Text>
        <Text>Session ID: {operation.session_id}</Text>
      </Box>
    </Box>
  );
}