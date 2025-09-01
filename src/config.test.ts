import { isAutoCompactEnabledSync, getTokenLimitSync, TOKEN_LIMITS } from './config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn()
}));

// Mock os module
jest.mock('os', () => ({
  homedir: jest.fn(() => '/test/home')
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isAutoCompactEnabledSync', () => {
    it('should return true when config file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = isAutoCompactEnabledSync();

      expect(result).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith(expect.stringContaining('.claude.json'));
    });

    it('should return true when autoCompactEnabled is not specified', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{}');

      const result = isAutoCompactEnabledSync();

      expect(result).toBe(true);
    });

    it('should return true when autoCompactEnabled is explicitly true', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{"autoCompactEnabled": true}');

      const result = isAutoCompactEnabledSync();

      expect(result).toBe(true);
    });

    it('should return false when autoCompactEnabled is explicitly false', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{"autoCompactEnabled": false}');

      const result = isAutoCompactEnabledSync();

      expect(result).toBe(false);
    });

    it('should return true when JSON parsing fails', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      const result = isAutoCompactEnabledSync();

      expect(result).toBe(true);
    });

    it('should return true when file reading fails', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = isAutoCompactEnabledSync();

      expect(result).toBe(true);
    });
  });

  describe('getTokenLimitSync', () => {
    it('should return AUTO_COMPACT limit when auto-compact is enabled', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{"autoCompactEnabled": true}');

      const result = getTokenLimitSync();

      expect(result).toBe(TOKEN_LIMITS.AUTO_COMPACT);
    });

    it('should return NO_AUTO_COMPACT limit when auto-compact is disabled', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{"autoCompactEnabled": false}');

      const result = getTokenLimitSync();

      expect(result).toBe(TOKEN_LIMITS.NO_AUTO_COMPACT);
    });

    it('should return AUTO_COMPACT limit by default when config file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getTokenLimitSync();

      expect(result).toBe(TOKEN_LIMITS.AUTO_COMPACT);
    });
  });
});