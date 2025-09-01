import { getCurrentTokenCount } from './token-calculator';
import { findJsonlPath, parseJsonl, scanClaudeProjects, JsonlFileInfo } from './jsonl-utils';

/**
 * Session interface used across the application
 */
export interface Session {
  id: string;
  project: string;
  tokens: number;
  lastModified: Date;
  isActive: boolean;
  path: string;
}

/**
 * Extract project name from Claude Code directory structure
 */
export function extractProjectName({ projectDir }: { projectDir: string }): string {
  let project = projectDir.replace(/^-/, '').split('-').pop() || 'unknown';
  if (project === 'home') {
    project = 'home';
  }
  return project;
}

/**
 * Check if a session is currently active (modified in last 5 minutes)
 */
export function isSessionActive({ lastModified }: { lastModified: Date }): boolean {
  return (Date.now() - lastModified.getTime()) < 5 * 60 * 1000;
}

/**
 * Centralized function to discover all Claude Code sessions
 * Uses secure file scanning from jsonl-utils
 */
export async function discoverAllSessions(): Promise<Session[]> {
  // Use secure file scanning from jsonl-utils
  const fileInfos = scanClaudeProjects();
  
  const sessions: Session[] = [];
  
  for (const fileInfo of fileInfos) {
    const project = extractProjectName({ projectDir: fileInfo.projectDir });
    const isActive = isSessionActive({ lastModified: fileInfo.lastModified });
    const tokens = await getCurrentTokenCount(fileInfo.filePath);
    
    sessions.push({
      id: fileInfo.sessionId,
      project,
      tokens,
      lastModified: fileInfo.lastModified,
      isActive,
      path: fileInfo.filePath
    });
  }
  
  // Sort by last modified, most recent first
  return sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

/**
 * Get count of messages with usage data for a specific session
 * Uses secure file finding from jsonl-utils
 */
export function getAssistantMessageCount({ sessionId }: { sessionId: string }): number {
  const jsonlPath = findJsonlPath(sessionId);
  if (!jsonlPath) return 0;
  
  const messages = parseJsonl(jsonlPath);
  return messages.filter(msg => 
    msg.usage && (
      msg.usage.input_tokens !== undefined || 
      msg.usage.output_tokens !== undefined || 
      msg.usage.cache_creation_input_tokens !== undefined || 
      msg.usage.cache_read_input_tokens !== undefined
    )
  ).length;
}