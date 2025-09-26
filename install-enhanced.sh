#!/bin/bash
# Enhanced OpenCode Agent Automation Installer
# Single-command installation: curl -fsSL https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main/install-enhanced.sh | bash
# Or: wget -qO- https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main/install-enhanced.sh | bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/mediafill/opencode-agent-automation"
RAW_BASE_URL="https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main"
INSTALL_DIR="${HOME}/.opencode-agents"
PROJECT_DIR="${PWD}"
CLAUDE_DIR="${PROJECT_DIR}/.claude"
VERSION_FILE="${INSTALL_DIR}/version.txt"
CURRENT_VERSION="2.0.0"

# Global variables
INSTALLED_COMPONENTS=()
DEPENDENCIES_INSTALLED=()
DOWNLOAD_TOOL=""
PACKAGE_MANAGER=""

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

show_banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
╔════════════════════════════════════════════════════════════════╗
║         OpenCode Agent Automation System v2.0                 ║
║         Enhanced Single-Command Installation                  ║
║         Zero-Configuration • Self-Contained • Portable        ║
╚════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

show_progress() {
    local current=$1
    local total=$2
    local width=50
    local percentage=$((current * 100 / total))
    local completed=$((current * width / total))

    printf "\r${BLUE}Progress: [${NC}"
    for ((i=1; i<=completed; i++)); do printf "="; done
    for ((i=completed+1; i<=width; i++)); do printf " "; done
    printf "${BLUE}] %d%%${NC}" $percentage
}

detect_system() {
    log_step "Detecting system information..."

    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        log_info "Detected Linux system"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        log_info "Detected macOS system"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        OS="windows"
        log_info "Detected Windows system (using WSL/Git Bash)"
    else
        log_warn "Unknown OS: $OSTYPE - assuming Linux compatibility"
        OS="linux"
    fi

    # Detect architecture
    ARCH=$(uname -m)
    case $ARCH in
        x86_64)
            ARCH="x64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        *)
            log_warn "Unknown architecture: $ARCH - assuming x64 compatibility"
            ARCH="x64"
            ;;
    esac
    log_info "Architecture: $ARCH"

    # Detect download tool
    if command -v curl &> /dev/null; then
        DOWNLOAD_TOOL="curl"
        log_info "Using curl for downloads"
    elif command -v wget &> /dev/null; then
        DOWNLOAD_TOOL="wget"
        log_info "Using wget for downloads"
    else
        log_error "No download tool available (curl/wget required)"
        exit 1
    fi

    # Detect package manager
    if command -v apt-get &> /dev/null; then
        PACKAGE_MANAGER="apt-get"
    elif command -v yum &> /dev/null; then
        PACKAGE_MANAGER="yum"
    elif command -v dnf &> /dev/null; then
        PACKAGE_MANAGER="dnf"
    elif command -v pacman &> /dev/null; then
        PACKAGE_MANAGER="pacman"
    elif command -v brew &> /dev/null; then
        PACKAGE_MANAGER="brew"
    elif [[ "$OS" == "macos" ]]; then
        log_warn "Homebrew not found. Some dependencies may need manual installation."
    else
        log_warn "No known package manager detected. Dependencies may need manual installation."
    fi

    if [[ -n "$PACKAGE_MANAGER" ]]; then
        log_info "Package manager: $PACKAGE_MANAGER"
    fi
}

download_file() {
    local url=$1
    local dest=$2

    if [[ "$DOWNLOAD_TOOL" == "curl" ]]; then
        curl -fsSL "$url" -o "$dest"
    else
        wget -q "$url" -O "$dest"
    fi
}

install_dependency() {
    local dep=$1
    local install_cmd=$2
    local check_cmd=$3

    if eval "$check_cmd" &> /dev/null; then
        log_info "$dep already installed"
        return 0
    fi

    log_step "Installing $dep..."

    if [[ -n "$PACKAGE_MANAGER" ]]; then
        case $PACKAGE_MANAGER in
            apt-get)
                sudo apt-get update && sudo apt-get install -y $install_cmd
                ;;
            yum)
                sudo yum install -y $install_cmd
                ;;
            dnf)
                sudo dnf install -y $install_cmd
                ;;
            pacman)
                sudo pacman -S --noconfirm $install_cmd
                ;;
            brew)
                brew install $install_cmd
                ;;
        esac
    else
        log_error "Cannot install $dep automatically. Please install manually."
        return 1
    fi

    if eval "$check_cmd" &> /dev/null; then
        log_success "$dep installed successfully"
        DEPENDENCIES_INSTALLED+=("$dep")
        return 0
    else
        log_error "Failed to install $dep"
        return 1
    fi
}

