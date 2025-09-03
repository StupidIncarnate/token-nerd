import { transformBundlesToListItems } from './ListView';
import { transformSubAgentOperationsToListItems } from './SubagentListView';
import { getCurrentTokenCount } from '../../lib/token-calculator';
import type { ListItem, ViewType, TerminalState } from '../../types';

// View update parameter types following standards
export interface UpdateMainViewParams {
  state: TerminalState;
  jsonlPath?: string;
  setListItems: (items: ListItem[]) => void;
  setHeader: (header: string) => void;
}

export interface UpdateSubAgentViewParams {
  state: TerminalState;
  setListItems: (items: ListItem[]) => void;
  setHeader: (header: string) => void;
}

export interface UpdateViewForCurrentParams {
  currentView: ViewType;
  state: TerminalState;
  jsonlPath?: string;
  setListItems: (items: ListItem[]) => void;
  setHeader: (header: string) => void;
}

/**
 * Update main view with operation list and token totals
 */
export async function updateMainView({
  state,
  jsonlPath,
  setListItems,
  setHeader
}: UpdateMainViewParams): Promise<void> {
  const items = transformBundlesToListItems({ state });
  const totalTokens = jsonlPath ? await getCurrentTokenCount(jsonlPath) : 0;
  const sortDirection = state.sortAscending ? '↑' : '↓';
  const headerText = `Session: ${state.bundles[0]?.operations[0]?.session_id?.slice(0, 8) || 'unknown'} | Total: ${totalTokens.toLocaleString()} tokens | Sort: ${state.sortMode.toUpperCase()} ${sortDirection}`;
  
  setListItems(items);
  setHeader(headerText);
}

/**
 * Update sub-agent view with sub-agent operations
 */
export function updateSubAgentView({
  state,
  setListItems,
  setHeader
}: UpdateSubAgentViewParams): void {
  const subAgentBundle = state.viewingSubAgent;
  if (!subAgentBundle) return;
  
  const subItems = transformSubAgentOperationsToListItems({ subAgentBundle });
  const subHeader = `SUB-AGENT: ${subAgentBundle.operations[0].details || 'Sub-agent operations'} | ${subAgentBundle.operations.length} Operations`;
  
  setListItems(subItems);
  setHeader(subHeader);
}

/**
 * Update view based on current view type
 */
export async function updateViewForCurrent({
  currentView,
  state,
  jsonlPath,
  setListItems,
  setHeader
}: UpdateViewForCurrentParams): Promise<void> {
  switch (currentView) {
    case 'main':
      await updateMainView({ state, jsonlPath, setListItems, setHeader });
      break;
    case 'subAgent':
      updateSubAgentView({ state, setListItems, setHeader });
      break;
    case 'details':
      // Details view will be handled separately by InkDetailView component
      break;
  }
}