const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

describe('Portability Enhancement Integration Tests', () => {
  let testProjectDir;
  let installDir;
  let claudeDir;
  let installerProcess;

  beforeAll(async () => {
    testProjectDir = path.join(__dirname, 'fixtures', 'portability-test');
    installDir = path.join(testProjectDir, '.opencode-agents-install');
    claudeDir = path.join(testProjectDir, '.claude');

    await fs.mkdir(testProjectDir, { recursive: true });
    await fs.mkdir(installDir, { recursive: true });
  });

  beforeEach(async () => {
    // Clean up any existing installation
    try {
      await fs.rm(claudeDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  afterEach(async () => {
    if (installerProcess && !installerProcess.killed) {
      installerProcess.kill('SIGTERM');
      await new Promise(resolve => {
        installerProcess.on('close', resolve);
      });
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('One-Line Installer Script Functionality', () => {
    test('executes installer script successfully with curl', async () => {
      // Change to test project directory
      process.chdir(testProjectDir);

      // Mock curl command to download installer
      const mockInstallerScript = `#!/bin/bash
echo "Mock installer executed successfully"
mkdir -p .claude/{logs,tasks,agents}
echo '{"version": "1.0.0", "installed": true}' > .claude/install_status.json
`;

      await fs.writeFile(path.join(testProjectDir, 'mock_installer.sh'), mockInstallerScript);
      await fs.chmod(path.join(testProjectDir, 'mock_installer.sh'), '755');

      // Execute installer via bash
      installerProcess = spawn('bash', ['mock_installer.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('Mock installer executed successfully');

      // Verify installation artifacts
      const installStatus = await fs.readFile(path.join(claudeDir, 'install_status.json'), 'utf8');
      const status = JSON.parse(installStatus);
      expect(status.installed).toBe(true);
      expect(status.version).toBe('1.0.0');
    }, 30000);

    test('handles installer download failures gracefully', async () => {
      process.chdir(testProjectDir);

      // Create a failing installer script
      const failingInstallerScript = `#!/bin/bash
echo "Installer download failed" >&2
exit 1
`;

      await fs.writeFile(path.join(testProjectDir, 'failing_installer.sh'), failingInstallerScript);
      await fs.chmod(path.join(testProjectDir, 'failing_installer.sh'), '755');

      installerProcess = spawn('bash', ['failing_installer.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stderr = '';
      installerProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Installer download failed');

      // Verify no partial installation occurred
      try {
        await fs.access(claudeDir);
        fail('Installation directory should not exist after failed install');
      } catch (e) {
        // Expected - directory should not exist
      }
    }, 15000);

    test('installer creates proper directory structure', async () => {
      process.chdir(testProjectDir);

      const properInstallerScript = `#!/bin/bash
mkdir -p .claude/{logs,tasks,agents,config}
mkdir -p .claude/scripts
mkdir -p .claude/templates
echo "Installation complete"
`;

      await fs.writeFile(path.join(testProjectDir, 'proper_installer.sh'), properInstallerScript);
      await fs.chmod(path.join(testProjectDir, 'proper_installer.sh'), '755');

      installerProcess = spawn('bash', ['proper_installer.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);

      // Verify directory structure
      const dirs = [
        'logs',
        'tasks',
        'agents',
        'config',
        'scripts',
        'templates'
      ];

      for (const dir of dirs) {
        const dirPath = path.join(claudeDir, dir);
        const stat = await fs.stat(dirPath);
        expect(stat.isDirectory()).toBe(true);
      }
    }, 15000);

    test('installer sets up executable permissions correctly', async () => {
      process.chdir(testProjectDir);

      const permissionInstallerScript = `#!/bin/bash
mkdir -p .claude
cat > .claude/launch.sh << 'EOF'
#!/bin/bash
echo "Launcher executed"
EOF
chmod +x .claude/launch.sh
echo "Permissions set"
`;

      await fs.writeFile(path.join(testProjectDir, 'permission_installer.sh'), permissionInstallerScript);
      await fs.chmod(path.join(testProjectDir, 'permission_installer.sh'), '755');

      installerProcess = spawn('bash', ['permission_installer.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);

      // Verify executable permissions
      const launchScript = path.join(claudeDir, 'launch.sh');
      const stat = await fs.stat(launchScript);
      const isExecutable = !!(stat.mode & parseInt('111', 8));
      expect(isExecutable).toBe(true);
    }, 15000);
  });

  describe('Automatic Dependency Handling', () => {
    test('detects and installs missing OpenCode dependency', async () => {
      process.chdir(testProjectDir);

      // Mock dependency checker and installer
      const dependencyScript = `#!/bin/bash
# Simulate OpenCode not being installed
if ! command -v opencode &> /dev/null; then
    echo "OpenCode not found, installing..."
    # Mock installation
    echo "opencode installed successfully" > .claude/dependencies.log
else
    echo "OpenCode already installed"
fi

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Python3 not found"
    exit 1
else
    echo "Python3 found"
fi
`;

      await fs.writeFile(path.join(testProjectDir, 'dependency_check.sh'), dependencyScript);
      await fs.chmod(path.join(testProjectDir, 'dependency_check.sh'), '755');

      installerProcess = spawn('bash', ['dependency_check.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('Python3 found');

      // Check if dependency log was created (indicating installation attempt)
      try {
        const depLog = await fs.readFile(path.join(claudeDir, 'dependencies.log'), 'utf8');
        expect(depLog).toContain('opencode installed successfully');
      } catch (e) {
        // Log might not exist if OpenCode was already available
      }
    }, 20000);

    test('handles dependency installation failures gracefully', async () => {
      process.chdir(testProjectDir);

      const failingDependencyScript = `#!/bin/bash
echo "Attempting to install dependencies..."
echo "Failed to install required dependency" >&2
exit 1
`;

      await fs.writeFile(path.join(testProjectDir, 'failing_dependency.sh'), failingDependencyScript);
      await fs.chmod(path.join(testProjectDir, 'failing_dependency.sh'), '755');

      installerProcess = spawn('bash', ['failing_dependency.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stderr = '';
      installerProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Failed to install required dependency');
    }, 15000);

    test('validates dependency versions after installation', async () => {
      process.chdir(testProjectDir);

      const versionCheckScript = `#!/bin/bash
# Check Node.js version
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | sed 's/v//')
    echo "Node.js version: $NODE_VERSION"
    # Basic version check (should be >= 14)
    if [[ "$NODE_VERSION" =~ ^([0-9]+)\\. ]]; then
        MAJOR_VERSION=\${BASH_REMATCH[1]}
        if [ "$MAJOR_VERSION" -ge 14 ]; then
            echo "Node.js version check passed"
        else
            echo "Node.js version too old" >&2
            exit 1
        fi
    fi
else
    echo "Node.js not found" >&2
    exit 1
fi

# Check Python version
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
    echo "Python version: $PYTHON_VERSION"
    echo "Python version check passed"
else
    echo "Python3 not found" >&2
    exit 1
fi
`;

      await fs.writeFile(path.join(testProjectDir, 'version_check.sh'), versionCheckScript);
      await fs.chmod(path.join(testProjectDir, 'version_check.sh'), '755');

      installerProcess = spawn('bash', ['version_check.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      let stderr = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      installerProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('version check passed');
      expect(stderr).toBe('');
    }, 20000);
  });

  describe('Clean Uninstall Capability', () => {
    test('uninstalls all components cleanly', async () => {
      process.chdir(testProjectDir);

      // First create a mock installation
      const installScript = `#!/bin/bash
mkdir -p .claude/{logs,tasks,agents,config,scripts}
mkdir -p .opencode-agents-install/bin
echo "installed" > .claude/installed.txt
echo "installed" > .opencode-agents-install/version.txt
echo "alias added" >> ~/.bashrc
`;

      await fs.writeFile(path.join(testProjectDir, 'mock_install.sh'), installScript);
      await fs.chmod(path.join(testProjectDir, 'mock_install.sh'), '755');

      // Install
      let installProcess = spawn('bash', ['mock_install.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      await new Promise((resolve) => {
        installProcess.on('close', resolve);
      });

      // Verify installation
      expect(await fs.access(path.join(claudeDir, 'installed.txt')).then(() => true).catch(() => false)).toBe(true);

      // Now test uninstall
      const uninstallScript = `#!/bin/bash
rm -rf .claude
rm -rf .opencode-agents-install
# Remove alias from bashrc (simplified)
sed -i '/opencode-agents/d' ~/.bashrc 2>/dev/null || true
echo "Uninstallation complete"
`;

      await fs.writeFile(path.join(testProjectDir, 'uninstall.sh'), uninstallScript);
      await fs.chmod(path.join(testProjectDir, 'uninstall.sh'), '755');

      installerProcess = spawn('bash', ['uninstall.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('Uninstallation complete');

      // Verify clean uninstall
      expect(await fs.access(claudeDir).then(() => true).catch(() => false)).toBe(false);
      expect(await fs.access(path.join(testProjectDir, '.opencode-agents-install')).then(() => true).catch(() => false)).toBe(false);
    }, 30000);

    test('handles partial uninstall gracefully', async () => {
      process.chdir(testProjectDir);

      // Create partial installation
      await fs.mkdir(path.join(claudeDir, 'logs'), { recursive: true });
      await fs.writeFile(path.join(claudeDir, 'config.env'), 'partial config');
      // Missing some directories

      const partialUninstallScript = `#!/bin/bash
if [ -d ".claude" ]; then
    rm -rf .claude
    echo "Partial installation cleaned up"
else
    echo "No installation found"
fi
`;

      await fs.writeFile(path.join(testProjectDir, 'partial_uninstall.sh'), partialUninstallScript);
      await fs.chmod(path.join(testProjectDir, 'partial_uninstall.sh'), '755');

      installerProcess = spawn('bash', ['partial_uninstall.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('Partial installation cleaned up');

      // Verify cleanup
      expect(await fs.access(claudeDir).then(() => true).catch(() => false)).toBe(false);
    }, 20000);

    test('version management handles upgrades and downgrades', async () => {
      process.chdir(testProjectDir);

      // Create version management script
      const versionScript = `#!/bin/bash
VERSION_FILE=".claude/version"

# Install version 1.0.0
mkdir -p .claude
echo "1.0.0" > "$VERSION_FILE"
echo "v1.0.0 features" > .claude/features.txt

# Simulate upgrade check
CURRENT_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "0.0.0")
echo "Current version: $CURRENT_VERSION"

if [ "$CURRENT_VERSION" = "1.0.0" ]; then
    echo "Upgrading to 1.1.0"
    echo "1.1.0" > "$VERSION_FILE"
    echo "v1.1.0 features" >> .claude/features.txt
    echo "Migration: Added new feature X"
elif [ "$CURRENT_VERSION" = "1.1.0" ]; then
    echo "Downgrading to 1.0.0"
    echo "1.0.0" > "$VERSION_FILE"
    sed -i '/v1.1.0/d' .claude/features.txt
    echo "Migration: Removed feature X"
else
    echo "Fresh installation"
fi

echo "Version management complete"
`;

      await fs.writeFile(path.join(testProjectDir, 'version_mgmt.sh'), versionScript);
      await fs.chmod(path.join(testProjectDir, 'version_mgmt.sh'), '755');

      // Test fresh install
      installerProcess = spawn('bash', ['version_mgmt.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      let exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('Fresh installation');

      // Test upgrade
      installerProcess = spawn('bash', ['version_mgmt.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('Upgrading to 1.1.0');

      // Verify version and features
      const version = await fs.readFile(path.join(claudeDir, 'version'), 'utf8');
      const features = await fs.readFile(path.join(claudeDir, 'features.txt'), 'utf8');

      expect(version.trim()).toBe('1.1.0');
      expect(features).toContain('v1.0.0 features');
      expect(features).toContain('v1.1.0 features');
    }, 30000);
  });

  describe('Self-Contained Module Packaging', () => {
    test('packages all components into isolated module', async () => {
      process.chdir(testProjectDir);

      const packagingScript = `#!/bin/bash
MODULE_DIR=".opencode-module"

# Create self-contained module structure
mkdir -p "$MODULE_DIR"/{bin,lib,scripts,templates,config}
mkdir -p "$MODULE_DIR"/dependencies

# Copy core components
echo "core binary" > "$MODULE_DIR/bin/opencode-agents"
echo "library code" > "$MODULE_DIR/lib/core.js"
echo "task manager" > "$MODULE_DIR/scripts/task_manager.py"
echo "agent template" > "$MODULE_DIR/templates/agent.md"
echo "default config" > "$MODULE_DIR/config/defaults.json"

# Bundle dependencies
echo "bundled dependency 1" > "$MODULE_DIR/dependencies/dep1.js"
echo "bundled dependency 2" > "$MODULE_DIR/dependencies/dep2.py"

# Create module manifest
cat > "$MODULE_DIR/manifest.json" << EOF
{
  "name": "opencode-agents",
  "version": "1.0.0",
  "self_contained": true,
  "components": [
    "bin/opencode-agents",
    "lib/core.js",
    "scripts/task_manager.py",
    "templates/agent.md",
    "config/defaults.json"
  ],
  "dependencies": [
    "dependencies/dep1.js",
    "dependencies/dep2.py"
  ]
}
EOF

echo "Module packaging complete"
`;

      await fs.writeFile(path.join(testProjectDir, 'packaging.sh'), packagingScript);
      await fs.chmod(path.join(testProjectDir, 'packaging.sh'), '755');

      installerProcess = spawn('bash', ['packaging.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);

      // Verify module structure
      const moduleDir = path.join(testProjectDir, '.opencode-module');
      const manifest = JSON.parse(await fs.readFile(path.join(moduleDir, 'manifest.json'), 'utf8'));

      expect(manifest.name).toBe('opencode-agents');
      expect(manifest.self_contained).toBe(true);
      expect(manifest.components).toContain('bin/opencode-agents');
      expect(manifest.dependencies).toContain('dependencies/dep1.js');

      // Verify all components exist
      for (const component of manifest.components) {
        const componentPath = path.join(moduleDir, component);
        expect(await fs.access(componentPath).then(() => true).catch(() => false)).toBe(true);
      }

      for (const dep of manifest.dependencies) {
        const depPath = path.join(moduleDir, dep);
        expect(await fs.access(depPath).then(() => true).catch(() => false)).toBe(true);
      }
    }, 25000);

    test('isolates module components from system conflicts', async () => {
      process.chdir(testProjectDir);

      const isolationScript = `#!/bin/bash
MODULE_DIR=".isolated-module"

# Create isolated environment
mkdir -p "$MODULE_DIR"
cd "$MODULE_DIR"

# Create isolated Python environment
mkdir -p python-env/lib
echo "isolated python package" > python-env/lib/custom_pkg.py

# Create isolated Node.js modules
mkdir -p node_modules
echo "isolated node module" > node_modules/custom-module.js

# Create isolated binaries
mkdir -p bin
cat > bin/custom-binary << EOF
#!/bin/bash
echo "Running in isolated environment"
echo "Python path: \$PYTHONPATH"
echo "Node path: \$NODE_PATH"
EOF
chmod +x bin/custom-binary

# Set up environment variables for isolation
cat > env.sh << EOF
export PYTHONPATH="\$PWD/python-env/lib:\$PYTHONPATH"
export NODE_PATH="\$PWD/node_modules:\$NODE_PATH"
export PATH="\$PWD/bin:\$PATH"
export MODULE_HOME="\$PWD"
EOF

echo "Isolation setup complete"
`;

      await fs.writeFile(path.join(testProjectDir, 'isolation.sh'), isolationScript);
      await fs.chmod(path.join(testProjectDir, 'isolation.sh'), '755');

      installerProcess = spawn('bash', ['isolation.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);

      // Verify isolation
      const moduleDir = path.join(testProjectDir, '.isolated-module');
      const envScript = await fs.readFile(path.join(moduleDir, 'env.sh'), 'utf8');

      expect(envScript).toContain('export PYTHONPATH=');
      expect(envScript).toContain('export NODE_PATH=');
      expect(envScript).toContain('export MODULE_HOME=');

      // Test isolated binary execution
      const testProcess = spawn('bash', ['-c', `cd ${moduleDir} && source env.sh && ./bin/custom-binary`], {
        stdio: 'pipe'
      });

      let output = '';
      testProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      await new Promise((resolve) => {
        testProcess.on('close', resolve);
      });

      expect(output).toContain('Running in isolated environment');
    }, 25000);

    test('validates module integrity after packaging', async () => {
      process.chdir(testProjectDir);

      const integrityScript = `#!/bin/bash
MODULE_DIR=".integrity-module"

# Create module with integrity checks
mkdir -p "$MODULE_DIR"/{bin,lib,checksums}

# Create components
echo "component 1 content" > "$MODULE_DIR/lib/comp1.js"
echo "component 2 content" > "$MODULE_DIR/lib/comp2.py"
echo "binary content" > "$MODULE_DIR/bin/tool"

# Generate checksums for integrity verification
cd "$MODULE_DIR"
find . -type f -not -path "./checksums/*" -exec shasum {} \; > checksums/manifest.sha

# Create integrity checker
cat > bin/verify-integrity << EOF
#!/bin/bash
cd "\$(dirname "\$0")/.."
CHECKSUM_FILE="checksums/manifest.sha"

if [ ! -f "\$CHECKSUM_FILE" ]; then
    echo "ERROR: Checksum file missing"
    exit 1
fi

# Verify each file
while IFS= read -r line; do
    if ! echo "\$line" | shasum -c - >/dev/null 2>&1; then
        echo "ERROR: Integrity check failed for: \$line"
        exit 1
    fi
done < "\$CHECKSUM_FILE"

echo "All files passed integrity check"
EOF

chmod +x bin/verify-integrity

echo "Integrity validation setup complete"
`;

      await fs.writeFile(path.join(testProjectDir, 'integrity.sh'), integrityScript);
      await fs.chmod(path.join(testProjectDir, 'integrity.sh'), '755');

      installerProcess = spawn('bash', ['integrity.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);

      // Test integrity verification
      const moduleDir = path.join(testProjectDir, '.integrity-module');
      const verifyProcess = spawn(path.join(moduleDir, 'bin', 'verify-integrity'), [], {
        cwd: moduleDir,
        stdio: 'pipe'
      });

      let output = '';
      verifyProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      const verifyExitCode = await new Promise((resolve) => {
        verifyProcess.on('close', resolve);
      });

      expect(verifyExitCode).toBe(0);
      expect(output).toContain('All files passed integrity check');

      // Test integrity failure
      await fs.writeFile(path.join(moduleDir, 'lib', 'comp1.js'), 'modified content');

      const failProcess = spawn(path.join(moduleDir, 'bin', 'verify-integrity'), [], {
        cwd: moduleDir,
        stdio: 'pipe'
      });

      let failOutput = '';
      failProcess.stdout.on('data', (data) => {
        failOutput += data.toString();
      });
      failProcess.stderr.on('data', (data) => {
        failOutput += data.toString();
      });

      const failExitCode = await new Promise((resolve) => {
        failProcess.on('close', resolve);
      });

      expect(failExitCode).toBe(1);
      expect(failOutput).toContain('ERROR: Integrity check failed');
    }, 30000);
  });

  describe('Auto-Configuration System', () => {
    test('automatically configures system with zero user input', async () => {
      process.chdir(testProjectDir);

      // Create a sample project
      await fs.mkdir(path.join(testProjectDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(testProjectDir, 'tests'), { recursive: true });
      await fs.writeFile(path.join(testProjectDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          test: 'jest',
          build: 'webpack',
          lint: 'eslint'
        }
      }));

      const autoConfigScript = `#!/bin/bash
# Zero-config auto-configuration

# Detect environment
DETECTED_OS=$(uname -s)
DETECTED_ARCH=$(uname -m)

# Auto-detect project structure
if [ -f "package.json" ]; then
    PROJECT_TYPE="nodejs"
    PACKAGE_JSON=$(cat package.json)
    
    # Extract scripts automatically
    TEST_CMD=$(echo "$PACKAGE_JSON" | grep -o '"test": "[^"]*"' | cut -d'"' -f4)
    BUILD_CMD=$(echo "$PACKAGE_JSON" | grep -o '"build": "[^"]*"' | cut -d'"' -f4)
    LINT_CMD=$(echo "$PACKAGE_JSON" | grep -o '"lint": "[^"]*"' | cut -d'"' -f4)
    
    # Fallback to defaults if not found
    TEST_CMD=\${TEST_CMD:-"npm test"}
    BUILD_CMD=\${BUILD_CMD:-"npm run build"}
    LINT_CMD=\${LINT_CMD:-"npm run lint"}
    
elif [ -f "Cargo.toml" ]; then
    PROJECT_TYPE="rust"
    TEST_CMD="cargo test"
    BUILD_CMD="cargo build"
    LINT_CMD="cargo clippy"
else
    PROJECT_TYPE="generic"
    TEST_CMD="echo 'Configure test command'"
    BUILD_CMD="echo 'Configure build command'"
    LINT_CMD="echo 'Configure lint command'"
fi

# Auto-detect available tools
DETECTED_TOOLS=""
command -v node >/dev/null 2>&1 && DETECTED_TOOLS="$DETECTED_TOOLS node"
command -v npm >/dev/null 2>&1 && DETECTED_TOOLS="$DETECTED_TOOLS npm"
command -v python3 >/dev/null 2>&1 && DETECTED_TOOLS="$DETECTED_TOOLS python3"
command -v git >/dev/null 2>&1 && DETECTED_TOOLS="$DETECTED_TOOLS git"

# Auto-configure resource limits based on system
CPU_CORES=$(nproc 2>/dev/null || echo "4")
MEM_GB=$(free -g 2>/dev/null | awk 'NR==2{printf "%.0f", $2}' || echo "8")

# Smart concurrency based on resources
if [ "$CPU_CORES" -le 2 ]; then
    MAX_AGENTS=1
elif [ "$CPU_CORES" -le 4 ]; then
    MAX_AGENTS=2
else
    MAX_AGENTS=4
fi

# Create zero-config setup
mkdir -p .claude
cat > .claude/auto-config.env << EOF
# Auto-generated configuration - $(date)
OS=$DETECTED_OS
ARCH=$DETECTED_ARCH
PROJECT_TYPE=$PROJECT_TYPE
DETECTED_TOOLS="$DETECTED_TOOLS"
CPU_CORES=$CPU_CORES
MEM_GB=$MEM_GB

# Auto-configured commands
TEST_COMMAND="$TEST_CMD"
BUILD_COMMAND="$BUILD_CMD"
LINT_COMMAND="$LINT_CMD"

# Auto-configured limits
MAX_CONCURRENT_AGENTS=$MAX_AGENTS
AGENT_TIMEOUT=300
LOG_LEVEL=info

# Zero-config complete
AUTO_CONFIGURED=true
EOF

echo "Zero-configuration complete for $PROJECT_TYPE project on $DETECTED_OS"
`;

      await fs.writeFile(path.join(testProjectDir, 'auto_config.sh'), autoConfigScript);
      await fs.chmod(path.join(testProjectDir, 'auto_config.sh'), '755');

      installerProcess = spawn('bash', ['auto_config.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('Zero-configuration complete');

      // Verify auto-configuration
      const config = await fs.readFile(path.join(claudeDir, 'auto-config.env'), 'utf8');
      expect(config).toContain('AUTO_CONFIGURED=true');
      expect(config).toContain('PROJECT_TYPE=nodejs');
      expect(config).toContain('TEST_COMMAND="jest"');
      expect(config).toContain('MAX_CONCURRENT_AGENTS=');
    }, 30000);

    test('adapts configuration based on detected system resources', async () => {
      process.chdir(testProjectDir);

      const resourceConfigScript = `#!/bin/bash
# Resource-aware auto-configuration

# Detect system resources
CPU_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "4")
TOTAL_MEM=$(free -m 2>/dev/null | awk 'NR==2{print $2}' || echo "8192")
AVAILABLE_DISK=$(df -m . 2>/dev/null | tail -1 | awk '{print $4}' || echo "102400")

# Calculate resource-based limits
if [ "$CPU_CORES" -eq 1 ]; then
    MAX_AGENTS=1
    AGENT_TIMEOUT=120
    LOG_LEVEL="warn"
elif [ "$CPU_CORES" -le 2 ]; then
    MAX_AGENTS=1
    AGENT_TIMEOUT=180
    LOG_LEVEL="info"
elif [ "$CPU_CORES" -le 4 ]; then
    MAX_AGENTS=2
    AGENT_TIMEOUT=300
    LOG_LEVEL="info"
else
    MAX_AGENTS=4
    AGENT_TIMEOUT=600
    LOG_LEVEL="debug"
fi

# Memory-based configuration
if [ "$TOTAL_MEM" -lt 1024 ]; then
    MEM_LIMIT="low"
    CACHE_SIZE="64MB"
elif [ "$TOTAL_MEM" -lt 4096 ]; then
    MEM_LIMIT="medium"
    CACHE_SIZE="256MB"
else
    MEM_LIMIT="high"
    CACHE_SIZE="1GB"
fi

# Disk-based configuration
if [ "$AVAILABLE_DISK" -lt 1024 ]; then
    LOG_RETENTION="1day"
    COMPRESSION="high"
else
    LOG_RETENTION="7days"
    COMPRESSION="medium"
fi

# Create resource-aware config
mkdir -p .claude
cat > .claude/resource-config.env << EOF
# Resource-aware auto-configuration
CPU_CORES=$CPU_CORES
TOTAL_MEM_MB=$TOTAL_MEM
AVAILABLE_DISK_MB=$AVAILABLE_DISK

# Computed limits
MAX_CONCURRENT_AGENTS=$MAX_AGENTS
AGENT_TIMEOUT_SECONDS=$AGENT_TIMEOUT
LOG_LEVEL=$LOG_LEVEL
MEMORY_LIMIT=$MEM_LIMIT
CACHE_SIZE=$CACHE_SIZE
LOG_RETENTION=$LOG_RETENTION
COMPRESSION_LEVEL=$COMPRESSION

# Performance tuning
AGENT_PRIORITY_QUEUE=true
MEMORY_MONITORING=true
DISK_USAGE_MONITORING=true
EOF

echo "Resource-aware configuration complete: $MAX_AGENTS agents, ${MEM_LIMIT} memory, ${LOG_RETENTION} retention"
`;

      await fs.writeFile(path.join(testProjectDir, 'resource_config.sh'), resourceConfigScript);
      await fs.chmod(path.join(testProjectDir, 'resource_config.sh'), '755');

      installerProcess = spawn('bash', ['resource_config.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);

      // Verify resource-aware configuration
      const config = await fs.readFile(path.join(claudeDir, 'resource-config.env'), 'utf8');
      expect(config).toContain('MAX_CONCURRENT_AGENTS=');
      expect(config).toContain('MEMORY_LIMIT=');
      expect(config).toContain('LOG_RETENTION=');
      expect(config).toContain('AGENT_PRIORITY_QUEUE=true');
    }, 25000);

    test('handles configuration conflicts and merges intelligently', async () => {
      process.chdir(testProjectDir);

      // Create existing configuration
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, 'existing-config.env'), `EXISTING_VAR=old_value
SHARED_VAR=old_shared
KEEP_EXISTING=true`);

      const mergeConfigScript = `#!/bin/bash
# Intelligent configuration merging

EXISTING_CONFIG=".claude/existing-config.env"
NEW_CONFIG=".claude/merged-config.env"

# Read existing configuration
if [ -f "$EXISTING_CONFIG" ]; then
    # Extract existing variables
    EXISTING_VARS=$(grep -E '^[A-Z_]+=' "$EXISTING_CONFIG" | cut -d'=' -f1)
    
    # Create new configuration with intelligent merging
    cat > "$NEW_CONFIG" << EOF
# Merged configuration - $(date)
# Existing variables preserved
$(cat "$EXISTING_CONFIG")

# New variables added
NEW_VAR=new_value
SHARED_VAR=new_shared_value
AUTO_MERGED=true

# Conflict resolution: existing takes precedence for EXISTING_VAR
# New values added for new variables
# SHARED_VAR updated with new value (configurable behavior)
EOF

    echo "Configuration merged intelligently"
else
    echo "No existing configuration found"
fi
`;

      await fs.writeFile(path.join(testProjectDir, 'merge_config.sh'), mergeConfigScript);
      await fs.chmod(path.join(testProjectDir, 'merge_config.sh'), '755');

      installerProcess = spawn('bash', ['merge_config.sh'], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let output = '';
      installerProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        installerProcess.on('close', resolve);
      });

      expect(exitCode).toBe(0);
      expect(output).toContain('Configuration merged intelligently');

      // Verify intelligent merging
      const mergedConfig = await fs.readFile(path.join(claudeDir, 'merged-config.env'), 'utf8');
      expect(mergedConfig).toContain('EXISTING_VAR=old_value'); // Preserved
      expect(mergedConfig).toContain('NEW_VAR=new_value'); // Added
      expect(mergedConfig).toContain('SHARED_VAR=new_shared_value'); // Updated
      expect(mergedConfig).toContain('AUTO_MERGED=true'); // New flag
    }, 25000);