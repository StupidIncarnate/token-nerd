#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if we're in development (has src/ directory and no NODE_ENV=production)
const isDevelopment = process.env.NODE_ENV !== 'production' && fs.existsSync(path.join(__dirname, 'src'));

if (isDevelopment) {
  // Development: run TypeScript source directly with tsx
  const tsxPath = path.join(__dirname, 'node_modules', '.bin', 'tsx');
  const cliPath = path.join(__dirname, 'src', 'cli', 'index.ts');
  
  const child = spawn(tsxPath, [cliPath, ...process.argv.slice(2)], {
    stdio: 'inherit'
  });
  
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
} else {
  // Production: import compiled JavaScript  
  await import('./dist/cli/index.js');
}