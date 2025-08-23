import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface JsonlMessage {
  id: string;
  timestamp: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  content?: any;
}

export function parseJsonl(filePath: string): JsonlMessage[] {
  try {
    const expandedPath = filePath.replace('~', os.homedir());
    if (!fs.existsSync(expandedPath)) {
      return [];
    }
    
    const content = fs.readFileSync(expandedPath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    return lines
      .map(line => {
        try {
          const parsed = JSON.parse(line);
          // Extract usage data - could be at root level or inside message object
          const usage = parsed.usage || parsed.message?.usage;
          const messageId = parsed.message?.id || parsed.id || parsed.uuid;
          
          return {
            id: messageId,
            timestamp: new Date(parsed.timestamp || 0).getTime(),
            usage: usage,
            content: parsed
          } as JsonlMessage;
        } catch (error) {
          return null;
        }
      })
      .filter((msg): msg is JsonlMessage => msg !== null);
  } catch (error) {
    return [];
  }
}

export function findJsonlPath(sessionId: string): string | null {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
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
        if (file.includes(sessionId) && file.endsWith('.jsonl')) {
          return path.join(projectPath, file);
        }
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

export function getAssistantMessageCount(sessionId: string): number {
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