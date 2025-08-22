import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock directories for testing
export const TEST_TEMP_DIR = path.join(os.tmpdir(), 'token-nerd-tests');
export const TEST_CLAUDE_DIR = path.join(TEST_TEMP_DIR, '.claude');
export const TEST_CONFIG_DIR = path.join(TEST_TEMP_DIR, '.config', 'claude');
export const TEST_HOOKS_DIR = path.join(TEST_CONFIG_DIR, 'hooks');

// Create test directories - run FIRST 
beforeAll(() => {
  // Clean up any existing test data with retry
  let retries = 3;
  while (retries > 0 && fs.existsSync(TEST_TEMP_DIR)) {
    try {
      fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
      break;
    } catch (error) {
      retries--;
      if (retries === 0) {
        console.warn('Failed to clean up test directory, continuing...');
      }
    }
  }
});

beforeEach(() => {
  // Clear all jest mocks to avoid conflicts
  jest.clearAllMocks();
  jest.restoreAllMocks();
  
  // Clean up any existing test data with retry
  let retries = 3;
  while (retries > 0 && fs.existsSync(TEST_TEMP_DIR)) {
    try {
      fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
      break;
    } catch (error) {
      retries--;
      if (retries === 0) {
        console.warn('Failed to clean up test directory, continuing...');
      }
    }
  }
  
  // Create fresh test directories
  fs.mkdirSync(TEST_CLAUDE_DIR, { recursive: true });
  fs.mkdirSync(TEST_HOOKS_DIR, { recursive: true });
});

// Clean up after tests
afterEach(() => {
  // Best effort cleanup - don't fail if it doesn't work
  try {
    if (fs.existsSync(TEST_TEMP_DIR)) {
      fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    // Ignore cleanup errors
  }
});

// Helper function for test files to create their mock files
export function createMockFiles() {
  // Create mock MCP server file
  const mcpServerPath = path.join(TEST_TEMP_DIR, 'src', 'mcp-server', 'index.ts');
  fs.mkdirSync(path.dirname(mcpServerPath), { recursive: true });
  fs.writeFileSync(mcpServerPath, '// Mock MCP server');
  
  // Create mock hook files
  const hooksPath = path.join(TEST_TEMP_DIR, 'src', 'hooks');
  fs.mkdirSync(hooksPath, { recursive: true });
  fs.writeFileSync(path.join(hooksPath, 'pre-tool-use.ts'), '// Mock pre-hook');
  fs.writeFileSync(path.join(hooksPath, 'post-tool-use.ts'), '// Mock post-hook');
}

// Mock os.homedir to return our test directory
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => TEST_TEMP_DIR
}));