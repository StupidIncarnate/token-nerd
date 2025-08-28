import { TokenNerdInstaller } from './token-nerd-installer';

export async function cleanupAll(): Promise<void> {
  const installer = new TokenNerdInstaller();
  await installer.uninstall();
}