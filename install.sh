#!/bin/bash
# OpenCode Agent Automation Installer
# One-line install: curl -fsSL https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main/install.sh | bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/mediafill/opencode-agent-automation"
INSTALL_DIR="${HOME}/.opencode-agents"
PROJECT_DIR="${PWD}"
CLAUDE_DIR="${PROJECT_DIR}/.claude"

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

# ASCII Art Banner
show_banner() {
    echo -e "${BLUE}"
    cat << 'EOF'
    ╔═══════════════════════════════════════════════════╗
    ║     OpenCode Agent Automation System              ║
    ║     AI-Powered Development Assistant              ║
    ╚═══════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# Check dependencies
check_dependencies() {
    local missing_deps=()

    # Check for OpenCode
    if ! command -v opencode &> /dev/null; then
        missing_deps+=("opencode")
        log_warn "OpenCode not found. Install from: https://opencode.ai"
    else
        log_success "OpenCode found: $(which opencode)"
    fi

    # Check for Claude (optional)
    if ! command -v claude &> /dev/null; then
        log_warn "Claude CLI not found (optional). Install from: https://claude.ai/cli"
    else
        log_success "Claude CLI found: $(which claude)"
    fi

    # Check for Python
    if ! command -v python3 &> /dev/null; then
        missing_deps+=("python3")
    else
        log_success "Python3 found: $(python3 --version)"
    fi

    # Check for Git
    if ! command -v git &> /dev/null; then
        missing_deps+=("git")
    else
        log_success "Git found: $(git --version)"
    fi

    # Check for Node.js (optional for npm install)
    if ! command -v node &> /dev/null; then
        log_warn "Node.js not found (optional for npm install)"
    else
        log_success "Node.js found: $(node --version)"
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        log_info "Please install missing dependencies and run again"
        exit 1
    fi
}

# Download and install from GitHub
install_from_github() {
    log_info "Installing OpenCode Agent Automation..."

    # Create installation directory
    mkdir -p "$INSTALL_DIR"

    # Clone or download repository
    if [ -d "$INSTALL_DIR/.git" ]; then
        log_info "Updating existing installation..."
        cd "$INSTALL_DIR"
        git pull origin main
    else
        log_info "Downloading from GitHub..."
        if command -v git &> /dev/null; then
            git clone "$REPO_URL" "$INSTALL_DIR"
        else
            # Fallback to wget/curl
            mkdir -p "$INSTALL_DIR"
            cd "$INSTALL_DIR"
            if command -v wget &> /dev/null; then
                wget -O - "${REPO_URL}/archive/main.tar.gz" | tar xz --strip-components=1
            elif command -v curl &> /dev/null; then
                curl -L "${REPO_URL}/archive/main.tar.gz" | tar xz --strip-components=1
            else
                log_error "No download tool available (git/wget/curl)"
                exit 1
            fi
        fi
    fi

    # Make scripts executable
    chmod +x "$INSTALL_DIR"/scripts/*.sh
    chmod +x "$INSTALL_DIR"/bin/*

    log_success "Installation complete!"
}

# Setup project integration
setup_project() {
    log_info "Setting up project integration..."

    # Create .claude directory
    mkdir -p "$CLAUDE_DIR"
    mkdir -p "$CLAUDE_DIR/logs"
    mkdir -p "$CLAUDE_DIR/tasks"
    mkdir -p "$CLAUDE_DIR/agents"

    # Copy templates
    cp -n "$INSTALL_DIR/templates/agentsync.md" "$CLAUDE_DIR/" 2>/dev/null || true
    cp -n "$INSTALL_DIR/templates/tasks.json" "$CLAUDE_DIR/" 2>/dev/null || true
    
    # Handle CLAUDE.md specially - merge with existing if present
    if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
        log_info "Existing CLAUDE.md found, appending automation system documentation..."
        echo "" >> "$CLAUDE_DIR/CLAUDE.md"
        echo "# ===== OpenCode Agent Automation System Documentation =====" >> "$CLAUDE_DIR/CLAUDE.md"
        echo "# Added by installer on $(date)" >> "$CLAUDE_DIR/CLAUDE.md"
        echo "" >> "$CLAUDE_DIR/CLAUDE.md"
        cat "$INSTALL_DIR/.claude/CLAUDE.md" >> "$CLAUDE_DIR/CLAUDE.md"
    else
        log_info "Creating new CLAUDE.md integration guide..."
        cp "$INSTALL_DIR/.claude/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md" 2>/dev/null || true
    fi

    # Copy scripts
    cp "$INSTALL_DIR/scripts/run_agents.sh" "$CLAUDE_DIR/"
    cp "$INSTALL_DIR/scripts/monitor.sh" "$CLAUDE_DIR/"
    cp "$INSTALL_DIR/scripts/delegate.py" "$CLAUDE_DIR/"

    # Create main launcher
    cat > "$CLAUDE_DIR/launch.sh" << 'LAUNCH_EOF'
#!/bin/bash
# OpenCode Agent Launcher
# Usage: .claude/launch.sh [command] [options]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env" 2>/dev/null || true

case "${1:-help}" in
    start)
        bash "$SCRIPT_DIR/run_agents.sh" start
        ;;
    stop)
        bash "$SCRIPT_DIR/run_agents.sh" stop
        ;;
    status)
        bash "$SCRIPT_DIR/monitor.sh" status
        ;;
    delegate)
        python3 "$SCRIPT_DIR/delegate.py" "${@:2}"
        ;;
    logs)
        tail -f "$SCRIPT_DIR/logs/*.log"
        ;;
    help)
        echo "OpenCode Agent Automation"
        echo "Usage: $0 {start|stop|status|delegate|logs|help}"
        echo ""
        echo "Commands:"
        echo "  start    - Start all configured agents"
        echo "  stop     - Stop all running agents"
        echo "  status   - Show agent status"
        echo "  delegate - Delegate task to agents"
        echo "  logs     - Tail agent logs"
        echo "  help     - Show this help"
        ;;
    *)
        echo "Unknown command: $1"
        echo "Run '$0 help' for usage"
        exit 1
        ;;
esac
LAUNCH_EOF

    chmod +x "$CLAUDE_DIR/launch.sh"

    # Create configuration file
    cat > "$CLAUDE_DIR/config.env" << CONFIG_EOF
# OpenCode Agent Configuration
PROJECT_DIR="$PROJECT_DIR"
CLAUDE_DIR="$CLAUDE_DIR"
LOG_DIR="$CLAUDE_DIR/logs"

# Agent settings
MAX_CONCURRENT_AGENTS=4
AGENT_TIMEOUT=900  # 15 minutes
AUTO_RESTART=true

# OpenCode settings
OPENCODE_MODEL="default"  # or specific model
OPENCODE_QUIET=true

# Task priorities
HIGH_PRIORITY_FIRST=true
CONFIG_EOF

    log_success "Project setup complete!"
}

# Add to PATH (optional)
add_to_path() {
    local SHELL_RC=""

    if [ -n "$BASH_VERSION" ]; then
        SHELL_RC="$HOME/.bashrc"
    elif [ -n "$ZSH_VERSION" ]; then
        SHELL_RC="$HOME/.zshrc"
    fi

    if [ -n "$SHELL_RC" ]; then
        log_info "Adding to PATH in $SHELL_RC..."

        # Check if already in PATH
        if ! grep -q "opencode-agents" "$SHELL_RC" 2>/dev/null; then
            echo "" >> "$SHELL_RC"
            echo "# OpenCode Agent Automation" >> "$SHELL_RC"
            echo "export PATH=\"\$PATH:$INSTALL_DIR/bin\"" >> "$SHELL_RC"
            echo "alias agents='$CLAUDE_DIR/launch.sh'" >> "$SHELL_RC"

            log_success "Added to PATH. Run 'source $SHELL_RC' or restart terminal"
        else
            log_info "Already in PATH"
        fi
    fi
}

# Main installation flow
main() {
    show_banner

    log_info "Starting installation..."
    log_info "Install directory: $INSTALL_DIR"
    log_info "Project directory: $PROJECT_DIR"
    echo ""

    # Check dependencies
    check_dependencies

    # Install from GitHub
    install_from_github

    # Setup project
    setup_project

    # Add to PATH
    read -p "Add to PATH for easy access? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        add_to_path
    fi

    echo ""
    log_success "Installation complete!"
    echo ""
    echo -e "${GREEN}Quick Start:${NC}"
    echo "  1. Start agents:  .claude/launch.sh start"
    echo "  2. Check status:  .claude/launch.sh status"
    echo "  3. View logs:     .claude/launch.sh logs"
    echo ""
    echo -e "${BLUE}Documentation:${NC} https://github.com/mediafill/opencode-agent-automation${NC}"
    echo ""
}

# Handle command line options
case "${1:-install}" in
    install)
        main
        ;;
    update)
        install_from_github
        ;;
    uninstall)
        log_info "Uninstalling..."
        rm -rf "$INSTALL_DIR"
        rm -rf "$CLAUDE_DIR"
        log_success "Uninstalled"
        ;;
    *)
        echo "Usage: $0 {install|update|uninstall}"
        exit 1
        ;;
esac