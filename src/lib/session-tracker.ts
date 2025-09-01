import inquirer from 'inquirer';
import { discoverAllSessions, Session } from './session-utils';

export async function selectSession(): Promise<string | null> {
  const sessions = await listSessions();
  
  if (sessions.length === 0) {
    console.error('No Claude Code sessions found');
    return null;
  }
  
  const choices = sessions.map(session => ({
    name: `${session.isActive ? '●' : '○'} ${session.id.slice(0, 8)} (${session.project}) - ${session.tokens.toLocaleString()} tokens ${session.isActive ? '[ACTIVE]' : ''}`,
    value: session.id
  }));
  
  const { sessionId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'sessionId',
      message: 'Select session (↑↓ to navigate, Enter to select):',
      choices
    }
  ]);
  
  return sessionId;
}

export async function listSessions(): Promise<Session[]> {
  return discoverAllSessions();
}

