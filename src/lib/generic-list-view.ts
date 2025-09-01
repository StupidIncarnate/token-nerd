// Generic reusable terminal list view component
import type { ListItem, ListView, ListActions } from '../types';

export class GenericListView {
  private view: ListView;
  private actions: ListActions;

  constructor(view: ListView, actions: ListActions) {
    this.view = view;
    this.actions = actions;
  }

  render(): void {
    this.clearScreen();
    this.renderHeader();
    this.renderColumnHeaders();
    this.renderItems();
    this.renderControls();
  }

  private clearScreen(): void {
    process.stdout.write('\x1Bc'); // Reset terminal
    process.stdout.write('\x1B[2J\x1B[3J'); // Clear screen and scrollback
    process.stdout.write('\x1B[H'); // Move cursor to home
  }

  private renderHeader(): void {
    const headerLine = `┌${'─'.repeat(98)}┐`;
    const headerContent = `│ ${this.view.header}`.padEnd(99) + '│';
    const headerBottom = `└${'─'.repeat(98)}┘`;

    console.log(headerLine);
    console.log(headerContent);
    
    // Add pagination info if available
    if (this.view.pagination) {
      const p = this.view.pagination;
      const pageInfo = `│ Page ${p.currentPage}/${p.totalPages} | Items ${p.startIndex + 1}-${p.endIndex} of ${this.view.items.length}`.padEnd(99) + '│';
      console.log(pageInfo);
    }
    
    console.log(headerBottom);
  }

  private renderColumnHeaders(): void {
    console.log('');
    console.log('   Time     [ Context ] | Token Impact              | Operation & Details');
    console.log('─'.repeat(100));
  }

  private renderItems(): void {
    const itemsToRender = this.view.pagination 
      ? this.view.items.slice(this.view.pagination.startIndex, this.view.pagination.endIndex)
      : this.view.items;

    itemsToRender.forEach((item, i) => {
      const actualIndex = this.view.pagination ? this.view.pagination.startIndex + i : i;
      const isSelected = actualIndex === this.view.selectedIndex;
      this.renderItem(item, isSelected);
    });

    // Add spacing if fewer items than expected
    if (this.view.pagination) {
      const expectedItems = this.view.pagination.itemsPerPage;
      const actualItems = itemsToRender.length;
      for (let i = actualItems; i < expectedItems; i++) {
        console.log('');
      }
    }
  }

  private renderItem(item: ListItem, isSelected: boolean): void {
    const cursor = isSelected ? '→ ' : '  ';
    const timeStr = new Date(item.timestamp).toLocaleTimeString();
    
    // Handle expansion icon
    const expandIcon = item.canExpand 
      ? (item.isExpanded ? '▼' : '▶') 
      : ' ';
    
    // Handle indentation for child items
    const indentPrefix = item.isChild ? '  ' : '';
    const metadataWithIndent = item.isChild ? `  ${item.metadata}` : item.metadata;
    const titleWithIndent = item.isChild ? `  ${item.title}` : item.title;
    
    const line = `${cursor}${timeStr} [${item.subtitle.padStart(8)}] | ${metadataWithIndent.padEnd(27)} | ${titleWithIndent}`;
    
    if (isSelected) {
      console.log(`\x1b[44m${line.padEnd(100)}\x1b[0m`); // Blue background
    } else {
      console.log(line);
    }
  }

  private renderControls(): void {
    console.log('\n' + '─'.repeat(80));
    console.log('Controls: [↑↓] navigate | [Enter] select | [Tab] expand | [ESC] back | [q]uit');
    console.log('Sort: [c] conversation | [t] tokens | [o] operation');
  }

  handleKey(key: string): void {
    const maxIndex = this.view.items.length - 1;

    switch (key) {
      case '\u001b[A': // Up arrow
        if (this.view.selectedIndex > 0) {
          const newIndex = this.view.selectedIndex - 1;
          this.view.selectedIndex = newIndex;
          if (this.actions.onSelectionChange) {
            this.actions.onSelectionChange(newIndex);
          }
        }
        break;
      case '\u001b[B': // Down arrow
        if (this.view.selectedIndex < maxIndex) {
          const newIndex = this.view.selectedIndex + 1;
          this.view.selectedIndex = newIndex;
          if (this.actions.onSelectionChange) {
            this.actions.onSelectionChange(newIndex);
          }
        }
        break;
      case '\r': // Enter
        if (this.view.items.length > 0) {
          const selectedItem = this.view.items[this.view.selectedIndex];
          this.actions.onSelect(selectedItem, this.view.selectedIndex);
        }
        break;
      case '\t': // Tab
        if (this.view.items.length > 0 && this.actions.onToggleExpand) {
          const selectedItem = this.view.items[this.view.selectedIndex];
          if (selectedItem.canExpand) {
            this.actions.onToggleExpand(selectedItem, this.view.selectedIndex);
          }
        }
        break;
      case '\u001b': // ESC
        this.actions.onBack();
        break;
      case 'q':
      case '\u0003': // Ctrl+C
        this.actions.onQuit();
        break;
    }
  }

  // Update methods for external state changes
  updateView(newView: ListView): void {
    this.view = newView;
  }

  updateActions(newActions: ListActions): void {
    this.actions = newActions;
  }
}