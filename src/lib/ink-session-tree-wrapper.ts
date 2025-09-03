import React from 'react';
import { render } from 'ink';
import { SessionTreeView } from '../entries/tui/SessionTreeView';

/**
 * Promise-based wrapper for the Ink SessionTreeView component
 * Maintains backward compatibility with the old selectSessionWithTreeView API
 */
export async function selectSessionWithTreeView(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let isResolved = false;
    
    const handleResolve = (sessionId: string | null) => {
      if (isResolved) return;
      isResolved = true;
      
      try {
        unmount();
      } catch (error) {
        // Ignore cleanup errors
      }
      
      // Clear the screen and give a moment for unmount to complete
      console.clear();
      setTimeout(() => resolve(sessionId), 10);
    };

    const App = React.createElement(SessionTreeView, {
      onSelect: handleResolve,
      highlightFirst: true,
      autoExpandCurrent: true
    });

    const { unmount } = render(App);
  });
}