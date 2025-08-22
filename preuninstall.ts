#!/usr/bin/env -S npx tsx

import { TokenNerdInstaller } from './src/installers/token-nerd-installer';

async function cleanupInstallation() {
  const installer = new TokenNerdInstaller();
  
  try {
    await installer.uninstall();
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    console.error('Manual cleanup may be needed');
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  cleanupInstallation();
}

export { cleanupInstallation };