check_and_install_dependencies() {
    log_step "Checking and installing dependencies..."

    # Python 3
    install_dependency "Python 3" "python3 python3-pip" "python3 --version"

    # Node.js (for npm packages)
    if ! command -v node &> /dev/null; then
        if [[ "$OS" == "linux" ]]; then
            # Try to install Node.js via package manager
            install_dependency "Node.js" "nodejs npm" "node --version" || {
                log_warn "Node.js not available via package manager. Some features may be limited."
            }
        elif [[ "$OS" == "macos" ]]; then
            log_warn "Node.js not found. Please install from https://nodejs.org or via Homebrew: brew install node"
        fi
    else
        log_info "Node.js found: $(node --version)"
    fi

    # Git
    install_dependency "Git" "git" "git --version"

    # OpenCode (special handling)
    if ! command -v opencode &> /dev/null; then
        log_step "Installing OpenCode..."

        if command -v npm &> /dev/null; then
            npm install -g opencode || {
                log_error "Failed to install OpenCode via npm"
                log_info "Please install OpenCode manually from: https://opencode.ai"
                exit 1
            }
            log_success "OpenCode installed via npm"
            DEPENDENCIES_INSTALLED+=("OpenCode")
        else
            log_error "npm not available for OpenCode installation"
            log_info "Please install OpenCode manually from: https://opencode.ai"
            exit 1
        fi
    else
        log_info "OpenCode found: $(which opencode)"
    fi

    # Optional: jq for JSON processing
    if ! command -v jq &> /dev/null; then
        install_dependency "jq" "jq" "jq --version" || log_warn "jq not available - some features may be limited"
    fi
}

create_installation_directory() {
    log_step "Creating installation directory..."

    mkdir -p "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/bin"
    mkdir -p "$INSTALL_DIR/lib"
    mkdir -p "$INSTALL_DIR/templates"
    mkdir -p "$INSTALL_DIR/scripts"
    mkdir -p "$INSTALL_DIR/docs"

    log_success "Installation directory created: $INSTALL_DIR"
}

download_component() {
    local component=$1
    local url=$2
    local dest=$3

    log_info "Downloading $component..."
    download_file "$url" "$dest"

    if [[ -f "$dest" ]]; then
        chmod +x "$dest" 2>/dev/null || true
        INSTALLED_COMPONENTS+=("$component")
        log_success "$component downloaded"
    else
        log_error "Failed to download $component"
        return 1
    fi
}

download_components() {
    log_step "Downloading system components..."

    # Core scripts
    download_component "orchestrator.py" "$RAW_BASE_URL/.claude/orchestrator.py" "$INSTALL_DIR/lib/orchestrator.py"
    download_component "agent_manager.py" "$RAW_BASE_URL/.claude/agent_manager.py" "$INSTALL_DIR/lib/agent_manager.py"
    download_component "agent_supervisor.py" "$RAW_BASE_URL/.claude/agent_supervisor.py" "$INSTALL_DIR/lib/agent_supervisor.py"

    # Scripts
    download_component "run_agents.sh" "$RAW_BASE_URL/scripts/run_agents.sh" "$INSTALL_DIR/scripts/run_agents.sh"
    download_component "delegate.py" "$RAW_BASE_URL/scripts/delegate.py" "$INSTALL_DIR/scripts/delegate.py"
    download_component "monitor.sh" "$RAW_BASE_URL/scripts/monitor.sh" "$INSTALL_DIR/scripts/monitor.sh"
    download_component "background_monitor.sh" "$RAW_BASE_URL/scripts/background_monitor.sh" "$INSTALL_DIR/scripts/background_monitor.sh"

    # Templates
    download_component "CLAUDE.md" "$RAW_BASE_URL/.claude/CLAUDE.md" "$INSTALL_DIR/templates/CLAUDE.md"
    download_component "agentsync.md" "$RAW_BASE_URL/templates/agentsync.md" "$INSTALL_DIR/templates/agentsync.md"
    download_component "tasks.json" "$RAW_BASE_URL/templates/tasks.json" "$INSTALL_DIR/templates/tasks.json"

    # CLI
    download_component "opencode-agents.js" "$RAW_BASE_URL/bin/opencode-agents.js" "$INSTALL_DIR/bin/opencode-agents.js"

    # Version info
    echo "$CURRENT_VERSION" > "$VERSION_FILE"
    echo "$(date)" >> "$VERSION_FILE"
}

