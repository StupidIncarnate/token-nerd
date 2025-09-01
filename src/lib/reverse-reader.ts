import * as fs from 'fs';

/**
 * Efficiently read lines from the end of a file without loading entire content
 * Optimizes O(n) operations to O(1) for getting last messages
 */
export class ReverseFileReader {
  private static readonly BUFFER_SIZE = 64 * 1024; // 64KB chunks

  /**
   * Read the last N lines from a file efficiently
   * Returns lines in reverse order (most recent first)
   */
  static async readLastLines({ filePath, maxLines = 1 }: { filePath: string; maxLines?: number }): Promise<string[]> {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    
    if (fileSize === 0) {
      return [];
    }

    const lines: string[] = [];
    let position = fileSize;
    let remainingBuffer = '';
    
    try {
      const fd = fs.openSync(filePath, 'r');
      
      while (position > 0 && lines.length < maxLines) {
        // Calculate chunk size to read
        const chunkSize = Math.min(this.BUFFER_SIZE, position);
        position -= chunkSize;
        
        // Read chunk from current position
        const buffer = Buffer.alloc(chunkSize);
        fs.readSync(fd, buffer, 0, chunkSize, position);
        
        // Convert to string and prepend to remaining buffer
        const chunk = buffer.toString('utf8') + remainingBuffer;
        const chunkLines = chunk.split('\n');
        
        // First element becomes the new remaining buffer (incomplete line)
        remainingBuffer = chunkLines.shift() || '';
        
        // Add complete lines in reverse order
        for (let i = chunkLines.length - 1; i >= 0; i--) {
          const line = chunkLines[i].trim();
          if (line && lines.length < maxLines) {
            lines.push(line);
          }
        }
      }
      
      // Handle remaining buffer (first line of file)
      if (position === 0 && remainingBuffer.trim() && lines.length < maxLines) {
        lines.push(remainingBuffer.trim());
      }
      
      fs.closeSync(fd);
    } catch (error) {
      return [];
    }
    
    return lines;
  }

  /**
   * Get the last line from a file efficiently
   * Optimized for JSONL files where we just need the latest message
   */
  static async readLastLine({ filePath }: { filePath: string }): Promise<string | null> {
    const lines = await this.readLastLines({ filePath, maxLines: 1 });
    return lines.length > 0 ? lines[0] : null;
  }

  /**
   * Find the last line matching a condition without reading entire file
   * Reads lines in reverse until condition is met
   */
  static async findLastLineMatching({ 
    filePath, 
    condition, 
    maxLinesToScan = 100 
  }: { 
    filePath: string; 
    condition: (line: string) => boolean;
    maxLinesToScan?: number;
  }): Promise<string | null> {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    
    if (fileSize === 0) {
      return null;
    }

    let position = fileSize;
    let remainingBuffer = '';
    let linesScanned = 0;
    
    try {
      const fd = fs.openSync(filePath, 'r');
      
      while (position > 0 && linesScanned < maxLinesToScan) {
        // Calculate chunk size to read
        const chunkSize = Math.min(this.BUFFER_SIZE, position);
        position -= chunkSize;
        
        // Read chunk from current position
        const buffer = Buffer.alloc(chunkSize);
        fs.readSync(fd, buffer, 0, chunkSize, position);
        
        // Convert to string and prepend to remaining buffer
        const chunk = buffer.toString('utf8') + remainingBuffer;
        const chunkLines = chunk.split('\n');
        
        // First element becomes the new remaining buffer
        remainingBuffer = chunkLines.shift() || '';
        
        // Check lines in reverse order (most recent first)
        for (let i = chunkLines.length - 1; i >= 0; i--) {
          const line = chunkLines[i].trim();
          if (line) {
            linesScanned++;
            if (condition(line)) {
              fs.closeSync(fd);
              return line;
            }
            if (linesScanned >= maxLinesToScan) {
              break;
            }
          }
        }
      }
      
      // Check remaining buffer (first line of file)
      if (position === 0 && remainingBuffer.trim() && linesScanned < maxLinesToScan) {
        const line = remainingBuffer.trim();
        if (condition(line)) {
          fs.closeSync(fd);
          return line;
        }
      }
      
      fs.closeSync(fd);
    } catch (error) {
      return null;
    }
    
    return null;
  }
}