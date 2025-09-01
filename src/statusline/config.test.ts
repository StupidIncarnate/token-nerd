import { formatTokenCount, calculateTokenStatus } from './config';
import { ANSI_COLORS } from '../config';

// Mock the config module before importing
jest.mock('../config', () => {
  const originalModule = jest.requireActual('../config');
  return {
    ...originalModule,
    getTokenLimit: jest.fn(() => 200000), // Use 200k for test consistency
  };
});

describe('statusline config with colors', () => {
  describe('formatTokenCount', () => {
    it('should not add color for tokens below 75%', () => {
      const result = formatTokenCount(100000); // 50% of 200k
      
      // Should not start with any color codes and should not have reset
      expect(result).not.toMatch(/\x1b\[3[13]m/);
      expect(result).not.toMatch(/\x1b\[0m/); // Should not have reset code
      expect(result).toContain('100,000 (50%)');
    });

    it('should add yellow color for 75-89% usage', () => {
      const result = formatTokenCount(160000); // 80% of 200k
      
      expect(result).toMatch(/^\x1b\[33m/); // Should start with yellow
      expect(result).toMatch(/\x1b\[0m$/); // Should end with reset
      expect(result).toContain('160,000');
      expect(result).toContain('80%');
      expect(result).toContain('⚠️');
    });

    it('should add red color for 90%+ usage', () => {
      const result = formatTokenCount(185000); // 92.5% of 200k
      
      expect(result).toMatch(/^\x1b\[31m/); // Should start with red
      expect(result).toMatch(/\x1b\[0m$/); // Should end with reset
      expect(result).toContain('185,000');
      expect(result).toContain('93%');
      expect(result).toContain('🔴');
    });

    it('should handle showRemaining option with red color', () => {
      const result = formatTokenCount(185000, { showRemaining: true }); // 92.5% of 200k
      
      expect(result).toMatch(/^\x1b\[31m/); // Should start with red
      expect(result).toMatch(/\x1b\[0m$/); // Should end with reset
      expect(result).toContain('7% left!');
    });

    it('should not show color when showWarning is false', () => {
      const result = formatTokenCount(160000, { showWarning: false }); // 80% of 200k
      
      // Should still have color on the numbers but no emoji
      expect(result).toMatch(/^\x1b\[33m/); // Should start with yellow
      expect(result).not.toContain('⚠️');
    });

    it('should not add colors when showColors is false', () => {
      const result = formatTokenCount(160000, { showColors: false }); // 80% of 200k
      
      // Should not have any color codes
      expect(result).not.toMatch(/\x1b\[3[13]m/);
      expect(result).not.toMatch(/\x1b\[0m/);
      expect(result).toBe('160,000 (80% ⚠️)');
    });

    it('should not add colors when showColors is false even for danger level', () => {
      const result = formatTokenCount(185000, { showColors: false }); // 93% of 200k
      
      // Should not have any color codes
      expect(result).not.toMatch(/\x1b\[3[13]m/);
      expect(result).not.toMatch(/\x1b\[0m/);
      expect(result).toBe('185,000 (93% 🔴)');
    });
  });

  describe('calculateTokenStatus', () => {
    it('should set correct status levels', () => {
      // Below warning threshold
      let status = calculateTokenStatus(140000); // 70% of 200k
      expect(status.status).toBe('normal');
      expect(status.emoji).toBe('');

      // Warning level (75-89%)
      status = calculateTokenStatus(160000); // 80% of 200k  
      expect(status.status).toBe('warning');
      expect(status.emoji).toBe('⚠️');

      // Danger level (90%+)
      status = calculateTokenStatus(185000); // 92.5% of 200k
      expect(status.status).toBe('danger');
      expect(status.emoji).toBe('🔴');
    });
  });
});