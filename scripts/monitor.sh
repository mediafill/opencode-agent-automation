#!/bin/bash
# OpenCode Agent Monitor - Real-time monitoring and status reporting
# Now integrates with unified dashboard server

# Load configuration
source "$(dirname "$0")/../config.env" 2>/dev/null || true

# Default values
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
CLAUDE_DIR="${CLAUDE_DIR:-$PROJECT_DIR/.claude}"
LOG_DIR="${LOG_DIR:-$CLAUDE_DIR/logs}"
UNIFIED_SERVER_SCRIPT="$(dirname "$0")/unified_dashboard_server.py"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to start unified dashboard server
start_dashboard_server() {
    local mode="${1:-monitor-only}"
    
    if [ ! -f "$UNIFIED_SERVER_SCRIPT" ]; then
        echo -e "${RED}Error:${NC} Unified dashboard server not found at $UNIFIED_SERVER_SCRIPT"
        return 1
    fi
    
    echo -e "${CYAN}Starting unified dashboard server...${NC}"
    
    if [ "$mode" = "websocket" ]; then
        echo "Starting with WebSocket support on port 8080"
        python3 "$UNIFIED_SERVER_SCRIPT" --project "$PROJECT_DIR" &
        DASHBOARD_PID=$!
        echo "Dashboard server started (PID: $DASHBOARD_PID)"
        echo "WebSocket available at: ws://localhost:8080"
        echo "Check logs for any WebSocket connection issues"
    else
        echo "Starting in monitoring mode only"
        python3 "$UNIFIED_SERVER_SCRIPT" --project "$PROJECT_DIR" --monitor-only &
        DASHBOARD_PID=$!
        echo "Dashboard server started (PID: $DASHBOARD_PID)"
    fi
    
    # Give server a moment to start
    sleep 2
    
    if ! kill -0 $DASHBOARD_PID 2>/dev/null; then
        echo -e "${RED}Error:${NC} Dashboard server failed to start"
        return 1
    fi
    
    return 0
}

# Function to stop dashboard server
stop_dashboard_server() {
    if [ ! -z "$DASHBOARD_PID" ] && kill -0 $DASHBOARD_PID 2>/dev/null; then
        echo -e "${CYAN}Stopping dashboard server...${NC}"
        kill $DASHBOARD_PID
        wait $DASHBOARD_PID 2>/dev/null
        echo "Dashboard server stopped"
    fi
}

