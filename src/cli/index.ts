#!/usr/bin/env -S npx tsx

import { program } from 'commander';
import { getRealTokenCount } from '../statusline/get-real-tokens';
import { formatTokenCount } from '../statusline/config';

program
  .name('token-nerd')
  .description('Track and analyze token usage in Claude sessions')
  .version('0.1.0');


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
    
    // Non-statusline mode not implemented yet
    console.log('Interactive mode coming soon...');
    process.exit(0);
  });

program.parse(process.argv);

// If no command or options specified, show help
if (!process.argv.slice(2).length) {
  program.help();
}