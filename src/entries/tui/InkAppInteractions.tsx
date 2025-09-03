import {SessionState} from "../../lib/session-state";
import type {Bundle, ListItem, ViewType} from "../../types";
import React, {useEffect, useState} from "react";
import {updateViewForCurrent} from "./view-updater";
import {handleEscapeNavigation, navigateToDetails, navigateToSubAgent} from "./navigation";
import {buildDetailBundleFromItem} from "./bundle-builder";
import {handleDetailViewInput, handleListViewInput, handleSortingInput, Key} from "./input-handlers";
import {useInput} from "ink";
import {InkDetailView} from "./InkDetailView";
import {InkListView} from "./InkListView";

interface InkAppInteractionsProps {
    sessionState: SessionState;
    currentView: ViewType;
    jsonlPath?: string;
    onViewChange: (view: ViewType) => void;
    onExit: (code: number) => void;
}

export function InkAppInteractions({ sessionState, currentView, jsonlPath, onViewChange, onExit }: InkAppInteractionsProps) {
    const [listItems, setListItems] = useState<ListItem[]>([]);
    const [header, setHeader] = useState<string>('');
    const [detailRefresh, setDetailRefresh] = useState(0);

    // Helper function to find bundle from item (standards: <50 lines, single responsibility)
    const findBundleFromItem = (item: ListItem): Bundle | undefined => {
        const state = sessionState.getState();
        const bracketMatch = item.id.match(/^([^[\]]+)(?:\[(\d+)\])?$/);
        if (!bracketMatch) return undefined;

        const messageId = bracketMatch[1];
        return state.bundles.find(b => b.id === messageId);
    };

    // Use focused view updater (standards: delegate to specialized functions)
    const updateView = async (): Promise<void> => {
        const state = sessionState.getState();
        await updateViewForCurrent({
            currentView,
            state,
            jsonlPath,
            setListItems,
            setHeader
        });
    };

    // Handle item selection (standards: <50 lines, delegate to navigation functions)
    const handleSelection = (item: ListItem, index: number): void => {
        if (currentView === 'main') {
            const bundle = findBundleFromItem(item);
            if (!bundle) return;

            if (bundle.isSubAgent) {
                navigateToSubAgent({ bundle, sessionState, onViewChange });
            } else {
                const detailBundle = buildDetailBundleFromItem({ item, bundle, sessionState });
                navigateToDetails({ bundle: detailBundle, sessionState, onViewChange });
            }
        } else if (currentView === 'subAgent') {
            const state = sessionState.getState();
            const subAgentBundle = state.viewingSubAgent!;
            const selectedOp = subAgentBundle.operations[index];

            const detailBundle: Bundle = {
                id: `subagent-op-${selectedOp.timestamp}`,
                timestamp: selectedOp.timestamp,
                operations: [selectedOp],
                totalTokens: selectedOp.tokens
            };

            navigateToDetails({ bundle: detailBundle, sessionState, onViewChange });
        }
    };

    // Focused input handling functions (standards: delegate to specialized handlers)
    const handleListInput = (input: string, key: Key): void => {
        handleListViewInput({
            input,
            key,
            listItems,
            sessionState,
            onNavigate: handleSelection,
            onViewUpdate: updateView
        });
    };

    const handleDetailInput = (input: string, key: Key): void => {
        handleDetailViewInput({
            input,
            key,
            sessionState,
            onScrollChange: () => setDetailRefresh(prev => prev + 1)
        });
    };

    // Update view when state changes
    useEffect(() => {
        updateView();
    }, [sessionState, currentView, jsonlPath]);

    // Consolidated input handling (standards: <50 lines, delegate to focused functions)
    useInput((input, key) => {
        // Global shortcuts
        if (input === 'q' || (key.ctrl && input === 'c')) {
            onExit(0);
            return;
        }

        // Handle ESC with focused navigation function
        if (key.escape) {
            handleEscapeNavigation({ currentView, sessionState, onViewChange, onExit });
            return;
        }

        // Handle sorting with focused function
        if (handleSortingInput({ input, currentView, sessionState, onViewUpdate: updateView })) {
            return;
        }

        // View-specific input handling with focused functions
        switch (currentView) {
            case 'main':
            case 'subAgent':
                handleListInput(input, key);
                break;
            case 'details':
                handleDetailInput(input, key);
                break;
        }
    });

    const state = sessionState.getState();

    if (currentView === 'details') {
        const bundle = state.viewingDetails!;
        return <InkDetailView bundle={bundle} sessionState={sessionState} scrollOffset={state.detailScrollOffset} refreshTrigger={detailRefresh} />;
    }

    const buildListActions = () => {
        switch (currentView) {
            case 'main':
                return {
                    onSelect: (item: any, index: number) => {
                        const bundle = findBundleFromItem(item);
                        if (!bundle) return;

                        if (bundle.isSubAgent) {
                            sessionState.setViewingSubAgent({ bundle });
                            onViewChange('subAgent');
                        } else {
                            const detailBundle = buildDetailBundleFromItem({ item, bundle, sessionState });
                            sessionState.setViewingDetails({ bundle: detailBundle });
                            onViewChange('details');
                        }
                    },
                    onBack: () => onExit(2),
                    onQuit: () => onExit(0),
                    onToggleExpand: (item: any) => sessionState.toggleExpanded({ id: item.id }),
                    onSelectionChange: (newIndex: number) => sessionState.setSelectedIndex({ index: newIndex })
                };
            case 'subAgent':
                return {
                    onSelect: (item: any, index: number) => {
                        const state = sessionState.getState();
                        const subAgentBundle = state.viewingSubAgent!;
                        const selectedOp = subAgentBundle.operations[index];

                        const detailBundle = {
                            id: `subagent-op-${selectedOp.timestamp}`,
                            timestamp: selectedOp.timestamp,
                            operations: [selectedOp],
                            totalTokens: selectedOp.tokens
                        };

                        sessionState.setViewingDetails({ bundle: detailBundle });
                        onViewChange('details');
                    },
                    onBack: () => {
                        sessionState.setViewingSubAgent({ bundle: null });
                        onViewChange('main');
                    },
                    onQuit: () => onExit(0),
                    onSelectionChange: (newIndex: number) => sessionState.setSelectedIndex({ index: newIndex })
                };
            default:
                return {
                    onSelect: () => {},
                    onBack: () => {
                        // Default back navigation - go to main
                        onViewChange('main');
                    },
                    onQuit: () => onExit(0)
                };
        }
    };

    const view = {
        header,
        items: listItems,
        selectedIndex: state.selectedIndex,
        sortMode: state.sortMode,
        sortAscending: state.sortAscending,
        pagination: currentView === 'main' ? {
            currentPage: Math.floor(state.selectedIndex / 20) + 1,
            totalPages: Math.ceil(listItems.length / 20),
            itemsPerPage: 20,
            startIndex: Math.floor(state.selectedIndex / 20) * 20,
            endIndex: Math.min(Math.floor(state.selectedIndex / 20) * 20 + 20, listItems.length)
        } : undefined
    };

    return <InkListView view={view} actions={buildListActions()} />;
}