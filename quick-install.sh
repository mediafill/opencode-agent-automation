#!/bin/bash
# Quick installer for OpenCode Agent Automation
# Can be run with: curl -fsSL <url> | bash

set -e

echo "======================================"
echo "OpenCode Agent Automation Quick Setup"
echo "======================================"

# Detect if OpenCode is installed
if ! command -v opencode &> /dev/null; then
    echo "⚠️  OpenCode not found. Installing..."
    npm install -g opencode || {
        echo "❌ Failed to install OpenCode"
        echo "Please install manually from: https://opencode.ai"
        exit 1
    }
fi

# Create .claude directory in current project
mkdir -p .claude/{logs,tasks,agents}

# Download core files
BASE_URL="https://raw.githubusercontent.com/mediafill/opencode-agent-automation/main"

echo "📥 Downloading automation scripts..."

# Download with curl or wget
if command -v curl &> /dev/null; then
    DOWNLOAD="curl -fsSL"
elif command -v wget &> /dev/null; then
    DOWNLOAD="wget -qO-"
else
    echo "❌ No download tool available (curl/wget)"
    exit 1
fi

# Download essential files
$DOWNLOAD "$BASE_URL/scripts/run_agents.sh" > .claude/run_agents.sh
$DOWNLOAD "$BASE_URL/scripts/delegate.py" > .claude/delegate.py
$DOWNLOAD "$BASE_URL/templates/agentsync.md" > .claude/agentsync.md
$DOWNLOAD "$BASE_URL/templates/tasks.json" > .claude/tasks.json

# Create launcher
cat > .claude/launch.sh << 'EOF'
#!/bin/bash
# OpenCode Agent Launcher

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

case "${1:-help}" in
    start)
        echo "Starting OpenCode agents..."
        bash "$SCRIPT_DIR/run_agents.sh" start
        ;;
    stop)
        echo "Stopping all agents..."
        pkill -f "opencode run" 2>/dev/null
        echo "Agents stopped"
        ;;
    status)
        echo "Agent Status:"
        ps aux | grep "opencode run" | grep -v grep || echo "No agents running"
        ;;
    delegate)
        shift
        python3 "$SCRIPT_DIR/delegate.py" "$@"
        ;;
    logs)
        tail -f "$SCRIPT_DIR/logs/*.log" 2>/dev/null || echo "No logs yet"
        ;;
    test)
        echo "Testing OpenCode..."
        opencode run "Write a hello world Python script" || echo "OpenCode test failed"
        ;;
    *)
        echo "Usage: $0 {start|stop|status|delegate|logs|test}"
        ;;
esac
EOF

# Make executable
chmod +x .claude/*.sh
chmod +x .claude/*.py

echo "✅ Installation complete!"
echo ""
echo "Quick Start:"
echo "  .claude/launch.sh delegate 'make app production ready'"
echo ""
echo "Commands:"
echo "  .claude/launch.sh start     - Start agents"
echo "  .claude/launch.sh status    - Check status"
echo "  .claude/launch.sh logs      - View logs"
echo "  .claude/launch.sh stop      - Stop agents"