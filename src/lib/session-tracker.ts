import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import inquirer from 'inquirer';
import { getTokenCount } from './token-calculator';

interface Session {
  id: string;
  project: string;
  tokens: number;
  lastModified: Date;
  isActive: boolean;
  path: string;
}

export async function selectSession(): Promise<string | null> {
  const sessions = await listSessions();
  
  if (sessions.length === 0) {
    console.error('No Claude Code sessions found');
    return null;
  }
  
  const choices = sessions.map(session => ({
    name: `${session.isActive ? '●' : '○'} ${session.id.slice(0, 8)} (${session.project}) - ${session.tokens.toLocaleString()} tokens ${session.isActive ? '[ACTIVE]' : ''}`,
    value: session.id
  }));
  
  const { sessionId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'sessionId',
      message: 'Select session (↑↓ to navigate, Enter to select):',
      choices
    }
  ]);
  
  return sessionId;
}

export async function listSessions(): Promise<Session[]> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  
  if (!fs.existsSync(projectsDir)) {
    return [];
  }
  
  const sessions: Session[] = [];
  
  // Scan all subdirectories for .jsonl files
  const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir);
    const files = fs.readdirSync(projectPath)
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('.save'));
    
    for (const file of files) {
      const filePath = path.join(projectPath, file);
      const stats = fs.statSync(filePath);
      const sessionId = path.basename(file, '.jsonl');
      
      // Check if active (modified in last 5 minutes)
      const isActive = (Date.now() - stats.mtime.getTime()) < 5 * 60 * 1000;
      
      // Extract project name from directory name
      let project = projectDir.replace(/^-/, '').split('-').pop() || 'unknown';
      if (project === 'home') {
        project = 'home'; // Keep simple for home directory
      }
      
      // Get accurate token count from JSONL (same method as statusline)
      let tokens = await getTokenCount(filePath);
      
      sessions.push({
        id: sessionId,
        project,
        tokens,
        lastModified: stats.mtime,
        isActive,
        path: filePath
      });
    }
  }
  
  // Sort by last modified, most recent first
  return sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

