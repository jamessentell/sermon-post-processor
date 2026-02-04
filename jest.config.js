module.exports = {
  testEnvironment: 'node',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'preload.js',
    'renderer.js'
  ],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: [
    'converter.js',
    'main.js'
  ],
  modulePathIgnorePatterns: [],
  testTimeout: 10000
};