# Function to get process status using enhanced detection
get_agent_status() {
    # Use enhanced detection similar to unified server
    local count=$(python3 -c "
import psutil
import re

claude_patterns = [
    r'opencode.*run',
    r'claude.*desktop',
    r'claude.*cli',
    r'anthropic.*claude',
    r'python.*opencode',
    r'node.*opencode',
    r'opencode-agent',
    r'\.vscode.*claude',
    r'cursor.*claude'
]

count = 0
for proc in psutil.process_iter(['cmdline', 'name']):
    try:
        if not proc.info['cmdline']:
            continue
        cmdline = ' '.join(proc.info['cmdline']).lower()
        process_name = proc.info.get('name', '').lower()
        
        for pattern in claude_patterns:
            if re.search(pattern, cmdline) or re.search(pattern, process_name):
                count += 1
                break
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        continue

print(count)
" 2>/dev/null || echo "0")
    echo "$count"
}

# Function to analyze log file
analyze_log() {
    local log_file=$1
    local name=$(basename "$log_file" .log)

    if [ ! -f "$log_file" ]; then
        echo "  ${YELLOW}○${NC} $name: Not started"
        return
    fi

    local lines=$(wc -l < "$log_file" 2>/dev/null || echo 0)
    local size=$(du -h "$log_file" 2>/dev/null | cut -f1)

    # Check for completion markers
    if grep -q "Task.*completed successfully" "$log_file" 2>/dev/null; then
        echo "  ${GREEN}✓${NC} $name: Completed (${size}, ${lines} lines)"
    elif grep -q "Error\|Failed\|Exception" "$log_file" 2>/dev/null; then
        local error=$(grep -i "error\|failed" "$log_file" | tail -1 | cut -c1-60)
        echo "  ${RED}✗${NC} $name: Error - ${error}... (${size})"
    elif [ "$lines" -gt 0 ]; then
        local last_line=$(tail -1 "$log_file" | cut -c1-50)
        echo "  ${BLUE}●${NC} $name: Running - ${last_line}... (${size})"
    else
        echo "  ${YELLOW}○${NC} $name: Starting..."
    fi
}

# Function to show task status from JSON
show_task_status() {
    local task_file="$CLAUDE_DIR/tasks.json"

    if [ ! -f "$task_file" ]; then
        echo "No task file found"
        return
    fi

    python3 -c "
import json
import sys

try:
    with open('$task_file') as f:
        data = json.load(f)
        tasks = data.get('tasks', [])

        # Count by status
        status_counts = {'pending': 0, 'in_progress': 0, 'completed': 0, 'blocked': 0}
        priority_counts = {'high': 0, 'medium': 0, 'low': 0}

        for task in tasks:
            status = task.get('status', 'pending')
            priority = task.get('priority', 'medium')
            status_counts[status] = status_counts.get(status, 0) + 1
            priority_counts[priority] = priority_counts.get(priority, 0) + 1

        # Display summary
        print(f\"Total Tasks: {len(tasks)}\")
        print(f\"  Completed: {status_counts['completed']}\")
        print(f\"  In Progress: {status_counts['in_progress']}\")
        print(f\"  Pending: {status_counts['pending']}\")
        print(f\"  Blocked: {status_counts['blocked']}\")
        print()
        print(f\"By Priority:\")
        print(f\"  High: {priority_counts['high']}\")
        print(f\"  Medium: {priority_counts['medium']}\")
        print(f\"  Low: {priority_counts['low']}\")

except Exception as e:
    print(f\"Error reading tasks: {e}\")
" 2>/dev/null || echo "Error parsing task file"
}

# Function to show resource usage
show_resources() {
    echo -e "${CYAN}System Resources:${NC}"

    # Memory usage
    if command -v free &> /dev/null; then
        local mem_info=$(free -h | grep "^Mem:")
        local mem_used=$(echo "$mem_info" | awk '{print $3}')
        local mem_total=$(echo "$mem_info" | awk '{print $2}')
        echo "  Memory: $mem_used / $mem_total"
    fi

    # CPU usage
    if command -v top &> /dev/null; then
        local cpu_idle=$(top -bn1 | grep "Cpu(s)" | awk '{print $8}' | cut -d'%' -f1)
        local cpu_used=$(echo "100 - $cpu_idle" | bc 2>/dev/null || echo "N/A")
        echo "  CPU Usage: ${cpu_used}%"
    fi

    # Disk usage for log directory
    if [ -d "$LOG_DIR" ]; then
        local disk_usage=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
        echo "  Log Size: $disk_usage"
    fi
}

# Function for continuous monitoring
continuous_monitor() {
    while true; do
        clear
        echo "═══════════════════════════════════════════════════════════════"
        echo "              OpenCode Agent Monitor - $(date '+%H:%M:%S')"
        echo "═══════════════════════════════════════════════════════════════"
        echo ""

        # Agent status
        local agent_count=$(get_agent_status)
        echo -e "${CYAN}Active Agents:${NC} $agent_count running"
        echo ""

        # Task status
        echo -e "${CYAN}Task Status:${NC}"
        show_task_status
        echo ""

        # Log analysis
        echo -e "${CYAN}Agent Logs:${NC}"
        for log in "$LOG_DIR"/*.log; do
            [ -f "$log" ] && analyze_log "$log"
        done
        echo ""

        # System resources
        show_resources
        echo ""

        # Recent activity
        echo -e "${CYAN}Recent Activity:${NC}"
        if [ -d "$LOG_DIR" ] && [ "$(ls -A $LOG_DIR 2>/dev/null)" ]; then
            tail -n 3 "$LOG_DIR"/*.log 2>/dev/null | grep -v "^$\|^==>" | head -5 | while read line; do
                echo "  $(echo "$line" | cut -c1-70)..."
            done
        else
            echo "  No recent activity"
        fi

        echo ""
        echo "═══════════════════════════════════════════════════════════════"
        echo "Press Ctrl+C to exit | Refreshing every 5 seconds..."

        sleep 5
    done
}

# Function to generate HTML dashboard
generate_dashboard() {
    local dashboard_file="$CLAUDE_DIR/dashboard.html"

    cat > "$dashboard_file" << 'HTML_EOF'
<!DOCTYPE html>
<html>
<head>
    <title>OpenCode Agent Dashboard</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            padding: 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            text-align: center;
            color: white;
            margin-bottom: 30px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }
        .card {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .card h2 {
            color: #667eea;
            margin-bottom: 15px;
            font-size: 1.2em;
        }
        .status-item {
            padding: 10px;
            margin: 5px 0;
            border-left: 4px solid #ddd;
            background: #f9f9f9;
            border-radius: 4px;
        }
        .status-running { border-left-color: #4CAF50; }
        .status-completed { border-left-color: #2196F3; }
        .status-error { border-left-color: #f44336; }
        .status-pending { border-left-color: #FFC107; }
        .metric {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .metric:last-child { border-bottom: none; }
        .metric-value {
            font-weight: bold;
            color: #667eea;
        }
        #refresh-time {
            text-align: center;
            color: white;
            margin-top: 20px;
            opacity: 0.8;
        }
        .progress-bar {
            width: 100%;
            height: 20px;
            background: #f0f0f0;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 10px;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            transition: width 0.3s ease;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 OpenCode Agent Dashboard</h1>

        <div class="dashboard">
            <div class="card">
                <h2>📊 Agent Status</h2>
                <div id="agent-status">Loading...</div>
            </div>

            <div class="card">
                <h2>📝 Task Progress</h2>
                <div id="task-progress">Loading...</div>
            </div>

            <div class="card">
                <h2>💻 System Resources</h2>
                <div id="system-resources">Loading...</div>
            </div>

            <div class="card" style="grid-column: span 2;">
                <h2>📜 Recent Activity</h2>
                <div id="recent-activity" style="max-height: 200px; overflow-y: auto;">Loading...</div>
            </div>
        </div>

        <div id="refresh-time">Auto-refresh every 5 seconds</div>
    </div>

    <script>
        function loadDashboardData() {
            // This would normally fetch from an API endpoint
            // For now, showing placeholder data

            document.getElementById('agent-status').innerHTML = `
                <div class="status-item status-running">Agent 1: Running - Processing security audit</div>
                <div class="status-item status-completed">Agent 2: Completed - Tests added</div>
                <div class="status-item status-pending">Agent 3: Pending - Documentation</div>
            `;

            document.getElementById('task-progress').innerHTML = `
                <div class="metric">
                    <span>Total Tasks</span>
                    <span class="metric-value">12</span>
                </div>
                <div class="metric">
                    <span>Completed</span>
                    <span class="metric-value">7</span>
                </div>
                <div class="metric">
                    <span>In Progress</span>
                    <span class="metric-value">3</span>
                </div>
                <div class="metric">
                    <span>Pending</span>
                    <span class="metric-value">2</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 58%"></div>
                </div>
            `;

            document.getElementById('system-resources').innerHTML = `
                <div class="metric">
                    <span>Memory Usage</span>
                    <span class="metric-value">4.2 GB / 16 GB</span>
                </div>
                <div class="metric">
                    <span>CPU Usage</span>
                    <span class="metric-value">35%</span>
                </div>
                <div class="metric">
                    <span>Active Processes</span>
                    <span class="metric-value">3</span>
                </div>
                <div class="metric">
                    <span>Log Size</span>
                    <span class="metric-value">12.4 MB</span>
                </div>
            `;

            document.getElementById('recent-activity').innerHTML = `
                <div class="status-item">[14:23:45] Security audit: Found 2 vulnerabilities</div>
                <div class="status-item">[14:23:12] Test creation: Added 15 unit tests</div>
                <div class="status-item">[14:22:58] Performance: Optimized database queries</div>
                <div class="status-item">[14:22:31] Documentation: Updated API docs</div>
                <div class="status-item">[14:22:15] Agent started: security_audit</div>
            `;
        }

        // Load data initially and set refresh
        loadDashboardData();
        setInterval(loadDashboardData, 5000);
    </script>
</body>
</html>
HTML_EOF

    echo "Dashboard generated at: $dashboard_file"
    echo "Open in browser: file://$dashboard_file"
}

# Main command handling
case "${1:-status}" in
    status)
        echo -e "${BLUE}═══ OpenCode Agent Status ═══${NC}"
        echo ""

        # Agent count
        agent_count=$(get_agent_status)
        if [ "$agent_count" -gt 0 ]; then
            echo -e "${GREEN}✓${NC} $agent_count agents running"
        else
            echo -e "${YELLOW}○${NC} No agents currently running"
        fi
        echo ""

        # Task status
        echo -e "${CYAN}Tasks:${NC}"
        show_task_status
        echo ""

        # Log status
        echo -e "${CYAN}Logs:${NC}"
        if [ -d "$LOG_DIR" ]; then
            for log in "$LOG_DIR"/*.log; do
                [ -f "$log" ] && analyze_log "$log"
            done
        else
            echo "  No logs found"
        fi
        ;;

    watch)
        continuous_monitor
        ;;

    dashboard)
        echo -e "${CYAN}Starting dashboard server in WebSocket mode...${NC}"
        start_dashboard_server "websocket"
        if [ $? -eq 0 ]; then
            echo ""
            echo "Dashboard server is running with WebSocket support"
            echo "- Real-time monitoring available via WebSocket connection"
            echo "- Press Ctrl+C to stop the server"
            echo ""
            
            # Wait for the server process
            wait $DASHBOARD_PID 2>/dev/null
        fi
        ;;

    server)
        echo -e "${CYAN}Starting dashboard server in monitoring mode...${NC}"
        start_dashboard_server "monitor-only"
        if [ $? -eq 0 ]; then
            echo ""
            echo "Dashboard server is running in monitoring mode"
            echo "- Enhanced Claude/OpenCode process detection active"
            echo "- Press Ctrl+C to stop the server"
            echo ""
            
            # Wait for the server process
            wait $DASHBOARD_PID 2>/dev/null
        fi
        ;;

    enhanced-watch)
        echo -e "${CYAN}Starting enhanced monitoring with unified server...${NC}"
        start_dashboard_server "monitor-only"
        if [ $? -eq 0 ]; then
            echo ""
            echo "Enhanced monitoring active - showing live status"
            echo "Press Ctrl+C to stop"
            echo ""
            
            # Show live status while server runs
            while kill -0 $DASHBOARD_PID 2>/dev/null; do
                clear
                echo "═══════════════════════════════════════════════════════════════"
                echo "         Enhanced OpenCode Monitor - $(date '+%H:%M:%S')"
                echo "                    (Powered by Unified Server)"
                echo "═══════════════════════════════════════════════════════════════"
                echo ""

                # Enhanced agent count
                agent_count=$(get_agent_status)
                echo -e "${CYAN}Detected Agents:${NC} $agent_count processes"
                echo ""

                # Task status
                echo -e "${CYAN}Task Status:${NC}"
                show_task_status
                echo ""

                # Log analysis
                echo -e "${CYAN}Agent Logs:${NC}"
                for log in "$LOG_DIR"/*.log; do
                    [ -f "$log" ] && analyze_log "$log"
                done
                echo ""

                # System resources
                show_resources
                echo ""
                
                echo "═══════════════════════════════════════════════════════════════"
                echo "Enhanced monitoring with unified server | Refreshing every 5s"
                echo "Server PID: $DASHBOARD_PID | Press Ctrl+C to exit"

                sleep 5
            done
        fi
        ;;

    stop)
        stop_dashboard_server
        # Also stop any other dashboard servers that might be running
        pkill -f "unified_dashboard_server.py" 2>/dev/null
        echo "All dashboard servers stopped"
        ;;

    generate_dashboard)
        generate_dashboard
        ;;

    summary)
        echo -e "${BLUE}═══ Agent Summary Report ═══${NC}"
        echo ""
        echo "Project: $PROJECT_DIR"
        echo "Time: $(date)"
        echo ""

        # Count completed tasks
        completed=0
        failed=0
        running=0

        for log in "$LOG_DIR"/*.log; do
            if [ -f "$log" ]; then
                if grep -q "completed successfully" "$log" 2>/dev/null; then
                    ((completed++))
                elif grep -q "Error\|Failed" "$log" 2>/dev/null; then
                    ((failed++))
                else
                    ((running++))
                fi
            fi
        done

        echo "Results:"
        echo "  ✓ Completed: $completed"
        echo "  ● Running: $running"
        echo "  ✗ Failed: $failed"
        echo ""

        # Show errors if any
        if [ "$failed" -gt 0 ]; then
            echo -e "${RED}Errors found:${NC}"
            grep -h "Error\|Failed" "$LOG_DIR"/*.log 2>/dev/null | head -5
        fi
        ;;

    clean)
        echo "Cleaning old logs..."
        find "$LOG_DIR" -name "*.log" -mtime +7 -delete 2>/dev/null
        echo "Cleaned logs older than 7 days"
        ;;

    *)
        echo "Usage: $0 {status|watch|enhanced-watch|dashboard|server|generate_dashboard|summary|clean|stop}"
        echo ""
        echo "Commands:"
        echo "  status           - Show current agent status"
        echo "  watch            - Basic continuous monitoring mode"
        echo "  enhanced-watch   - Enhanced monitoring with unified server backend"
        echo "  dashboard        - Start unified server with WebSocket support"
        echo "  server           - Start unified server in monitoring mode only"
        echo "  generate_dashboard - Generate static HTML dashboard file"
        echo "  summary          - Show summary report"
        echo "  clean            - Clean old log files"
        echo "  stop             - Stop all running dashboard servers"
        echo ""
        echo "Enhanced modes use the unified dashboard server for better process detection"
        ;;
esac

# Cleanup on exit
trap stop_dashboard_server EXIT