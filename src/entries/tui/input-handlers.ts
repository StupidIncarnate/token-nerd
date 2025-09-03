import { SessionState } from '../../lib/session-state';
import type { ListItem, ViewType } from '../../types';

// Proper Ink Key type (no any types allowed per standards)
export type Key = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

// Input handling parameter types following standards
export interface ListInputParams {
  input: string;
  key: Key;
  listItems: ListItem[];
  sessionState: SessionState;
  onNavigate: (item: ListItem, index: number) => void;
  onViewUpdate: () => Promise<void>;
}

export interface SortingInputParams {
  input: string;
  currentView: ViewType;
  sessionState: SessionState;
  onViewUpdate: () => Promise<void>;
}

export interface DetailInputParams {
  input: string;
  key: Key;
  sessionState: SessionState;
  onScrollChange: () => void;
}

/**
 * Handle list view input (arrows, enter, tab)
 */
export function handleListViewInput({
  input,
  key,
  listItems,
  sessionState,
  onNavigate,
  onViewUpdate
}: ListInputParams): void {
  const currentState = sessionState.getState();
  const maxIndex = listItems.length - 1;

  if (key.upArrow) {
    if (currentState.selectedIndex > 0) {
      sessionState.setSelectedIndex({ index: currentState.selectedIndex - 1 });
      onViewUpdate();
    }
  } else if (key.downArrow) {
    if (currentState.selectedIndex < maxIndex) {
      sessionState.setSelectedIndex({ index: currentState.selectedIndex + 1 });
      onViewUpdate();
    }
  } else if (key.return) {
    if (listItems.length > 0 && currentState.selectedIndex < listItems.length) {
      const selectedItem = listItems[currentState.selectedIndex];
      if (selectedItem) {
        onNavigate(selectedItem, currentState.selectedIndex);
      }
    }
  } else if (key.tab) {
    if (listItems.length > 0 && currentState.selectedIndex < listItems.length) {
      const selectedItem = listItems[currentState.selectedIndex];
      if (selectedItem?.canExpand) {
        sessionState.toggleExpanded({ id: selectedItem.id });
        onViewUpdate();
      }
    }
  }
}

/**
 * Handle sorting shortcuts (c/t/o keys)
 */
export function handleSortingInput({
  input,
  currentView,
  sessionState,
  onViewUpdate
}: SortingInputParams): boolean {
  // Only handle sorting in main view
  if (currentView !== 'main') return false;

  if (input === 'c') {
    const currentMode = sessionState.getState().sortMode;
    if (currentMode === 'conversation') {
      sessionState.toggleSortDirection();
    } else {
      sessionState.setSortMode({ mode: 'conversation', ascending: true });
    }
    onViewUpdate();
    return true;
  } else if (input === 't') {
    const currentMode = sessionState.getState().sortMode;
    if (currentMode === 'tokens') {
      sessionState.toggleSortDirection();
    } else {
      sessionState.setSortMode({ mode: 'tokens', ascending: false });
    }
    onViewUpdate();
    return true;
  } else if (input === 'o') {
    const currentMode = sessionState.getState().sortMode;
    if (currentMode === 'operation') {
      sessionState.toggleSortDirection();
    } else {
      sessionState.setSortMode({ mode: 'operation', ascending: true });
    }
    onViewUpdate();
    return true;
  }

  return false;
}

/**
 * Handle detail view input (scrolling with arrows/jk)
 */
export function handleDetailViewInput({
  input,
  key,
  sessionState,
  onScrollChange
}: DetailInputParams): void {
  if (key.upArrow || input === 'k') {
    sessionState.scrollDetailView({ direction: 'up' });
    onScrollChange();
  } else if (key.downArrow || input === 'j') {
    sessionState.scrollDetailView({ direction: 'down' });
    onScrollChange();
  }
}