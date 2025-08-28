#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Check if we're in development (has src/ directory and no NODE_ENV=production)
const isDevelopment = process.env.NODE_ENV !== 'production' && require('fs').existsSync(path.join(__dirname, 'src'));

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
  // Production: require compiled JavaScript
  require('./dist/cli/index.js');
}