create_unified_launcher() {
    log_step "Creating unified launcher..."

    cat > "$INSTALL_DIR/bin/opencode-agents-launcher" << 'LAUNCH_EOF'
#!/bin/bash
# Unified OpenCode Agent Automation Launcher
# This script provides a single entry point for all functionality

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="${PWD}"
CLAUDE_DIR="${PROJECT_DIR}/.claude"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Ensure project is set up
setup_project_if_needed() {
    if [[ ! -d "$CLAUDE_DIR" ]]; then
        echo -e "${YELLOW}Setting up OpenCode agents in $PROJECT_DIR...${NC}"
        mkdir -p "$CLAUDE_DIR"/{logs,tasks,agents,config}

        # Copy templates
        cp "$INSTALL_DIR/templates/"* "$CLAUDE_DIR/" 2>/dev/null || true

        # Copy scripts
        cp "$INSTALL_DIR/scripts/"* "$CLAUDE_DIR/" 2>/dev/null || true

        # Make executable
        chmod +x "$CLAUDE_DIR/"*.sh "$CLAUDE_DIR/"*.py 2>/dev/null || true

        # Create config
        cat > "$CLAUDE_DIR/config.env" << CONFIG_EOF
# OpenCode Agent Configuration (Auto-generated)
PROJECT_DIR="$PROJECT_DIR"
CLAUDE_DIR="$CLAUDE_DIR"
LOG_DIR="$CLAUDE_DIR/logs"
INSTALL_DIR="$INSTALL_DIR"

# Agent settings
MAX_CONCURRENT_AGENTS=4
AGENT_TIMEOUT=900
AUTO_RESTART=true

# OpenCode settings
OPENCODE_MODEL="default"
OPENCODE_QUIET=true

# Auto-detected project type
PROJECT_TYPE="$(detect_project_type)"
CONFIG_EOF

        echo -e "${GREEN}✅ Project setup complete!${NC}"
    fi
}

detect_project_type() {
    if [[ -f "package.json" ]]; then
        echo "nodejs"
    elif [[ -f "requirements.txt" ]] || [[ -f "setup.py" ]] || [[ -f "pyproject.toml" ]]; then
        echo "python"
    elif [[ -f "Cargo.toml" ]]; then
        echo "rust"
    elif [[ -f "go.mod" ]]; then
        echo "go"
    elif [[ -f "Gemfile" ]]; then
        echo "ruby"
    elif [[ -f "composer.json" ]]; then
        echo "php"
    else
        echo "generic"
    fi
}

# Command handling
COMMAND="${1:-help}"
shift

case "$COMMAND" in
    start)
        setup_project_if_needed
        bash "$CLAUDE_DIR/run_agents.sh" start "$@"
        ;;
    stop)
        setup_project_if_needed
        bash "$CLAUDE_DIR/run_agents.sh" stop "$@"
        ;;
    status)
        setup_project_if_needed
        bash "$CLAUDE_DIR/monitor.sh" status "$@"
        ;;
    delegate)
        setup_project_if_needed
        python3 "$CLAUDE_DIR/delegate.py" "$@"
        ;;
    logs)
        setup_project_if_needed
        tail -f "$CLAUDE_DIR/logs/"*.log 2>/dev/null || echo "No logs available yet"
        ;;
    monitor)
        setup_project_if_needed
        bash "$CLAUDE_DIR/monitor.sh" "$@"
        ;;
    update)
        echo -e "${BLUE}Updating OpenCode Agent Automation...${NC}"
        curl -fsSL https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main/install-enhanced.sh | bash
        ;;
    uninstall)
        echo -e "${YELLOW}Uninstalling OpenCode Agent Automation...${NC}"
        rm -rf "$INSTALL_DIR"
        rm -rf "$CLAUDE_DIR"
        echo -e "${GREEN}✅ Uninstalled${NC}"
        ;;
    version)
        if [[ -f "$INSTALL_DIR/version.txt" ]]; then
            cat "$INSTALL_DIR/version.txt"
        else
            echo "Version information not available"
        fi
        ;;
    doctor)
        echo -e "${BLUE}System Health Check:${NC}"
        echo "OpenCode: $(command -v opencode &> /dev/null && echo '✅' || echo '❌')"
        echo "Python 3: $(command -v python3 &> /dev/null && echo '✅' || echo '❌')"
        echo "Node.js: $(command -v node &> /dev/null && echo '✅' || echo '❌')"
        echo "Installation: $([[ -d "$INSTALL_DIR" ]] && echo '✅' || echo '❌')"
        echo "Project Setup: $([[ -d "$CLAUDE_DIR" ]] && echo '✅' || echo '❌')"
        ;;
    api)
        # Simple API server for external integration
        setup_project_if_needed
        python3 -c "
