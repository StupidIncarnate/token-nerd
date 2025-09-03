import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { ListItem, ListView, ListActions } from '../../types';

interface InkListViewProps {
  view: ListView;
  actions: ListActions;
}

export function InkListView({ view, actions }: InkListViewProps) {
  // Add defensive checks
  if (!view || !view.items) {
    return <Box><Text color="red">Error: Invalid view data</Text></Box>;
  }
  
  if (!actions) {
    return <Box><Text color="red">Error: No actions provided</Text></Box>;
  }

  const columns = process.stdout.columns || 100;
  
  // Use view.selectedIndex directly instead of local state
  const selectedIndex = view.selectedIndex;
  const [scrollOffset, setScrollOffset] = useState(0);
  
  // For pagination, we work with the full item list but display only the current page
  const itemsToRender = view.items; // Always work with full list
  const maxVisible = view.pagination ? view.pagination.itemsPerPage : 15;

  // Calculate scroll offset based on pagination if present
  useEffect(() => {
    if (view.pagination) {
      // For paginated view, calculate scroll within the current page
      const pageStartIndex = view.pagination.startIndex;
      const pageEndIndex = view.pagination.endIndex;
      const selectedWithinPage = selectedIndex - pageStartIndex;
      
      if (selectedWithinPage < scrollOffset) {
        setScrollOffset(selectedWithinPage);
      } else if (selectedWithinPage >= scrollOffset + maxVisible) {
        setScrollOffset(selectedWithinPage - maxVisible + 1);
      }
    } else {
      // For non-paginated view, normal scrolling
      if (selectedIndex < scrollOffset) {
        setScrollOffset(selectedIndex);
      } else if (selectedIndex >= scrollOffset + maxVisible) {
        setScrollOffset(selectedIndex - maxVisible + 1);
      }
    }
  }, [selectedIndex, maxVisible, view.pagination]);

  // Determine what items to actually display
  let visibleItems: ListItem[];
  let displayStartIndex: number;
  let displayEndIndex: number;
  
  if (view.pagination) {
    // For paginated view, slice the current page then apply scroll
    const pageItems = itemsToRender.slice(view.pagination.startIndex, view.pagination.endIndex);
    visibleItems = pageItems.slice(scrollOffset, scrollOffset + maxVisible);
    displayStartIndex = view.pagination.startIndex + scrollOffset;
    displayEndIndex = Math.min(displayStartIndex + visibleItems.length, view.pagination.endIndex);
  } else {
    // For non-paginated view, just apply scroll
    visibleItems = itemsToRender.slice(scrollOffset, scrollOffset + maxVisible);
    displayStartIndex = scrollOffset;
    displayEndIndex = scrollOffset + visibleItems.length;
  }



  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box borderStyle="single" paddingX={1}>
        <Text>{view.header}</Text>
      </Box>
      
      {/* Pagination info */}
      {view.pagination && (
        <Box borderStyle="single" borderTop={false} paddingX={1}>
          <Text>
            Page {view.pagination.currentPage}/{view.pagination.totalPages} | 
            Items {view.pagination.startIndex + 1}-{view.pagination.endIndex} of {view.items.length}
          </Text>
        </Box>
      )}
      
      {/* Column headers */}
      <Box marginTop={1} flexDirection="row">
        <Box width="12%"><Text>   Time</Text></Box>
        <Box width="12%"><Text>[ Context ]</Text></Box>
        <Box width="30%"><Text>Token Impact</Text></Box>
        <Box width="46%"><Text>Operation & Details</Text></Box>
      </Box>
      <Box>
        <Text>{'─'.repeat(Math.min(columns || 100, 100))}</Text>
      </Box>
      
      {/* Scroll indicator - items above */}
      {displayStartIndex > 0 && (
        <Box>
          <Text color="gray">... ({displayStartIndex} items above)</Text>
        </Box>
      )}
      
      {/* Items */}
      {visibleItems.map((item, index) => {
        const actualIndex = displayStartIndex + index;
        const isSelected = actualIndex === selectedIndex;
        
        return (
          <ListItemRow 
            key={`${item.id}-${actualIndex}`} 
            item={item} 
            isSelected={isSelected}
            terminalColumns={columns}
          />
        );
      })}
      
      {/* Scroll indicator - items below */}
      {displayEndIndex < itemsToRender.length && (
        <Box>
          <Text color="gray">... ({itemsToRender.length - displayEndIndex} items below)</Text>
        </Box>
      )}
      
      {/* Fill empty space if pagination is used */}
      {view.pagination && visibleItems.length < maxVisible && (
        <>
          {Array.from({ length: maxVisible - visibleItems.length }, (_, i) => (
            <Box key={`empty-${i}`} height={1}>
              <Text> </Text>
            </Box>
          ))}
        </>
      )}
      
      {/* Controls */}
      <Box marginTop={1}>
        <Text>{'─'.repeat(80)}</Text>
      </Box>
      <Box>
        <Text>Controls: [↑↓/jk] navigate | [PgUp/PgDn/JK] page | [Enter] select | [Tab] expand | [ESC] back | [q]uit</Text>
      </Box>
      <Box>
        <Text>Sort: [c] conversation | [t] tokens | [o] operation</Text>
      </Box>
    </Box>
  );
}

interface ListItemRowProps {
  item: ListItem;
  isSelected: boolean;
  terminalColumns?: number;
}

function ListItemRow({ item, isSelected, terminalColumns }: ListItemRowProps) {
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
  
  // Calculate column widths based on terminal size
  const maxWidth = Math.min(terminalColumns || 100, 120);
  const timeWidth = Math.floor(maxWidth * 0.12);
  const contextWidth = Math.floor(maxWidth * 0.12);  
  const impactWidth = Math.floor(maxWidth * 0.30);
  const detailsWidth = maxWidth - timeWidth - contextWidth - impactWidth - 2; // -2 for spacing
  
  // Truncate content to fit columns
  const truncateText = (text: string, maxLen: number) => {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 3) + '...';
  };
  
  const timeText = `${cursor}${timeStr}`;
  const contextText = `[${item.subtitle.padStart(8)}]`;
  const impactText = metadataWithIndent;
  const detailsText = titleWithIndent;
  
  return (
    <Box flexDirection="row">
      <Box width={timeWidth}>
        <Text 
          inverse={isSelected}
          wrap="truncate"
        >
          {truncateText(timeText, timeWidth)}
        </Text>
      </Box>
      <Box width={contextWidth}>
        <Text 
          inverse={isSelected}
          wrap="truncate"
        >
          {truncateText(contextText, contextWidth)}
        </Text>
      </Box>
      <Box width={impactWidth}>
        <Text 
          inverse={isSelected}
          wrap="truncate"
        >
          {truncateText(impactText, impactWidth)}
        </Text>
      </Box>
      <Box width={detailsWidth}>
        <Text 
          inverse={isSelected}
          wrap="truncate"
        >
          {truncateText(detailsText, detailsWidth)}
        </Text>
      </Box>
    </Box>
  );
}