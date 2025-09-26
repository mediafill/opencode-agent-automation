module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'scripts/monitor-dashboard.html',
    '!**/node_modules/**',
    '!**/logs/**',
    '!**/.claude/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  collectCoverage: true,
  moduleNameMapping: {
    '^chart.js$': '<rootDir>/tests/__mocks__/chart.js'
  },
  testEnvironmentOptions: {
    resources: 'usable',
    runScripts: 'dangerously'
  }
};