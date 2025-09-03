import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import * as path from 'path';
import * as os from 'os';
import { discoverAllSessions, extractProjectName } from '../../lib/session-utils';
import type { Session, ProjectNode } from '../../types';

interface SessionTreeViewProps {
  onSelect: (sessionId: string | null) => void;
  highlightFirst?: boolean;
  autoExpandCurrent?: boolean;
}

interface TreeChoice {
  type: 'project' | 'session';
  value: string;
  display: string;
  projectName?: string;
}

// Enhanced project name extraction for tree view
function extractProjectNameForTreeView(projectDir: string): string {
  const cleanDir = projectDir.replace(/^-/, '');
  const homeDir = os.homedir();
  const homeDirName = path.basename(homeDir);
  const homeDirParent = path.basename(path.dirname(homeDir));
  
  const homePattern = `${homeDirParent}-${homeDirName}`;
  const projectsPattern = `${homePattern}-projects-`;
  
  if (cleanDir === homePattern) {
    return 'home';
  } else if (cleanDir.startsWith(projectsPattern)) {
    return cleanDir.replace(projectsPattern, '');
  } else {
    return extractProjectName({ projectDir });
  }
}

export function SessionTreeView({ onSelect, highlightFirst = false, autoExpandCurrent = false }: SessionTreeViewProps) {
  const [projects, setProjects] = useState<Map<string, ProjectNode>>(new Map());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [flatChoices, setFlatChoices] = useState<TreeChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const maxVisible = 15; // Maximum visible items

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      const allSessions = await discoverAllSessions();
      const projectGroups = new Map<string, Session[]>();
      
      for (const session of allSessions) {
        const projectDir = path.basename(path.dirname(session.path));
        const enhancedProjectName = extractProjectNameForTreeView(projectDir);
        
        if (!projectGroups.has(enhancedProjectName)) {
          projectGroups.set(enhancedProjectName, []);
        }
        
        const enhancedSession = { ...session, project: enhancedProjectName };
        projectGroups.get(enhancedProjectName)!.push(enhancedSession);
      }
      
      const newProjects = new Map<string, ProjectNode>();
      for (const [projectName, sessions] of projectGroups) {
        if (sessions.length > 0) {
          newProjects.set(projectName, {
            name: projectName,
            path: path.dirname(sessions[0].path),
            sessions: sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime()),
            isExpanded: autoExpandCurrent ? detectIsCurrentProject(projectName) : false,
            isCurrentProject: detectIsCurrentProject(projectName)
          });
        }
      }
      
      setProjects(newProjects);
    } catch (err) {
      setError(`Failed to load sessions: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [autoExpandCurrent]);

  const detectIsCurrentProject = useCallback((projectName: string): boolean => {
    const currentWorkingDir = process.cwd();
    const projectNameInPath = path.basename(currentWorkingDir);
    
    if (projectNameInPath === projectName) {
      return true;
    }
    
    const pathSegments = currentWorkingDir.split(/[/\\]/).filter(s => s.length > 0);
    if (pathSegments.includes(projectName)) {
      if (projectName === 'home' && projectNameInPath !== 'home') {
        return false;
      }
      return true;
    }
    
    return false;
  }, []);

  const buildFlatChoices = useCallback((): void => {
    const choices: TreeChoice[] = [];
    let firstSessionIndex = -1;

    for (const [projectName, projectNode] of projects) {
      const prefix = projectNode.isExpanded ? '▼' : '▶';
      const highlight = projectNode.isCurrentProject ? ' 📁' : '';
      
      choices.push({
        type: 'project',
        value: `project:${projectName}`,
        display: `${prefix} ${projectName}${highlight} (${projectNode.sessions.length} sessions)`,
        projectName
      });

      if (projectNode.isExpanded) {
        for (let i = 0; i < projectNode.sessions.length; i++) {
          const session = projectNode.sessions[i];
          const isFirst = i === 0 && projectNode.isCurrentProject;
          const statusIcon = session.isActive ? '●' : '○';
          const highlight = isFirst ? ' ⭐' : '';
          
          choices.push({
            type: 'session',
            value: session.id,
            display: `  ${statusIcon} ${session.id.slice(0, 8)} - ${session.tokens.toLocaleString()} tokens${highlight}${session.isActive ? ' [ACTIVE]' : ''}`,
            projectName
          });

          if (isFirst && firstSessionIndex === -1) {
            firstSessionIndex = choices.length - 1;
          }
        }
      }
    }
    
    setFlatChoices(choices);
    
    // Auto-highlight first session in current project if requested
    if (highlightFirst && firstSessionIndex >= 0) {
      setSelectedIndex(firstSessionIndex);
    }
  }, [projects, highlightFirst]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    buildFlatChoices();
  }, [buildFlatChoices]);

  // Handle scroll offset when selection changes
  useEffect(() => {
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= scrollOffset + maxVisible) {
      setScrollOffset(selectedIndex - maxVisible + 1);
    }
  }, [selectedIndex]);

  const handleToggleProject = useCallback((projectName: string): void => {
    const project = projects.get(projectName);
    if (project) {
      const updatedProjects = new Map(projects);
      updatedProjects.set(projectName, {
        ...project,
        isExpanded: !project.isExpanded
      });
      setProjects(updatedProjects);
    }
  }, [projects]);

  const handleSelection = useCallback((choice: TreeChoice): void => {
    if (choice.type === 'project') {
      const projectName = choice.value.replace('project:', '');
      handleToggleProject(projectName);
    } else {
      onSelect(choice.value);
    }
  }, [handleToggleProject, onSelect]);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(Math.min(flatChoices.length - 1, selectedIndex + 1));
    } else if (key.return) {
      if (flatChoices[selectedIndex]) {
        handleSelection(flatChoices[selectedIndex]);
      }
    } else if (key.escape) {
      onSelect(null);
    }
  });

  if (loading) {
    return (
      <Box>
        <Text>Loading sessions...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  if (flatChoices.length === 0) {
    return (
      <Box>
        <Text color="yellow">No Claude Code sessions found</Text>
      </Box>
    );
  }

  const visibleChoices = flatChoices.slice(scrollOffset, scrollOffset + maxVisible);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="blue">Select session (↑↓ to navigate, Enter to select/expand, Esc to cancel):</Text>
      </Box>
      
      {scrollOffset > 0 && (
        <Box>
          <Text color="gray">... ({scrollOffset} items above)</Text>
        </Box>
      )}
      
      {visibleChoices.map((choice, index) => {
        const actualIndex = scrollOffset + index;
        const isSelected = actualIndex === selectedIndex;
        
        return (
          <Box key={`${choice.type}-${choice.value}`}>
            <Text 
              color={isSelected ? 'black' : undefined}
              backgroundColor={isSelected ? 'blue' : undefined}
            >
              {isSelected ? '> ' : '  '}{choice.display}
            </Text>
          </Box>
        );
      })}
      
      {scrollOffset + maxVisible < flatChoices.length && (
        <Box>
          <Text color="gray">... ({flatChoices.length - scrollOffset - maxVisible} items below)</Text>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text color="gray">
          {selectedIndex + 1}/{flatChoices.length} | 
          Projects: {projects.size} | 
          Total sessions: {Array.from(projects.values()).reduce((sum, p) => sum + p.sessions.length, 0)}
        </Text>
      </Box>
    </Box>
  );
}