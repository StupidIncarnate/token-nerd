#!/usr/bin/env -S npx tsx

import * as fs from 'fs';
import { execSync } from 'child_process';

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    input += chunk;
  });

  process.stdin.on('end', () => {
    const timestamp = Date.now();
    const parsed = JSON.parse(input);
    const hookType = parsed.hook_event_name === 'PreToolUse' ? 'PRE' : 'POST';
    const transcriptPath = parsed.transcript_path;
    
    // Count lines in JSONL file
    let lineCount = 0;
    try {
      const result = execSync(`wc -l "${transcriptPath}"`, { encoding: 'utf8' });
      lineCount = parseInt(result.split(' ')[0]);
    } catch (error) {
      lineCount = -1;
    }

    const logData = {
      hook_type: hookType,
      timestamp,
      tool_name: parsed.tool_name,
      jsonl_line_count: lineCount,
      session_id: parsed.session_id
    };

    const logFile = `/tmp/timing-${hookType}-${timestamp}.json`;
    fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
    
    console.log(input); // Pass through
    process.exit(0);
  });
}

main();