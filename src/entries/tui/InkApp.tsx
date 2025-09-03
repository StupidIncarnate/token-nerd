import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { correlateOperations } from '../../lib/correlation-engine';
import { SessionState } from '../../lib/session-state';
import type { Bundle, ViewType } from '../../types';
import {InkAppInteractions} from "./InkAppInteractions";

interface InkAppProps {
  sessionId: string;
  jsonlPath?: string;
  messageId?: string;
  contentPart?: number;
  onExit: (code: number) => void;
}

export function InkApp({ sessionId, jsonlPath, messageId, contentPart, onExit }: InkAppProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [currentView, setCurrentView] = useState<ViewType>('main');
  
  const { exit } = useApp();

  // Load session data
  useEffect(() => {
    async function loadSession() {
      try {
        const bundles = await correlateOperations(sessionId, jsonlPath);
        
        if (bundles.length === 0) {
          setError('No operations found for this session');
          return;
        }

        const newSessionState = new SessionState({ sessionId, bundles });
        
        setSessionState(newSessionState);
        
        // Handle direct navigation if specified
        if (messageId) {
          handleDirectNavigation(bundles, messageId, newSessionState, contentPart);
        }
        
        setLoading(false);
      } catch (err) {
        setError(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      }
    }
    
    loadSession();
  }, [sessionId, jsonlPath, messageId, contentPart]);

  // Handle direct navigation
  const handleDirectNavigation = (bundles: Bundle[], targetMessageId: string, sessionState: SessionState, targetContentPart?: number) => {
    const targetBundle = bundles.find(bundle => 
      bundle.operations.some(op => op.message_id === targetMessageId)
    );
    
    if (!targetBundle) {
      setError(`Message ID ${targetMessageId} not found in session`);
      return;
    }
    
    const detailBundle = buildDirectDetailBundle(targetBundle, bundles, targetMessageId, targetContentPart);
    sessionState.setViewingDetails({ bundle: detailBundle });
    setCurrentView('details');
  };

  const buildDirectDetailBundle = (targetBundle: Bundle, bundles: Bundle[], targetMessageId: string, targetContentPart?: number): Bundle => {
    if (targetContentPart !== undefined) {
      const targetOp = findSpecificContentPart(bundles, targetMessageId, targetContentPart);
      if (!targetOp) {
        return targetBundle;
      }
      
      return {
        id: `${targetMessageId}[${targetContentPart}]`,
        timestamp: targetOp.timestamp,
        operations: [targetOp],
        totalTokens: targetOp.tokens
      };
    }
    
    return buildCombinedMessageBundle(bundles, targetMessageId);
  };

  const findSpecificContentPart = (bundles: Bundle[], messageId: string, contentPart: number) => {
    const targetBundleWithPart = bundles.find(b => 
      b.operations.some(op => 
        op.message_id === messageId && op.contentPartIndex === contentPart
      )
    );
    
    if (!targetBundleWithPart) return null;
    
    return targetBundleWithPart.operations.find(op => 
      op.message_id === messageId && op.contentPartIndex === contentPart
    ) || null;
  };

  const buildCombinedMessageBundle = (bundles: Bundle[], messageId: string): Bundle => {
    const allBundlesForMessage = bundles.filter(b => 
      b.operations.some(op => op.message_id === messageId)
    );
    
    if (allBundlesForMessage.length > 1) {
      const allOperations = allBundlesForMessage.flatMap(b => 
        b.operations.filter(op => op.message_id === messageId)
      );
      
      allOperations.sort((a, b) => {
        const aIndex = a.contentPartIndex ?? 0;
        const bIndex = b.contentPartIndex ?? 0;
        return aIndex - bIndex;
      });
      
      return {
        id: messageId,
        timestamp: Math.min(...allOperations.map(op => op.timestamp)),
        operations: allOperations,
        totalTokens: allOperations.reduce((sum, op) => sum + op.tokens, 0)
      };
    }
    
    return allBundlesForMessage[0];
  };

  // Handle session state exit - check on every render
  useEffect(() => {
    if (sessionState?.shouldExit()) {
      onExit(sessionState.getExitCode());
    }
  });

  // Also check for exit after every input/state change
  if (sessionState?.shouldExit()) {
    setTimeout(() => onExit(sessionState.getExitCode()), 0);
  }


  // Loading state
  if (loading) {
    return (
      <Box>
        <Text>Loading session {sessionId.slice(0, 8)}...</Text>
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box>
        <Text color="red">{error}</Text>
        <Text>Press any key to exit...</Text>
      </Box>
    );
  }

  // Main app render
  if (!sessionState) {
    return (
      <Box>
        <Text color="red">Failed to initialize session state</Text>
      </Box>
    );
  }

  return (
    <InkAppInteractions
      sessionState={sessionState}
      currentView={currentView}
      jsonlPath={jsonlPath}
      onViewChange={setCurrentView}
      onExit={onExit}
    />
  );
}