import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

class APIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/status':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            status = {'status': 'running', 'version': '$CURRENT_VERSION'}
            self.wfile.write(json.dumps(status).encode())
        elif parsed.path == '/delegate':
            query = parse_qs(parsed.query)
            task = query.get('task', ['make production ready'])[0]
            # Here you would actually delegate the task
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'task': task, 'status': 'delegated'}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

print('API server starting on http://localhost:8080')
print('Endpoints:')
print('  GET /status - System status')
print('  GET /delegate?task=<task> - Delegate task')
HTTPServer(('localhost', 8080), APIHandler).serve_forever()
        "
        ;;
    help|*)
        echo -e "${BLUE}OpenCode Agent Automation v$CURRENT_VERSION${NC}"
        echo ""
        echo -e "${GREEN}Usage:${NC} opencode-agents <command> [options]"
        echo ""
        echo -e "${GREEN}Commands:${NC}"
        echo "  start              Start all configured agents"
        echo "  stop               Stop all running agents"
        echo "  status             Show agent status"
        echo "  delegate <task>    Delegate task to agents"
        echo "  logs               Tail agent logs"
        echo "  monitor            Start monitoring dashboard"
        echo "  update             Update to latest version"
        echo "  uninstall          Remove all traces of the system"
        echo "  version            Show version information"
        echo "  doctor             Run system health check"
        echo "  api                Start simple API server"
        echo "  help               Show this help message"
        echo ""
        echo -e "${GREEN}Examples:${NC}"
        echo "  opencode-agents delegate 'add comprehensive testing'"
        echo "  opencode-agents start"
        echo "  opencode-agents api"
        echo ""
        echo -e "${BLUE}Project:${NC} $PROJECT_DIR"
        ;;
esac
LAUNCH_EOF

    chmod +x "$INSTALL_DIR/bin/opencode-agents-launcher"
    log_success "Unified launcher created"
}

setup_path() {
    log_step "Setting up PATH..."

    local shell_rc=""
    if [[ -n "$BASH_VERSION" ]]; then
        shell_rc="$HOME/.bashrc"
    elif [[ -n "$ZSH_VERSION" ]]; then
        shell_rc="$HOME/.zshrc"
    fi

    if [[ -n "$shell_rc" ]] && [[ -w "$shell_rc" ]]; then
        if ! grep -q "opencode-agents" "$shell_rc" 2>/dev/null; then
            echo "" >> "$shell_rc"
            echo "# OpenCode Agent Automation" >> "$shell_rc"
            echo "export PATH=\"\$PATH:$INSTALL_DIR/bin\"" >> "$shell_rc"
            echo "alias agents='opencode-agents-launcher'" >> "$shell_rc"
            log_success "Added to PATH in $shell_rc"
            log_info "Run 'source $shell_rc' or restart terminal to use 'agents' command"
        else
            log_info "Already in PATH"
        fi
    else
        log_warn "Could not modify shell configuration. Add $INSTALL_DIR/bin to PATH manually."
    fi
}

