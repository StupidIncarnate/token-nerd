import type { Bundle } from './bundle';

export interface ListItem {
  id: string;
  timestamp: number;
  icon: string;
  title: string;
  subtitle: string;
  metadata: string;
  isChild?: boolean;
  canExpand?: boolean;
  isExpanded?: boolean;
}

export interface ListView {
  header: string;
  items: ListItem[];
  selectedIndex: number;
  sortMode?: string;
  sortAscending?: boolean;
  pagination?: {
    currentPage: number;
    totalPages: number;
    itemsPerPage: number;
    startIndex: number;
    endIndex: number;
  };
}

export interface ListActions {
  onSelect: (item: ListItem, index: number) => void;
  onBack: () => void;
  onQuit: () => void;
  onToggleExpand?: (item: ListItem, index: number) => void;
  onSelectionChange?: (newIndex: number) => void;
  onTokenSort?: () => void;
  onConversationSort?: () => void;
  onOperationSort?: () => void;
}

export type SortMode = 'conversation' | 'tokens' | 'operation';

export type ViewType = 'main' | 'subAgent' | 'details';

export interface TerminalState {
  bundles: Bundle[];
  sortMode: SortMode;
  sortAscending: boolean;
  selectedIndex: number;
  expanded: Set<string>;
  viewingDetails: Bundle | null;
  viewingSubAgent: Bundle | null; // New state for sub-agent operation list view
  detailScrollOffset: number;
  shouldExit: boolean;
  exitCode: number;
}