import type { Session } from './session';

export interface ProjectNode {
  name: string;
  path: string;
  sessions: Session[];
  isExpanded: boolean;
  isCurrentProject: boolean;
}

export interface TreeViewOptions {
  autoExpandCurrent?: boolean;
  highlightFirst?: boolean;
}