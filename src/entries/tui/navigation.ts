import { SessionState } from '../../lib/session-state';
import type { Bundle, ViewType } from '../../types';

// Navigation parameter types following standards: object parameters with inline types
export interface NavigateToDetailsParams {
  bundle: Bundle;
  sessionState: SessionState;
  onViewChange: (view: ViewType) => void;
  clearScreen?: boolean;
}

export interface NavigateToSubAgentParams {
  bundle: Bundle;
  sessionState: SessionState;
  onViewChange: (view: ViewType) => void;
}

export interface HandleEscapeNavigationParams {
  currentView: ViewType;
  sessionState: SessionState;
  onViewChange: (view: ViewType) => void;
  onExit: (code: number) => void;
  clearScreen?: boolean;
}

/**
 * Navigate to details view for a bundle
 */
export function navigateToDetails({
  bundle,
  sessionState,
  onViewChange,
  clearScreen = true
}: NavigateToDetailsParams): void {
  if (clearScreen) {
    process.stdout.write('\x1Bc');
  }
  
  sessionState.setViewingDetails({ bundle });
  onViewChange('details');
}

/**
 * Navigate to sub-agent view for a bundle
 */
export function navigateToSubAgent({
  bundle,
  sessionState,
  onViewChange
}: NavigateToSubAgentParams): void {
  sessionState.setViewingSubAgent({ bundle });
  onViewChange('subAgent');
}

/**
 * Handle ESC key navigation for all views with immediate response
 */
export function handleEscapeNavigation({
  currentView,
  sessionState,
  onViewChange,
  onExit,
  clearScreen = true
}: HandleEscapeNavigationParams): void {
  if (currentView === 'details') {
    if (clearScreen) {
      process.stdout.write('\x1Bc');
    }
    // Navigate back: details -> main or subAgent
    const state = sessionState.getState();
    const previousView = state.viewingSubAgent ? 'subAgent' : 'main';
    sessionState.setViewingDetails({ bundle: null });
    onViewChange(previousView);
  } else if (currentView === 'subAgent') {
    if (clearScreen) {
      process.stdout.write('\x1Bc');
    }
    // Navigate back: subAgent -> main
    sessionState.setViewingSubAgent({ bundle: null });
    onViewChange('main');
  } else if (currentView === 'main') {
    // ESC from main list should go back to session tree
    onExit(2);
  }
}