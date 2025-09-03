import React from 'react';
import { Box, Text } from 'ink';
import { TIME_CONSTANTS } from '../config';
import type { Operation } from '../types';

interface DetailGenericMessageProps {
  operation: Operation;
  index: number;
}

export function DetailGenericMessage({ operation, index }: DetailGenericMessageProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="single" borderColor="white" flexDirection="column">
        <Text bold>
          OPERATION {index + 1}: {operation.tool}
        </Text>
        
        <Text>Tokens: {operation.tokens.toLocaleString()} ({operation.allocation})</Text>
        
        {operation.message_id && (
          <Text>Message ID: {operation.message_id}</Text>
        )}
        {operation.contentPartIndex !== undefined && (
          <Text>Content Part: {operation.contentPartIndex} (showing only this part)</Text>
        )}
        {operation.sequence !== undefined && (
          <Text>Sequence: {operation.sequence}</Text>
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
        
        {(operation.ephemeral5m || operation.ephemeral1h) && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Ephemeral Cache:</Text>
            {operation.ephemeral5m && (
              <Text>  5-min: {operation.ephemeral5m.toLocaleString()} tokens</Text>
            )}
            {operation.ephemeral1h && (
              <Text>  1-hour: {operation.ephemeral1h.toLocaleString()} tokens</Text>
            )}
          </Box>
        )}
        
        {operation.usage && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Full Usage:</Text>
            {operation.usage.cache_creation_input_tokens && (
              <Text>  Cache Creation: {operation.usage.cache_creation_input_tokens.toLocaleString()}</Text>
            )}
            {operation.usage.cache_read_input_tokens && (
              <Text>  Cache Read: {operation.usage.cache_read_input_tokens.toLocaleString()}</Text>
            )}
            {operation.usage.input_tokens && (
              <Text>  Input: {operation.usage.input_tokens.toLocaleString()}</Text>
            )}
            {operation.usage.output_tokens && (
              <Text>  Output: {operation.usage.output_tokens.toLocaleString()}</Text>
            )}
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text>Response Size: {operation.responseSize.toLocaleString()} chars</Text>
          <Text>Sequence: {operation.sequence || 'N/A'}</Text>
          <Text>Message ID: {operation.message_id || 'N/A'}</Text>
          
          {operation.tool !== 'Assistant' && operation.params && (
            <Box marginTop={1} flexDirection="column">
              <Text bold>Request Parameters:</Text>
              <Box marginLeft={2}>
                <Text>{JSON.stringify(operation.params, null, 2)}</Text>
              </Box>
            </Box>
          )}
          
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