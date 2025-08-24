#!/usr/bin/env -S npx tsx

import { program } from 'commander';
import { getRealTokenCount } from '../statusline/get-real-tokens';
import { formatTokenCount } from '../statusline/config';
import { selectSession, listSessions } from '../lib/session-tracker';
import { selectSessionWithTreeView } from '../lib/session-tree-view';
import { launchTUI } from '../lib/tui-components';
import * as path from 'path';
import * as os from 'os';

program
  .name('token-nerd')
  .description('Track and analyze token usage in Claude sessions')
  .version('0.1.0');

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
    console.log('📂 Claude Code Session Browser');
    console.log('Navigate with ↑↓ arrows, expand/collapse projects with Enter, select sessions\n');
    
    const selectedSessionId = await selectSessionWithTreeView();
    if (selectedSessionId) {
      console.log(`\n🔍 Analyzing session ${selectedSessionId}...`);
      const jsonlPath = path.join(os.homedir(), '.claude', 'projects', '*', `${selectedSessionId}.jsonl`);
      
      // Find the actual JSONL file path
      const { execSync } = require('child_process');
      let actualJsonlPath: string | undefined;
      try {
        const result = execSync(`find ${path.join(os.homedir(), '.claude', 'projects')} -name "${selectedSessionId}.jsonl" -type f 2>/dev/null | head -1`, { encoding: 'utf8' });
        actualJsonlPath = result.trim() || undefined;
      } catch (error) {
        actualJsonlPath = undefined;
      }
      
      await launchTUI(selectedSessionId, actualJsonlPath);
    }
  });

// Stats command - run claude /context and display session info
program
  .command('stats')
  .description('Show current Claude session statistics and context')
  .action(async () => {
    const { collectContextStats, storeCurrentSnapshot } = await import('../lib/stats-collector');
    
    try {
      console.log('🔍 Fetching Claude session statistics...\n');
      
      const stats = await collectContextStats();
      
      if (!stats) {
        console.error('❌ Could not collect context statistics');
        process.exit(1);
      }
      
      // Parse and display the context stats
      const contextData = JSON.parse(stats.display);
      
      console.log(`📊 Initial context loaded: ${stats.actualTokens.toLocaleString()} tokens`);
      console.log(`🔗 Session ID: ${stats.sessionId}`);
      console.log(`📋 Usage breakdown:`);
      console.log(`   Input tokens: ${contextData.usage.input_tokens || 0}`);
      console.log(`   Cache creation: ${contextData.usage.cache_creation_input_tokens || 0}`);
      console.log(`   Cache read: ${contextData.usage.cache_read_input_tokens || 0}`);
      console.log(`   Output tokens: ${contextData.usage.output_tokens || 0}`);
      
      // Store as current snapshot for future sessions
      await storeCurrentSnapshot(stats);
      console.log(`\n✅ Context snapshot updated in Redis`);
      
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.error('❌ Claude Code not found. Make sure it\'s installed and in your PATH.');
      } else {
        console.error('❌ Error running claude /context:', error.message);
      }
      process.exit(1);
    }
  });



// Statusline command
program
  .option('--statusline', 'Output formatted token count for statusline (reads JSON from stdin)')
  .option('--session <id>', 'Select specific session')
  .option('--current', 'Use current project session')
  .action(async (options) => {
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
        const display = formatTokenCount(tokens.total, { showWarning: false });
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
      
      // Find the actual JSONL file path
      const { execSync } = require('child_process');
      let actualJsonlPath: string | undefined;
      try {
        const result = execSync(`find ${path.join(os.homedir(), '.claude', 'projects')} -name "${options.session}.jsonl" -type f 2>/dev/null | head -1`, { encoding: 'utf8' });
        actualJsonlPath = result.trim() || undefined;
      } catch (error) {
        actualJsonlPath = undefined;
      }
      
      await launchTUI(options.session, actualJsonlPath);
    } else {
      // No session specified - will be handled by default behavior below
      return;
    }
  });

program.parse(process.argv);

// If no command or options specified, show interactive tree view selection
if (!process.argv.slice(2).length) {
  (async () => {
    console.log('📂 Claude Code Session Browser');
    console.log('Navigate with ↑↓ arrows, expand/collapse projects with Enter, select sessions\n');
    
    const selectedSessionId = await selectSessionWithTreeView();
    if (selectedSessionId) {
      console.log(`\n🔍 Analyzing session ${selectedSessionId}...`);
      const jsonlPath = path.join(os.homedir(), '.claude', 'projects', '*', `${selectedSessionId}.jsonl`);
      
      // Find the actual JSONL file path
      const { execSync } = require('child_process');
      let actualJsonlPath: string | undefined;
      try {
        const result = execSync(`find ${path.join(os.homedir(), '.claude', 'projects')} -name "${selectedSessionId}.jsonl" -type f 2>/dev/null | head -1`, { encoding: 'utf8' });
        actualJsonlPath = result.trim() || undefined;
      } catch (error) {
        actualJsonlPath = undefined;
      }
      
      await launchTUI(selectedSessionId, actualJsonlPath);
    }
  })();
}