import type { TerminalState, Bundle, SortMode } from '../types';

export class SessionState {
  private state: TerminalState;

  constructor({ sessionId, bundles }: { sessionId: string; bundles: Bundle[] }) {
    this.state = {
      bundles,
      sortMode: 'conversation',
      sortAscending: true,
      selectedIndex: 0,
      expanded: new Set(),
      viewingDetails: null,
      viewingSubAgent: null,
      detailScrollOffset: 0,
      shouldExit: false,
      exitCode: 0
    };
  }

  getState(): TerminalState {
    return this.state;
  }

  setSortMode({ mode, ascending }: { mode: SortMode; ascending?: boolean }): void {
    this.state.sortMode = mode;
    if (ascending !== undefined) {
      this.state.sortAscending = ascending;
    }
    this.state.selectedIndex = 0;
  }

  toggleSortDirection(): void {
    this.state.sortAscending = !this.state.sortAscending;
    this.state.selectedIndex = 0;
  }

  setSelectedIndex({ index }: { index: number }): void {
    this.state.selectedIndex = Math.max(0, index);
  }

  toggleExpanded({ id }: { id: string }): void {
    if (this.state.expanded.has(id)) {
      this.state.expanded.delete(id);
    } else {
      this.state.expanded.add(id);
    }
  }

  setViewingDetails({ bundle }: { bundle: Bundle | null }): void {
    this.state.viewingDetails = bundle;
    this.state.detailScrollOffset = 0;
  }

  setViewingSubAgent({ bundle }: { bundle: Bundle | null }): void {
    this.state.viewingSubAgent = bundle;
    this.state.selectedIndex = 0;
  }

  scrollDetailView({ direction }: { direction: 'up' | 'down' }): void {
    if (direction === 'up') {
      this.state.detailScrollOffset = Math.max(0, this.state.detailScrollOffset - 1);
    } else {
      this.state.detailScrollOffset = this.state.detailScrollOffset + 1;
    }
  }

  clampDetailScrollOffset({ maxOffset }: { maxOffset: number }): void {
    this.state.detailScrollOffset = Math.min(this.state.detailScrollOffset, maxOffset);
    this.state.detailScrollOffset = Math.max(0, this.state.detailScrollOffset);
  }

  exit({ code }: { code: number }): void {
    this.state.shouldExit = true;
    this.state.exitCode = code;
  }

  shouldExit(): boolean {
    return this.state.shouldExit;
  }

  getExitCode(): number {
    return this.state.exitCode;
  }

  getCurrentViewMode(): 'main' | 'subAgent' | 'details' {
    if (this.state.viewingDetails) return 'details';
    if (this.state.viewingSubAgent) return 'subAgent';
    return 'main';
  }

  resetToMainView(): void {
    this.state.viewingDetails = null;
    this.state.viewingSubAgent = null;
    this.state.detailScrollOffset = 0;
  }

  backFromDetailView(): void {
    if (this.state.viewingDetails?.id.startsWith('subagent-op-') && this.state.viewingSubAgent) {
      this.state.viewingDetails = null;
      this.state.detailScrollOffset = 0;
    } else {
      this.resetToMainView();
    }
  }

}