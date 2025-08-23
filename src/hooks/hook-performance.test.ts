import { spawn } from 'child_process';
import * as path from 'path';

describe('Hook Performance Tests', () => {
  const PRE_HOOK = path.join(__dirname, 'pre-tool-use.ts');
  const POST_HOOK = path.join(__dirname, 'post-tool-use.ts');

  const testInput = JSON.stringify({
    session_id: 'test-session',
    tool_name: 'TestTool',
    tool_input: { param: 'value' },
    timestamp: Date.now()
  });

  test('pre-hook does not hang indefinitely', async () => {
    const child = spawn('npx', ['tsx', PRE_HOOK], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    child.stdin.write(testInput);
    child.stdin.end();

    // This test will fail if hook hangs like the original for await loop
    const exitPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Pre-hook hung - failed to exit within 1 second'));
      }, 1000);

      child.on('exit', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    await expect(exitPromise).resolves.toBe(true);
  });

  test('post-hook does not hang indefinitely', async () => {
    const testResponse = JSON.stringify({
      session_id: 'test-session', 
      tool_name: 'TestTool',
      tool_response: { result: 'success' },
      timestamp: Date.now()
    });

    const child = spawn('npx', ['tsx', POST_HOOK], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    child.stdin.write(testResponse);
    child.stdin.end();

    // This test will fail if hook hangs like the original for await loop
    const exitPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Post-hook hung - failed to exit within 1 second'));
      }, 1000);

      child.on('exit', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    await expect(exitPromise).resolves.toBe(true);
  });

  test('hooks pass through input correctly', async () => {
    const child = spawn('npx', ['tsx', PRE_HOOK], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    child.stdin.write(testInput);
    child.stdin.end();

    const output = await new Promise<string>((resolve) => {
      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.on('exit', () => {
        resolve(stdout.trim());
      });
    });

    expect(output).toBe(testInput);
  });
});