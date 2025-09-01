import * as path from 'path';
import * as os from 'os';
import inquirer from 'inquirer';
import { discoverAllSessions, extractProjectName } from './session-utils';
import type { Session } from '../types';

// Dynamic project name extraction utility for tree view (enhanced version)
function extractProjectNameForTreeView(projectDir: string): string {
  const cleanDir = projectDir.replace(/^-/, ''); // Remove leading dash
  const homeDir = os.homedir();
  const homeDirName = path.basename(homeDir);
  const homeDirParent = path.basename(path.dirname(homeDir));
  
  // Create dynamic patterns based on actual home directory
  const homePattern = `${homeDirParent}-${homeDirName}`;
  const projectsPattern = `${homePattern}-projects-`;
  
  
  if (cleanDir === homePattern) {
    return 'home';
  } else if (cleanDir.startsWith(projectsPattern)) {
    return cleanDir.replace(projectsPattern, '');
  } else {
    // Fallback: use the basic extraction from session-utils
    return extractProjectName({ projectDir });
  }
}

import type { ProjectNode, TreeViewOptions } from '../types';

export class SessionTreeView {
  private projects: Map<string, ProjectNode> = new Map();
  private currentWorkingDir: string;
  private selectedIndex: number = 0;
  private flatChoices: Array<{ type: 'project' | 'session', value: string, display: string, projectName?: string }> = [];

  constructor() {
    this.currentWorkingDir = process.cwd();
  }

  async initialize(): Promise<void> {
    await this.loadProjects();
    this.detectCurrentProject();
    this.buildFlatChoices();
  }

  private async loadProjects(): Promise<void> {
    // Use centralized session discovery but group by enhanced project names for tree view
    const allSessions = await discoverAllSessions();
    
    // Group sessions by project using enhanced extraction
    const projectGroups = new Map<string, Session[]>();
    
    for (const session of allSessions) {
      // Extract project directory from session path  
      const projectDir = path.basename(path.dirname(session.path));
      const enhancedProjectName = extractProjectNameForTreeView(projectDir);
      
      if (!projectGroups.has(enhancedProjectName)) {
        projectGroups.set(enhancedProjectName, []);
      }
      
      // Update session with enhanced project name
      const enhancedSession = { ...session, project: enhancedProjectName };
      projectGroups.get(enhancedProjectName)!.push(enhancedSession);
    }
    
    // Convert to project nodes
    for (const [projectName, sessions] of projectGroups) {
      if (sessions.length > 0) {
        this.projects.set(projectName, {
          name: projectName,
          path: path.dirname(sessions[0].path),
          sessions: sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime()),
          isExpanded: false,
          isCurrentProject: false
        });
      }
    }
  }

  private detectCurrentProject(): void {
    // Check if current working directory matches any project name
    // Priority: exact directory name match first, then path segments
    
    const projectNameInPath = path.basename(this.currentWorkingDir);
    let bestMatch: { projectName: string; projectNode: ProjectNode; priority: number } | null = null;
    
    for (const [projectName, projectNode] of this.projects) {
      // Priority 1: Exact directory basename match (highest priority)  
      if (projectNameInPath === projectName) {
        bestMatch = { projectName, projectNode, priority: 1 };
        break;
      }
      
      // Priority 2: Project name appears in path segments
      const pathSegments = this.currentWorkingDir.split(/[/\\]/).filter(s => s.length > 0);
      if (pathSegments.includes(projectName)) {
        // Special case: don't match "home" unless we're actually in a directory called "home"
        if (projectName === 'home' && projectNameInPath !== 'home') {
          continue;
        }
        
        if (!bestMatch || bestMatch.priority > 2) {
          bestMatch = { projectName, projectNode, priority: 2 };
        }
      }
    }
    
    if (bestMatch) {
      bestMatch.projectNode.isCurrentProject = true;
      bestMatch.projectNode.isExpanded = true;
    }
  }

  private buildFlatChoices(): void {
    this.flatChoices = [];

    for (const [projectName, projectNode] of this.projects) {
      const prefix = projectNode.isExpanded ? '▼' : '▶';
      const highlight = projectNode.isCurrentProject ? ' 📁' : '';
      
      this.flatChoices.push({
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
          
          this.flatChoices.push({
            type: 'session',
            value: session.id,
            display: `  ${statusIcon} ${session.id.slice(0, 8)} - ${session.tokens.toLocaleString()} tokens${highlight}${session.isActive ? ' [ACTIVE]' : ''}`,
            projectName
          });

          // Auto-highlight first session in current project
          if (isFirst && this.selectedIndex === 0) {
            this.selectedIndex = this.flatChoices.length - 1;
          }
        }
      }
    }
  }

  async selectSession(options: TreeViewOptions = {}): Promise<string | null> {
    if (this.projects.size === 0) {
      console.error('No Claude Code sessions found');
      return null;
    }

    const choices = this.flatChoices.map(choice => ({
      name: choice.display,
      value: choice.value
    }));

    const { selection } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: 'Select session (↑↓ to navigate, Enter to select/expand):',
        choices,
        default: options.highlightFirst && this.selectedIndex > 0 && this.selectedIndex < choices.length ? choices[this.selectedIndex].value : undefined
      }
    ]);

    // Handle project expansion/collapse
    if (selection.startsWith('project:')) {
      const projectName = selection.replace('project:', '');
      const project = this.projects.get(projectName);
      if (project) {
        project.isExpanded = !project.isExpanded;
        this.buildFlatChoices();
        // Recursively show menu again
        return this.selectSession(options);
      }
    }

    return selection;
  }

  getProjectSessions(projectName: string): Session[] {
    const project = this.projects.get(projectName);
    return project ? project.sessions : [];
  }

  getAllSessions(): Session[] {
    const allSessions: Session[] = [];
    for (const project of this.projects.values()) {
      allSessions.push(...project.sessions);
    }
    return allSessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  getProjectNames(): string[] {
    return Array.from(this.projects.keys());
  }

  getCurrentProject(): string | null {
    for (const [projectName, project] of this.projects) {
      if (project.isCurrentProject) {
        return projectName;
      }
    }
    return null;
  }
}

// Convenience function that maintains backward compatibility
export async function selectSessionWithTreeView(): Promise<string | null> {
  const treeView = new SessionTreeView();
  await treeView.initialize();
  return treeView.selectSession({ autoExpandCurrent: true, highlightFirst: true });
}