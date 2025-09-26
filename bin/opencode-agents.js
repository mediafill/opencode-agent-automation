#!/usr/bin/env node
/**
 * OpenCode Agent Automation CLI
 * NPM executable wrapper for the automation system
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

// Get command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'help';

// Paths
const projectDir = process.cwd();
const claudeDir = path.join(projectDir, '.claude');
const installDir = path.join(__dirname, '..');

// Ensure .claude directory exists
if (!fs.existsSync(claudeDir)) {
  console.log(`${colors.yellow}Setting up OpenCode agents in ${projectDir}...${colors.reset}`);
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'tasks'), { recursive: true });

  // Copy templates
  const templatesDir = path.join(installDir, 'templates');
  const scriptsDir = path.join(installDir, 'scripts');

  try {
    // Copy template files
    fs.copyFileSync(
      path.join(templatesDir, 'agentsync.md'),
      path.join(claudeDir, 'agentsync.md')
    );
    fs.copyFileSync(
      path.join(templatesDir, 'tasks.json'),
      path.join(claudeDir, 'tasks.json')
    );

    // Copy scripts
    fs.copyFileSync(
      path.join(scriptsDir, 'run_agents.sh'),
      path.join(claudeDir, 'run_agents.sh')
    );
    fs.copyFileSync(
      path.join(scriptsDir, 'delegate.py'),
      path.join(claudeDir, 'delegate.py')
    );

    // Make scripts executable
    fs.chmodSync(path.join(claudeDir, 'run_agents.sh'), '755');
    fs.chmodSync(path.join(claudeDir, 'delegate.py'), '755');

    console.log(`${colors.green}✅ Setup complete!${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}Setup failed: ${err.message}${colors.reset}`);
    process.exit(1);
  }
}

// Command handlers
const commands = {
  start: () => {
    console.log(`${colors.green}Starting OpenCode agents...${colors.reset}`);
    const child = spawn('bash', [path.join(claudeDir, 'run_agents.sh'), 'start'], {
      stdio: 'inherit',
      cwd: projectDir
    });
    child.on('exit', (code) => {
      process.exit(code);
    });
  },

  stop: () => {
    console.log(`${colors.yellow}Stopping all agents...${colors.reset}`);
    spawn('pkill', ['-f', 'opencode run'], { stdio: 'inherit' });
    console.log(`${colors.green}Agents stopped${colors.reset}`);
  },

  status: () => {
    console.log(`${colors.blue}Agent Status:${colors.reset}`);
    const ps = spawn('ps', ['aux'], { stdio: 'pipe' });
    const grep = spawn('grep', ['opencode run'], { stdio: ['pipe', 'inherit', 'inherit'] });
    const grepv = spawn('grep', ['-v', 'grep'], { stdio: ['pipe', 'inherit', 'inherit'] });

    ps.stdout.pipe(grep.stdin);
    grep.stdout.pipe(grepv.stdin);

    grepv.on('exit', (code) => {
      if (code !== 0) {
        console.log('No agents currently running');
      }
    });
  },

  delegate: () => {
    const objective = args.slice(1).join(' ') || 'make the application production ready';
    console.log(`${colors.green}Delegating: ${objective}${colors.reset}`);

    const child = spawn('python3', [
      path.join(claudeDir, 'delegate.py'),
      objective
    ], {
      stdio: 'inherit',
      cwd: projectDir
    });

    child.on('exit', (code) => {
      process.exit(code);
    });
  },

  logs: () => {
    const logDir = path.join(claudeDir, 'logs');
    const logFiles = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .map(f => path.join(logDir, f));

    if (logFiles.length === 0) {
      console.log('No log files found');
      return;
    }

    console.log(`${colors.blue}Tailing logs (Ctrl+C to stop)...${colors.reset}`);
    const tail = spawn('tail', ['-f', ...logFiles], {
      stdio: 'inherit'
    });

    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });
  },

  test: () => {
    console.log(`${colors.blue}Testing OpenCode...${colors.reset}`);
    const child = spawn('opencode', ['run', 'Write a hello world Python script'], {
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`${colors.green}✅ OpenCode is working!${colors.reset}`);
      } else {
        console.log(`${colors.red}❌ OpenCode test failed${colors.reset}`);
      }
    });
  },

  help: () => {
    console.log(`
${colors.blue}${colors.bright}OpenCode Agent Automation${colors.reset}

${colors.green}Usage:${colors.reset}
  opencode-agents <command> [options]

${colors.green}Commands:${colors.reset}
  start              Start all configured agents
  stop               Stop all running agents
  status             Show agent status
  delegate [task]    Delegate task to agents (default: "make app production ready")
  logs               Tail agent logs
  test               Test OpenCode installation
  help               Show this help message

${colors.green}Examples:${colors.reset}
  opencode-agents delegate "add comprehensive testing"
  opencode-agents delegate "optimize performance"
  opencode-agents delegate "add security features"

${colors.blue}Project:${colors.reset} ${projectDir}
${colors.blue}Config:${colors.reset}  ${claudeDir}/
    `);
  }
};

// Execute command
if (commands[command]) {
  commands[command]();
} else {
  console.error(`${colors.red}Unknown command: ${command}${colors.reset}`);
  commands.help();
  process.exit(1);
}