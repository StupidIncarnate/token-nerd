module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  testTimeout: 10000,
  maxWorkers: 1,  // Run tests serially to avoid directory conflicts
  forceExit: true // Force Jest to exit after tests complete
};