import React from 'react';
import { render } from 'ink';
import { InkApp } from './InkApp';

export async function InkTui({
  sessionId, 
  jsonlPath, 
  messageId, 
  contentPart 
}: { 
  sessionId: string; 
  jsonlPath?: string; 
  messageId?: string; 
  contentPart?: number; 
}): Promise<number> {
  return new Promise<number>((resolve) => {
    // Ensure cleanup happens when promise resolves
    const cleanup = () => {
      try {
        if (app) {
          app.unmount();
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    };

    // Handle cleanup when promise resolves
    const handleExit = (code: number) => {
      cleanup();
      resolve(code);
    };

    const App = React.createElement(InkApp, {
      sessionId,
      jsonlPath,
      messageId,
      contentPart,
      onExit: handleExit
    });

    const app = render(App);
  });
}