import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if we're in development (has src/ directory and no NODE_ENV=production)
const isDevelopment = process.env.NODE_ENV !== 'production' && fs.existsSync(path.join(__dirname, 'src'));

if (isDevelopment) {
  // Development: re-export from TypeScript source
  export * from './src/index.ts';
} else {
  // Production: re-export from compiled JavaScript
  export * from './dist/index.js';
}