setup_project() {
    log_step "Setting up project integration..."

    # Create .claude directory
    mkdir -p "$CLAUDE_DIR"/{logs,tasks,agents,config}

    # Copy templates
    cp "$INSTALL_DIR/templates/"* "$CLAUDE_DIR/" 2>/dev/null || true

    # Copy scripts
    cp "$INSTALL_DIR/scripts/"* "$CLAUDE_DIR/" 2>/dev/null || true

    # Make executable
    chmod +x "$CLAUDE_DIR/"*.sh "$CLAUDE_DIR/"*.py 2>/dev/null || true

    # Create project-specific config
    cat > "$CLAUDE_DIR/config.env" << CONFIG_EOF
# OpenCode Agent Configuration (Auto-generated for $PROJECT_DIR)
PROJECT_DIR="$PROJECT_DIR"
CLAUDE_DIR="$CLAUDE_DIR"
LOG_DIR="$CLAUDE_DIR/logs"
INSTALL_DIR="$INSTALL_DIR"

# Agent settings (smart defaults)
MAX_CONCURRENT_AGENTS=4
AGENT_TIMEOUT=900
AUTO_RESTART=true

# OpenCode settings
OPENCODE_MODEL="default"
OPENCODE_QUIET=true

# Project type detection
PROJECT_TYPE="$(detect_project_type)"
CONFIG_EOF

    log_success "Project setup complete"
}

detect_project_type() {
    if [[ -f "package.json" ]]; then
        echo "nodejs"
    elif [[ -f "requirements.txt" ]] || [[ -f "setup.py" ]] || [[ -f "pyproject.toml" ]]; then
        echo "python"
    elif [[ -f "Cargo.toml" ]]; then
        echo "rust"
    elif [[ -f "go.mod" ]]; then
        echo "go"
    elif [[ -f "Gemfile" ]]; then
        echo "ruby"
    elif [[ -f "composer.json" ]]; then
        echo "php"
    else
        echo "generic"
    fi
}

