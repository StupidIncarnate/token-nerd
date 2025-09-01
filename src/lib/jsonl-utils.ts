import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { getClaudeProjectsDir } from './claude-path-resolver';
import { ReverseFileReader } from './reverse-reader';

/**
 * Sanitizes session ID to prevent shell injection attacks
 * Only allows alphanumeric characters, underscores, and hyphens
 */
export function sanitizeSessionId({ sessionId }: { sessionId: string }): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Safely finds a session JSONL file using filesystem APIs instead of shell commands
 * Sanitizes input to prevent injection attacks
 */
export async function findSessionJsonl({ sessionId }: { sessionId: string }): Promise<string | undefined> {
  const sanitizedId = sanitizeSessionId({ sessionId });
  const projectsDir = getClaudeProjectsDir();
  const targetFileName = `${sanitizedId}.jsonl`;
  
  try {
    const entries = await fs.promises.readdir(projectsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          const subEntries = await fs.promises.readdir(path.join(projectsDir, entry.name));
          if (subEntries.includes(targetFileName)) {
            return path.join(projectsDir, entry.name, targetFileName);
          }
        } catch {
          continue;
        }
      }
    }
    
    return undefined;
  } catch {
    return undefined;
  }
}

import type { JsonlMessage, TranscriptMessage, JsonlFileInfo } from '../types';

export class JsonlReader {
  /**
   * Reads all messages from JSONL file synchronously (for smaller files)
   */
  static parseJsonl(filePath: string): JsonlMessage[] {
    try {
      const expandedPath = filePath.replace('~', os.homedir());
      if (!fs.existsSync(expandedPath)) {
        return [];
      }
      
      const content = fs.readFileSync(expandedPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      return lines
        .map(line => this.parseJsonlLine(line))
        .filter((msg): msg is JsonlMessage => msg !== null);
    } catch (error) {
      return [];
    }
  }

  /**
   * Streams through JSONL file and processes each message (for larger files)
   */
  static async streamMessages<T>(
    filePath: string, 
    processor: (msg: TranscriptMessage, lineNumber: number) => T | null
  ): Promise<T[]> {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const results: T[] = [];
    let lineNumber = 0;

    try {
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        lineNumber++;
        if (!line.trim()) continue;
        
        try {
          const msg: TranscriptMessage = JSON.parse(line);
          const result = processor(msg, lineNumber);
          if (result !== null) {
            results.push(result);
          }
        } catch (e) {
          // Skip malformed lines
        }
      }
    } catch (error) {
      // Return partial results if stream fails
    }

    return results;
  }

  /**
   * Reads the last message from JSONL file that matches criteria
   * OPTIMIZED: Uses reverse file reading instead of streaming entire file
   * Falls back to streaming for complex filters or when reverse reading fails
   */
  static async readLastMessage(
    filePath: string,
    filter?: (msg: TranscriptMessage) => boolean
  ): Promise<TranscriptMessage | null> {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      // Try optimized reverse reading first
      if (!filter) {
        // Simple case: just get the last line
        const lastLine = await ReverseFileReader.readLastLine({ filePath });
        if (lastLine) {
          try {
            return JSON.parse(lastLine) as TranscriptMessage;
          } catch {
            // Fall through to streaming approach if parsing fails
          }
        }
      } else {
        // With filter: scan recent lines efficiently
        const recentLines = await ReverseFileReader.readLastLines({ 
          filePath, 
          maxLines: 100 
        });
        
        for (const line of recentLines) {
          try {
            const msg: TranscriptMessage = JSON.parse(line);
            if (filter(msg)) {
              return msg;
            }
          } catch {
            continue;
          }
        }
      }
    } catch (reverseError) {
      // Fall back to original streaming approach if reverse reading fails
    }

    // Fallback: use original streaming approach for compatibility
    let lastMessage: TranscriptMessage | null = null;

    await this.streamMessages(filePath, (msg) => {
      if (!filter || filter(msg)) {
        lastMessage = msg;
      }
      return null;
    });

    return lastMessage;
  }

  /**
   * Helper to parse a single JSONL line consistently
   */
  private static parseJsonlLine(line: string): JsonlMessage | null {
    try {
      const parsed = JSON.parse(line);
      // Extract usage data - could be at root level or inside message object
      const usage = parsed.usage || parsed.message?.usage;
      const messageId = parsed.message?.id || parsed.id || parsed.uuid;
      
      const result: JsonlMessage = {
        id: messageId,
        timestamp: new Date(parsed.timestamp || 0).getTime(),
        usage: usage,
        content: parsed
      };
      
      // Only add isSidechain if it exists in parsed data
      if (parsed.isSidechain !== undefined) {
        result.isSidechain = parsed.isSidechain;
      }
      
      return result;
    } catch (error) {
      return null;
    }
  }
}

export function parseJsonl(filePath: string): JsonlMessage[] {
  return JsonlReader.parseJsonl(filePath);
}

export function findJsonlPath(sessionId: string): string | null {
  try {
    const sanitizedId = sanitizeSessionId({ sessionId });
    const projectsDir = getClaudeProjectsDir();
    if (!fs.existsSync(projectsDir)) {
      return null;
    }

    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const projectDir of projectDirs) {
      const projectPath = path.join(projectsDir, projectDir);
      const files = fs.readdirSync(projectPath);
      
      for (const file of files) {
        if (file.includes(sanitizedId) && file.endsWith('.jsonl')) {
          return path.join(projectPath, file);
        }
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Securely scan Claude projects directory for JSONL files
 * Returns file information with sanitized paths
 */

export function scanClaudeProjects(): JsonlFileInfo[] {
  const projectsDir = getClaudeProjectsDir();
  
  if (!fs.existsSync(projectsDir)) {
    return [];
  }
  
  const files: JsonlFileInfo[] = [];
  
  try {
    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const projectDir of projectDirs) {
      // Sanitize project directory name to prevent path traversal
      const sanitizedProjectDir = projectDir.replace(/[^a-zA-Z0-9_-]/g, '');
      if (sanitizedProjectDir !== projectDir) {
        // Skip directories with suspicious names
        continue;
      }
      
      const projectPath = path.join(projectsDir, projectDir);
      try {
        const projectFiles = fs.readdirSync(projectPath)
          .filter(f => f.endsWith('.jsonl') && !f.endsWith('.save'));
        
        for (const file of projectFiles) {
          const filePath = path.join(projectPath, file);
          const stats = fs.statSync(filePath);
          const sessionId = sanitizeSessionId({ sessionId: path.basename(file, '.jsonl') });
          
          files.push({
            sessionId,
            projectDir,
            filePath,
            lastModified: stats.mtime
          });
        }
      } catch (error) {
        // Skip projects that can't be read (permissions, etc.)
        continue;
      }
    }
  } catch (error) {
    // Return empty array if projects directory can't be read
    return [];
  }
  
  return files;
}

