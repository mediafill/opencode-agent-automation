# Test Coverage Report

## Overview
This project now has test coverage reporting configured with an **80% minimum coverage threshold** across all metrics (statements, branches, functions, and lines).

## Current Coverage Status
- **Statements**: 76.79% (needs improvement to reach 80%)
- **Branches**: 67.98% (needs improvement to reach 80%) 
- **Functions**: 86.25% ✅ (meets requirement)
- **Lines**: 76.68% (needs improvement to reach 80%)

## Available Scripts

### Coverage Commands
```bash
# Run tests with coverage report
npm run test:coverage

# Watch mode with coverage
npm run test:coverage:watch  

# Open coverage report in browser (HTML format)
npm run coverage:open
```

### Standard Test Commands
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Coverage Configuration

### Jest Configuration
Located in `jest.config.js`, the coverage is configured to:

- **Collect from**: JavaScript files in `bin/`, `scripts/`, and `tests/dashboard-functions.js`
- **Exclude**: Test files, mocks, examples, logs, and configuration files
- **Reporters**: Text (console), LCOV, HTML, and JSON summary formats
- **Thresholds**: 80% minimum for statements, branches, functions, and lines

### Coverage Reports Location
- **HTML Report**: `coverage/lcov-report/index.html`
- **LCOV Data**: `coverage/lcov.info`
- **JSON Summary**: `coverage/coverage-summary.json`

## Improving Coverage

### Current Issues
1. **25 failing tests** need to be fixed to improve reliability
2. **Branches coverage (67.98%)** needs the most improvement
3. **Statements (76.79%)** and **Lines (76.68%)** need minor improvements

### Priority Areas for Coverage Improvement
Based on the uncovered lines in `tests/dashboard-functions.js`:

1. **WebSocket error handling** (lines 45, 50-52, 89)
2. **System resource monitoring** (lines 105-127, 132-134)
3. **Chart initialization fallbacks** (lines 157-158, 169-181)
4. **Advanced filtering edge cases** (lines 192-204, 211-212)
5. **CSV export error handling** (lines 1137-1146)

### Recommendations
1. **Fix failing tests first** - This will improve test reliability
2. **Add tests for error scenarios** - Focus on exception handling and edge cases
3. **Test WebSocket connection failures** - Improve branch coverage for network scenarios
4. **Add boundary condition tests** - Test with empty data, invalid inputs
5. **Mock external dependencies** - Ensure URL.createObjectURL and localStorage are properly mocked

## CI/CD Integration
The coverage thresholds will cause builds to fail if coverage drops below 80%. This ensures code quality is maintained as the project evolves.

## Viewing Coverage Reports
1. Run `npm run test:coverage`
2. Open `coverage/lcov-report/index.html` in your browser for detailed coverage visualization
3. Use the JSON summary at `coverage/coverage-summary.json` for programmatic access

## Next Steps
1. Address the failing tests to stabilize the test suite
2. Add tests for the uncovered code paths listed above
3. Consider setting up coverage tracking with services like Codecov or Coveralls
4. Add coverage reporting to CI/CD pipeline