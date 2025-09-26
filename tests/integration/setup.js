const fs = require("fs").promises;
const path = require("path");

global.testTimeout = 30000;

beforeAll(async () => {
  // Set up test directories and cleanup
  const testProjectDir = path.join(__dirname, "fixtures", "test-project");
  await fs.mkdir(testProjectDir, { recursive: true });

  // Store for cleanup
  global.testProjectDir = testProjectDir;
});

afterAll(async () => {
  // Clean up test directories
  if (global.testProjectDir) {
    try {
      await fs.rm(global.testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});
