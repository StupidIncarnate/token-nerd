#!/usr/bin/env node

const { TokenNerdInstaller } = require('./dist/installers/token-nerd-installer.js');

async function preUninstall() {
  const installer = new TokenNerdInstaller();
  
  try {
    await installer.uninstall();
  } catch (error) {
    console.error('Uninstallation encountered issues. Please check logs above for details.');
    console.error('Some cleanup may need to be done manually.');
    // Don't exit with error code as this might prevent uninstallation
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  preUninstall();
}

module.exports = { preUninstall };