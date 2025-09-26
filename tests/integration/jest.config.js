module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: [
    '**/integration/**/*.test.js',
    '**/integration/**/*.spec.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/setup.js'],
  testTimeout: 30000,
  verbose: true,
  collectCoverage: false
};