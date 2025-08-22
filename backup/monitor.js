#!/usr/bin/env node
/**
 * Real-time token monitor for current Claude Code session
 * Watches transcript file for changes and alerts on spikes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { 
  THRESHOLDS, 
  calculateTokenStatus, 
  formatTokenCount, 
  estimateOperationsRemaining,
  isSpike 
} = require('./config');

// Find session transcript
function findTranscript(sessionIdOrPath) {
  // If argument provided, use it
  if (sessionIdOrPath) {
    // Full path provided
    if (sessionIdOrPath.includes('/')) {
      return fs.existsSync(sessionIdOrPath) ? sessionIdOrPath : null;
    }
    // Session ID provided - find it
    try {
      const result = execSync(
        `find ~/.claude/projects -name "${sessionIdOrPath}*.jsonl" | head -1`,
        { encoding: 'utf8', shell: '/bin/bash' }
      );
      return result.trim() || null;
    } catch (e) {
      return null;
    }
  }
  
  // No argument - try to find based on CWD
  const cwd = process.cwd();
  const projectPath = cwd.replace(/\//g, '-');
  
  try {
    // First try: Find session for current project
    let result = execSync(
      `find ~/.claude/projects -path "*${projectPath}*" -name "*.jsonl" -type f -printf '%T@ %p\\n' | sort -nr | head -1 | cut -d' ' -f2-`,
      { encoding: 'utf8', shell: '/bin/bash' }
    );
    
    if (result.trim()) {
      return result.trim();
    }
    
    // Fallback: Most recent session
    console.log('⚠️  No session found for current directory, using most recent session');
    result = execSync(
      `find ~/.claude/projects -name "*.jsonl" -type f -printf '%T@ %p\\n' | sort -nr | head -1 | cut -d' ' -f2-`,
      { encoding: 'utf8', shell: '/bin/bash' }
    );
    return result.trim();
  } catch (e) {
    console.error('Error finding transcript:', e.message);
    return null;
  }
}

// Get token count using our reader
function getTokenCount(transcriptPath) {
  try {
    const result = execSync(
      `DEBUG=1 node ${__dirname}/get-real-tokens.js "${transcriptPath}" 2>&1`,
      { encoding: 'utf8' }
    );
    
    const lines = result.split('\n');
    const totalLine = lines.find(l => l.includes('total:'));
    const tokenData = {};
    
    if (totalLine) {
      // Parse the debug output
      const debugInfo = lines.find(l => l.includes('Token breakdown:'));
      if (debugInfo) {
        const jsonStr = debugInfo.replace('Token breakdown: ', '');
        try {
          return JSON.parse(jsonStr);
        } catch (e) {
          // Fallback to just total
          const total = parseInt(lines[0]);
          return { total, percentage: Math.round((total / 200000) * 100) };
        }
      }
    }
    
    const total = parseInt(lines[0]);
    const status = calculateTokenStatus(total);
    return { 
      total, 
      percentage: status.percentage,
      cacheRead: tokenData.cacheRead,
      output: tokenData.output 
    };
  } catch (e) {
    return { total: 0, percentage: 0 };
  }
}

// Format time
function getTime() {
  return new Date().toLocaleTimeString();
}

// Main monitoring loop
async function monitor() {
  console.log('🔍 Token Nerd Monitor Starting...\n');
  
  const sessionArg = process.argv[2];
  const transcriptPath = findTranscript(sessionArg);
  if (!transcriptPath) {
    console.error('❌ No active session found');
    if (sessionArg) {
      console.error(`Could not find session: ${sessionArg}`);
    }
    console.error('\nUsage:');
    console.error('  node monitor.js              # Monitor session for current directory');
    console.error('  node monitor.js f2e31064     # Monitor specific session by ID');
    console.error('  node monitor.js /path/to/transcript.jsonl  # Monitor specific file');
    process.exit(1);
  }
  
  const sessionId = path.basename(transcriptPath, '.jsonl').substring(0, 8);
  console.log(`📂 Monitoring session: ${sessionId}`);
  console.log(`📄 Transcript: ${transcriptPath}`);
  
  // Show file stats
  const stats = fs.statSync(transcriptPath);
  console.log(`📅 Last modified: ${stats.mtime.toLocaleTimeString()}`);
  console.log(`📏 File size: ${(stats.size / 1024).toFixed(1)} KB\n`);
  
  let lastTokenCount = getTokenCount(transcriptPath);
  const status = calculateTokenStatus(lastTokenCount.total);
  console.log(`📊 Initial state: ${formatTokenCount(lastTokenCount.total)}`);
  console.log(`📍 Limit: ${status.limit.toLocaleString()} tokens`);
  console.log('👀 Watching for changes...\n');
  console.log('─'.repeat(60));
  
  // Watch for changes
  let lastSize = fs.statSync(transcriptPath).size;
  
  setInterval(() => {
    try {
      const currentStats = fs.statSync(transcriptPath);
      const currentSize = currentStats.size;
      
      // Debug output every 10 seconds if VERBOSE env var set
      if (process.env.VERBOSE && Date.now() % 10000 < THRESHOLDS.MONITOR_INTERVAL) {
        console.log(`[DEBUG] Checking... Size: ${currentSize} (was ${lastSize}), Modified: ${currentStats.mtime.toLocaleTimeString()}`);
      }
      
      if (currentSize !== lastSize) {
        lastSize = currentSize;
        
        const currentTokens = getTokenCount(transcriptPath);
        const delta = currentTokens.total - lastTokenCount.total;
        
        if (delta > 0) {
          const time = getTime();
          
          // Determine severity
          let icon = '📝';
          let alert = '';
          
          if (isSpike(delta)) {
            icon = '🚨';
            alert = ' SPIKE!';
          } else if (delta > 5000) {
            icon = '⚠️';
            alert = ' (high)';
          }
          
          // Show update
          console.log(`${icon} [${time}] New message detected${alert}`);
          console.log(`   Token delta: +${delta.toLocaleString()}`);
          
          // Show breakdown if available
          if (currentTokens.cacheRead !== undefined) {
            const cacheGrowth = (currentTokens.cacheRead || 0) - (lastTokenCount.cacheRead || 0);
            const outputGrowth = (currentTokens.output || 0) - (lastTokenCount.output || 0);
            
            console.log(`   ├── Cache read: +${cacheGrowth.toLocaleString()}`);
            console.log(`   └── Output: +${outputGrowth.toLocaleString()}`);
          }
          
          console.log(`   Total: ${currentTokens.total.toLocaleString()} (${currentTokens.percentage}%)`);
          
          // Warnings
          const status = calculateTokenStatus(currentTokens.total);
          if (status.status === 'danger') {
            console.log(`   🔴 WARNING: Only ${status.remainingPercent}% capacity remaining!`);
            const remaining = estimateOperationsRemaining(currentTokens.total, delta || 10000);
            console.log(`   📉 Estimated ${remaining} operations until compaction`);
          } else if (status.status === 'warning') {
            console.log(`   ⚠️  Approaching limit (${status.percentage}% used)`);
          }
          
          console.log('─'.repeat(60));
          
          lastTokenCount = currentTokens;
        }
      }
    } catch (e) {
      // File might be temporarily locked during write
    }
  }, THRESHOLDS.MONITOR_INTERVAL);
  
  // Keep process running
  process.stdin.resume();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Monitor stopped');
    process.exit(0);
  });
}

// Run
monitor().catch(console.error);