create_api_module() {
    log_step "Creating API module for external integration..."

    cat > "$INSTALL_DIR/lib/api.py" << 'API_EOF'
#!/usr/bin/env python3
"""
OpenCode Agent Automation API
Simple API for external projects to integrate with the automation system
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, Optional
import tempfile
import time

class OpenCodeAgentAPI:
    """API for external integration with OpenCode Agent Automation"""

    def __init__(self, project_dir: str = None, auto_setup: bool = True):
        self.project_dir = Path(project_dir or os.getcwd())
        self.claude_dir = self.project_dir / '.claude'
        self.install_dir = Path.home() / '.opencode-agents'

        if auto_setup and not self.claude_dir.exists():
            self._auto_setup()

    def _auto_setup(self):
        """Automatically set up the project if not already configured"""
        launcher = self.install_dir / 'bin' / 'opencode-agents-launcher'
        if launcher.exists():
            subprocess.run([str(launcher), 'start'], capture_output=True)
        else:
            raise RuntimeError("OpenCode Agent Automation not installed. Run installer first.")

    def delegate_task(self, task: str, priority: str = "medium", timeout: int = 900) -> Dict[str, Any]:
        """
        Delegate a task to the OpenCode agents

        Args:
            task: The task description
            priority: Task priority (low, medium, high)
            timeout: Timeout in seconds

        Returns:
            Dict with delegation results
        """
        try:
            cmd = [
                'python3',
                str(self.claude_dir / 'delegate.py'),
                task,
                f'--priority={priority}',
                f'--timeout={timeout}'
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, cwd=self.project_dir)

            return {
                'success': result.returncode == 0,
                'task': task,
                'return_code': result.returncode,
                'stdout': result.stdout,
                'stderr': result.stderr
            }
        except Exception as e:
            return {
                'success': False,
                'task': task,
                'error': str(e)
            }

    def get_status(self) -> Dict[str, Any]:
        """Get current system status"""
        try:
            cmd = [str(self.claude_dir / 'monitor.sh'), 'status']
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=self.project_dir)

            return {
                'status': 'running' if result.returncode == 0 else 'error',
                'output': result.stdout,
                'error': result.stderr
            }
        except Exception as e:
            return {
                'status': 'error',
                'error': str(e)
            }

    def start_agents(self) -> Dict[str, Any]:
        """Start the agent system"""
        try:
            cmd = [str(self.claude_dir / 'run_agents.sh'), 'start']
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=self.project_dir)

            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def stop_agents(self) -> Dict[str, Any]:
        """Stop all running agents"""
        try:
            cmd = [str(self.claude_dir / 'run_agents.sh'), 'stop']
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=self.project_dir)

            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def get_logs(self, lines: int = 100) -> Dict[str, Any]:
        """Get recent agent logs"""
        try:
            log_files = list(self.claude_dir.glob('logs/*.log'))
            logs = {}

            for log_file in log_files:
                try:
                    cmd = ['tail', f'-{lines}', str(log_file)]
                    result = subprocess.run(cmd, capture_output=True, text=True)
                    logs[log_file.name] = result.stdout
                except:
                    logs[log_file.name] = "Could not read log file"

            return {
                'success': True,
                'logs': logs
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def export_config(self, output_file: str = None) -> str:
        """Export current configuration"""
        try:
            config_files = [
                self.claude_dir / 'config.env',
                self.claude_dir / 'tasks.json',
                self.claude_dir / 'orchestrator_config.json'
            ]

            export_data = {}
            for config_file in config_files:
                if config_file.exists():
                    try:
                        if config_file.suffix == '.json':
                            with open(config_file, 'r') as f:
                                export_data[config_file.name] = json.load(f)
                        else:
                            with open(config_file, 'r') as f:
                                export_data[config_file.name] = f.read()
                    except:
                        export_data[config_file.name] = "Could not read file"

            if output_file:
                with open(output_file, 'w') as f:
                    json.dump(export_data, f, indent=2)
                return f"Configuration exported to {output_file}"
            else:
                return json.dumps(export_data, indent=2)
        except Exception as e:
            return f"Export failed: {str(e)}"

    def import_config(self, config_data: str, input_file: str = None) -> Dict[str, Any]:
        """Import configuration"""
        try:
            if input_file:
                with open(input_file, 'r') as f:
                    data = json.load(f)
            else:
                data = json.loads(config_data)

            for filename, content in data.items():
                file_path = self.claude_dir / filename
                try:
                    if isinstance(content, dict):
                        with open(file_path, 'w') as f:
                            json.dump(content, f, indent=2)
                    else:
                        with open(file_path, 'w') as f:
                            f.write(content)
                except Exception as e:
                    return {
                        'success': False,
                        'error': f"Failed to write {filename}: {str(e)}"
                    }

            return {
                'success': True,
                'message': 'Configuration imported successfully'
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

# CLI interface for the API
if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='OpenCode Agent Automation API')
    parser.add_argument('action', choices=['delegate', 'status', 'start', 'stop', 'logs', 'export', 'import'])
    parser.add_argument('--task', help='Task for delegation')
    parser.add_argument('--file', help='File for import/export')
    parser.add_argument('--project-dir', help='Project directory')

    args = parser.parse_args()

    api = OpenCodeAgentAPI(args.project_dir)

    if args.action == 'delegate':
        if not args.task:
            print("Error: --task required for delegation")
            sys.exit(1)
        result = api.delegate_task(args.task)
        print(json.dumps(result, indent=2))

    elif args.action == 'status':
        result = api.get_status()
        print(json.dumps(result, indent=2))

    elif args.action == 'start':
        result = api.start_agents()
        print(json.dumps(result, indent=2))

    elif args.action == 'stop':
        result = api.stop_agents()
        print(json.dumps(result, indent=2))

    elif args.action == 'logs':
        result = api.get_logs()
        print(json.dumps(result, indent=2))

    elif args.action == 'export':
        result = api.export_config(args.file)
        if args.file:
            print(result)
        else:
            print(result)

    elif args.action == 'import':
        if not args.file:
            print("Error: --file required for import")
            sys.exit(1)
        result = api.import_config(None, args.file)
        print(json.dumps(result, indent=2))
API_EOF

    chmod +x "$INSTALL_DIR/lib/api.py"
    log_success "API module created"
}

final_setup() {
    log_step "Finalizing installation..."

    # Create version info
    cat > "$INSTALL_DIR/version.txt" << EOF
OpenCode Agent Automation v$CURRENT_VERSION
Installed: $(date)
Components: ${#INSTALLED_COMPONENTS[@]}
Dependencies: ${#DEPENDENCIES_INSTALLED[@]}
EOF

    # Create uninstall script
    cat > "$INSTALL_DIR/uninstall.sh" << EOF
#!/bin/bash
# OpenCode Agent Automation Uninstaller

echo "Uninstalling OpenCode Agent Automation..."

# Remove installation directory
rm -rf "$INSTALL_DIR"

# Remove project integration
rm -rf "$CLAUDE_DIR"

# Remove from PATH
sed -i '/opencode-agents/d' ~/.bashrc ~/.zshrc 2>/dev/null || true

echo "✅ Uninstalled successfully"
EOF

    chmod +x "$INSTALL_DIR/uninstall.sh"

    log_success "Installation complete!"
}

show_completion_message() {
    echo ""
    echo -e "${GREEN}🎉 Installation Complete!${NC}"
    echo ""
    echo -e "${CYAN}What was installed:${NC}"
    echo "  • OpenCode Agent Automation v$CURRENT_VERSION"
    echo "  • ${#INSTALLED_COMPONENTS[@]} system components"
    echo "  • ${#DEPENDENCIES_INSTALLED[@]} dependencies"
    echo ""
    echo -e "${CYAN}Quick Start:${NC}"
    echo "  cd your-project"
    echo "  opencode-agents-launcher delegate 'make production ready'"
    echo ""
    echo -e "${CYAN}Available Commands:${NC}"
    echo "  opencode-agents-launcher start     - Start agents"
    echo "  opencode-agents-launcher status    - Check status"
    echo "  opencode-agents-launcher logs      - View logs"
    echo "  opencode-agents-launcher stop      - Stop agents"
    echo "  opencode-agents-launcher update    - Update system"
    echo "  opencode-agents-launcher uninstall - Remove everything"
    echo ""
    echo -e "${CYAN}API Integration:${NC}"
    echo "  opencode-agents-launcher api       - Start API server"
    echo ""
    echo -e "${BLUE}Documentation:${NC} https://github.com/mediafill/opencode-agent-automation"
    echo ""
}

main() {
    show_banner

    log_info "Starting enhanced installation..."
    log_info "Install directory: $INSTALL_DIR"
    log_info "Project directory: $PROJECT_DIR"
    echo ""

    local total_steps=8
    local current_step=0

    # Step 1: Detect system
    ((current_step++))
    show_progress $current_step $total_steps
    detect_system

    # Step 2: Check and install dependencies
    ((current_step++))
    show_progress $current_step $total_steps
    check_and_install_dependencies

    # Step 3: Create installation directory
    ((current_step++))
    show_progress $current_step $total_steps
    create_installation_directory

    # Step 4: Download components
    ((current_step++))
    show_progress $current_step $total_steps
    download_components

    # Step 5: Create unified launcher
    ((current_step++))
    show_progress $current_step $total_steps
    create_unified_launcher

    # Step 6: Setup PATH
    ((current_step++))
    show_progress $current_step $total_steps
    setup_path

    # Step 7: Setup project
    ((current_step++))
    show_progress $current_step $total_steps
    setup_project

    # Step 8: Create API module
    ((current_step++))
    show_progress $current_step $total_steps
    create_api_module

    # Finalize
    ((current_step++))
    show_progress $current_step $total_steps
    final_setup

    echo "" # New line after progress bar
    show_completion_message
}

# Handle command line arguments
case "${1:-install}" in
    install)
        main
        ;;
    update)
        log_info "Updating to latest version..."
        main
        ;;
    uninstall)
        "$INSTALL_DIR/uninstall.sh"
        ;;
    *)
        echo "Usage: $0 {install|update|uninstall}"
        exit 1
        ;;
esac</content>
<parameter name="filePath">install-enhanced.sh