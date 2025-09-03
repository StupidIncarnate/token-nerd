#!/usr/bin/env -S npx tsx

import { program } from 'commander';
import { getRealTokenCount } from '../entries/statusline/get-real-tokens';
import { formatTokenCount } from '../entries/statusline/config';
import { listSessions } from '../lib/session-tracker';
import { selectSessionWithTreeView } from '../lib/ink-session-tree-wrapper';
import { InkTui } from '../entries/tui/ink-tui';
import { findSessionJsonl } from '../lib/jsonl-utils';

// Import version from package.json
const packageJson = JSON.parse(await import('fs').then(fs => fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')));
import { spawn } from 'child_process';

async function runSessionBrowser(): Promise<void> {
  while (true) {
    const selectedSessionId = await selectSessionWithTreeView();
    if (!selectedSessionId) {
      // User cancelled session selection
      break;
    }
    
    // Find the actual JSONL file path safely
    const actualJsonlPath = await findSessionJsonl({ sessionId: selectedSessionId });
    
    const exitCode = await InkTui({
      sessionId: selectedSessionId, 
      jsonlPath: actualJsonlPath 
    });
    if (exitCode === 2) {
      // Exit code 2 means "go back to session tree" - continue the loop
      console.clear();
      continue;
    } else {
      // Exit code 0 or any other code means we're done
      break;
    }
  }
}

program
  .name('token-nerd')
  .description('Track and analyze token usage in Claude sessions')
  .version(packageJson.version);

// Sessions subcommand - flat list
program
  .command('sessions')
  .description('List all Claude Code sessions (flat view)')
  .action(async () => {
    const sessions = await listSessions();
    
    if (sessions.length === 0) {
      console.log('No Claude Code sessions found in ~/.claude/projects/');
      process.exit(1);
    }
    
    console.log('\nActive Sessions:');
    sessions.forEach((session, i) => {
      const status = session.isActive ? 'ACTIVE NOW' : 
        session.lastModified > new Date(Date.now() - 2 * 60 * 60 * 1000) ? '2 hours ago' : 'older';
      
      console.log(`${i + 1}. ${session.id.slice(0, 8)} (${session.project}) - ${session.tokens.toLocaleString()} tokens - ${status}`);
    });
    
    console.log('\nNext: Run `token-nerd --session=<id>` to analyze specific session');
  });

// Browse command - tree view
program
  .command('browse')
  .description('Browse sessions in tree view by project')
  .action(async () => {
    await runSessionBrowser();
  });

// Cleanup command
program
  .command('cleanup')
  .description('Remove all token-nerd configurations and restore backups')
  .action(async () => {
    const { cleanupAll } = await import('../installers/cleanup');
    await cleanupAll();
    console.log('✅ All token-nerd configurations have been removed');
    console.log('You can now safely uninstall with: npm uninstall -g token-nerd');
  });

// Statusline command
program
  .option('--statusline', 'Output formatted token count for statusline (reads JSON from stdin)')
  .option('--no-colors', 'Disable ANSI color codes in statusline output')
  .option('--session <id>', 'Select specific session')
  .option('--message-id <id>', 'Go directly to detail view for specific message (requires --session)')
  .option('--current', 'Use current project session')
  .option('--cleanup', 'Remove all configurations and exit')
  .action(async (options) => {
    // Handle cleanup mode
    if (options.cleanup) {
      const { cleanupAll } = await import('../installers/cleanup');
      await cleanupAll();
      console.log('✅ All token-nerd configurations have been removed');
      console.log('You can now safely uninstall with: npm uninstall -g token-nerd');
      process.exit(0);
    }

    // Handle statusline mode
    if (options.statusline) {
      try {
        // Read JSON from stdin and extract transcript path
        const input = await new Promise<string>((resolve, reject) => {
          let data = '';
          process.stdin.setEncoding('utf8');
          process.stdin.on('data', chunk => data += chunk);
          process.stdin.on('end', () => resolve(data));
          process.stdin.on('error', reject);
        });
        
        const json = JSON.parse(input);
        const transcriptPath = json.transcript_path;
        
        if (!transcriptPath) {
          console.log('🐿️ No session');
          process.exit(0);
        }
        
        const tokens = await getRealTokenCount(transcriptPath);
        const display = formatTokenCount(tokens.total, { 
          showWarning: false,
          showColors: !options.noColors  // Disable colors if --no-colors flag is used
        });
        console.log(`🐿️  ${display}`);
        process.exit(0);
      } catch (error) {
        console.log('🐿️ Error');
        process.exit(0);
      }
    }
    
    // Session listing/selection mode
    if (options.session) {
      console.log(`🔍 Analyzing session ${options.session}...`);
      
      // Find the actual JSONL file path safely
      const actualJsonlPath = await findSessionJsonl({ sessionId: options.session });
      
      // Parse message ID with optional bracket notation
      let messageId: string | undefined;
      let contentPart: number | undefined;
      
      if (options.messageId) {
        const bracketMatch = options.messageId.match(/^([^[\]]+)(?:\[(\d+)\])?$/);
        if (bracketMatch) {
          messageId = bracketMatch[1];
          contentPart = bracketMatch[2] ? parseInt(bracketMatch[2], 10) : undefined;
        } else {
          console.error(`❌ Invalid message ID format: ${options.messageId}`);
          console.error('Expected format: msg_id or msg_id[N] where N is the content part index');
          process.exit(1);
        }
      }
      
      const exitCode = await InkTui({
        sessionId: options.session, 
        jsonlPath: actualJsonlPath, 
        messageId, 
        contentPart 
      });
      process.exit(exitCode);
    } else {
      // No session specified - will be handled by default behavior below
      return;
    }
  });

program.parse(process.argv);

// If no command or options specified, show interactive tree view selection
if (!process.argv.slice(2).length) {
  (async () => {
    await runSessionBrowser();
  })();
}