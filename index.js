const fs = require('fs');
const path = require('path');

// Check if we're in development (has src/ directory and no NODE_ENV=production)
const isDevelopment = process.env.NODE_ENV !== 'production' && fs.existsSync(path.join(__dirname, 'src'));

if (isDevelopment) {
  // Development: re-export from TypeScript source
  require('tsx/cjs');
  module.exports = require('./src/index.ts');
} else {
  // Production: re-export from compiled JavaScript
  module.exports = require('./dist/index.js');
}