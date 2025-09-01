import { getCurrentTokenCount } from './token-calculator';
import { findJsonlPath, parseJsonl, scanClaudeProjects, JsonlReader } from './jsonl-utils';
import { sessionMetadataCache, messageCountCache } from './file-cache';
import type { JsonlFileInfo } from '../types';

/**
 * Session interface used across the application
 */
import type { Session } from '../types';

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
 * OPTIMIZED: Uses caching to avoid re-processing unchanged files
 */
export async function discoverAllSessions(): Promise<Session[]> {
  // Use secure file scanning from jsonl-utils
  const fileInfos = scanClaudeProjects();
  
  const sessions: Session[] = [];
  
  // Process sessions with caching for better performance
  const sessionPromises = fileInfos.map(async (fileInfo) => {
    const project = extractProjectName({ projectDir: fileInfo.projectDir });
    const isActive = isSessionActive({ lastModified: fileInfo.lastModified });
    
    // Use cached token count to avoid re-reading unchanged files
    const tokens = await getCurrentTokenCount(fileInfo.filePath);
    
    return {
      id: fileInfo.sessionId,
      project,
      tokens,
      lastModified: fileInfo.lastModified,
      isActive,
      path: fileInfo.filePath
    };
  });
  
  // Process all sessions in parallel for better performance
  const allSessions = await Promise.all(sessionPromises);
  
  // Sort by last modified, most recent first
  return allSessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

/**
 * Get count of messages with usage data for a specific session
 * Uses secure file finding from jsonl-utils
 * OPTIMIZED: Uses caching to avoid re-reading unchanged files
 */
export async function getAssistantMessageCount({ sessionId }: { sessionId: string }): Promise<number> {
  const jsonlPath = findJsonlPath(sessionId);
  if (!jsonlPath) return 0;
  
  // Use cache to avoid re-reading unchanged files
  return await messageCountCache.get({
    key: `message-count:${sessionId}`,
    filePath: jsonlPath,
    computeFn: async () => {
      // Use streaming to count messages efficiently
      let count = 0;
      await JsonlReader.streamMessages(jsonlPath, (msg) => {
        const usage = msg.usage || msg.message?.usage;
        if (usage && (
          usage.input_tokens !== undefined || 
          usage.output_tokens !== undefined || 
          usage.cache_creation_input_tokens !== undefined || 
          usage.cache_read_input_tokens !== undefined
        )) {
          count++;
        }
        return null;
      });
      return count;
    }
  });
}

/**
 * Synchronous version for backward compatibility with existing tests
 * @deprecated Use getAssistantMessageCount instead for better performance
 */
export function getAssistantMessageCountSync({ sessionId }: { sessionId: string }): number {
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