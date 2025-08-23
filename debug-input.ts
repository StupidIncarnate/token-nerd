#!/usr/bin/env -S npx tsx

import * as fs from 'fs';

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    input += chunk;
  });

  process.stdin.on('end', () => {
    const timestamp = Date.now();
    const logData = {
      timestamp,
      raw: input,
      parsed: null,
      parseError: null
    };

    try {
      logData.parsed = JSON.parse(input);
    } catch (e) {
      logData.parseError = e.message;
    }

    const hookType = (logData.parsed as any)?.hook_event_name === 'PreToolUse' ? 'PRE' : 'POST';
    const logFile = `/tmp/claude-hook-${hookType}-debug-${timestamp}.json`;
    fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
    
    console.log(input); // Still pass through the original input
    process.exit(0);
  });
}

main();