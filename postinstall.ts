#!/usr/bin/env -S npx tsx

import { TokenNerdInstaller } from './src/installers/token-nerd-installer';

async function postInstall() {
  const installer = new TokenNerdInstaller();
  
  try {
    await installer.install();
  } catch (error) {
    console.error('Installation failed. Please check logs above for details.');
    console.error('You may need to restart Claude Code and try again.');
    console.error('If issues persist, check: https://github.com/anthropics/token-nerd/issues');
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  postInstall();
}

export { postInstall };