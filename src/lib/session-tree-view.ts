import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import inquirer from 'inquirer';
import { getCurrentTokenCount } from './token-calculator';

interface Session {
  id: string;
  project: string;
  tokens: number;
  lastModified: Date;
  isActive: boolean;
  path: string;
}

interface ProjectNode {
  name: string;
  path: string;
  sessions: Session[];
  isExpanded: boolean;
  isCurrentProject: boolean;
}

interface TreeViewOptions {
  autoExpandCurrent?: boolean;
  highlightFirst?: boolean;
}

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
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    
    if (!fs.existsSync(projectsDir)) {
      return;
    }

    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const projectDir of projectDirs) {
      const projectPath = path.join(projectsDir, projectDir);
      const sessions = await this.loadSessionsForProject(projectPath, projectDir);
      
      if (sessions.length > 0) {
        // Extract project name from directory name
        // Handle the Claude project directory naming convention more intelligently
        let projectName: string;
        const cleanDir = projectDir.replace(/^-/, ''); // Remove leading dash
        
        if (cleanDir === 'home-brutus-home') {
          // Special case for home directory
          projectName = 'home';
        } else if (cleanDir.startsWith('home-brutus-home-projects-')) {
          // Extract the actual project name after the common prefix
          projectName = cleanDir.replace('home-brutus-home-projects-', '');
        } else {
          // Fallback to original logic for other patterns
          projectName = cleanDir.split('-').pop() || 'unknown';
        }

        this.projects.set(projectName, {
          name: projectName,
          path: projectPath,
          sessions: sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime()),
          isExpanded: false,
          isCurrentProject: false
        });
      }
    }
  }

  private async loadSessionsForProject(projectPath: string, projectDir: string): Promise<Session[]> {
    const sessions: Session[] = [];
    const files = fs.readdirSync(projectPath)
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('.save'));

    for (const file of files) {
      const filePath = path.join(projectPath, file);
      const stats = fs.statSync(filePath);
      const sessionId = path.basename(file, '.jsonl');
      
      // Check if active (modified in last 5 minutes)
      const isActive = (Date.now() - stats.mtime.getTime()) < 5 * 60 * 1000;
      
      // Extract project name from directory name
      // Handle the Claude project directory naming convention more intelligently
      let project: string;
      const cleanDir = projectDir.replace(/^-/, ''); // Remove leading dash
      
      if (cleanDir === 'home-brutus-home') {
        // Special case for home directory
        project = 'home';
      } else if (cleanDir.startsWith('home-brutus-home-projects-')) {
        // Extract the actual project name after the common prefix
        project = cleanDir.replace('home-brutus-home-projects-', '');
      } else {
        // Fallback to original logic for other patterns
        project = cleanDir.split('-').pop() || 'unknown';
      }
      
      // Get accurate token count from JSONL (same method as statusline)
      const tokens = await getCurrentTokenCount(filePath);
      
      sessions.push({
        id: sessionId,
        project,
        tokens,
        lastModified: stats.mtime,
        isActive,
        path: filePath
      });
    }

    return sessions;
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
    let index = 0;

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