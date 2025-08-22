#!/usr/bin/env -S npx tsx

import { TokenNerdInstaller } from './src/installers/token-nerd-installer';

async function postInstall() {
  const installer = new TokenNerdInstaller();
  
  try {
    await installer.install();
  } catch (error) {
    console.error('You may need to run the setup manually:');
    console.error('   token-nerd install-mcp');
    console.error('   token-nerd install-hooks');
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  postInstall();
}

export { postInstall };