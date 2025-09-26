#!/bin/bash
# OpenCode Agent Runner - Core execution script

# Load configuration
source "$(dirname "$0")/../config.env" 2>/dev/null || true

# Default values
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
LOG_DIR="${LOG_DIR:-$PROJECT_DIR/.claude/logs}"
MAX_CONCURRENT="${MAX_CONCURRENT_AGENTS:-4}"
TIMEOUT="${AGENT_TIMEOUT:-900}"

# Ensure directories exist
mkdir -p "$LOG_DIR"

# Function to run OpenCode in non-interactive mode
run_opencode_task() {
    local TASK_ID=$1
    local PROMPT=$2
    local PRIORITY=${3:-medium}
    local LOG_FILE="$LOG_DIR/agent_${TASK_ID}.log"

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting task: $TASK_ID" | tee -a "$LOG_FILE"
    echo "Priority: $PRIORITY" | tee -a "$LOG_FILE"
    echo "Prompt: $PROMPT" | tee -a "$LOG_FILE"
    echo "----------------------------------------" | tee -a "$LOG_FILE"

    # Run OpenCode with timeout
    cd "$PROJECT_DIR"
    timeout "$TIMEOUT" opencode run "$PROMPT" >> "$LOG_FILE" 2>&1

    local EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Task $TASK_ID completed successfully" | tee -a "$LOG_FILE"
    elif [ $EXIT_CODE -eq 124 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Task $TASK_ID timed out" | tee -a "$LOG_FILE"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Task $TASK_ID failed (exit: $EXIT_CODE)" | tee -a "$LOG_FILE"
    fi

    return $EXIT_CODE
}

# Function to load tasks from JSON
load_tasks() {
    local TASK_FILE="${1:-$PROJECT_DIR/.claude/tasks.json}"

    if [ ! -f "$TASK_FILE" ]; then
        echo "No task file found at: $TASK_FILE"
        return 1
    fi

    # Parse JSON and extract tasks (basic parsing)
    python3 -c "
import json
import sys

with open('$TASK_FILE') as f:
    data = json.load(f)
    tasks = data.get('tasks', [])

    for task in tasks:
        if task.get('status') == 'pending':
            print(f\"{task['id']}|{task['description']}|{task.get('priority', 'medium')}\")
" 2>/dev/null
}

# Main execution
case "${1:-start}" in
    start)
        echo "Starting OpenCode agents..."

        # Load and run tasks
        RUNNING_COUNT=0
        while IFS='|' read -r id desc priority; do
            if [ $RUNNING_COUNT -ge $MAX_CONCURRENT ]; then
                wait -n  # Wait for any background job to finish
                ((RUNNING_COUNT--))
            fi

            run_opencode_task "$id" "$desc" "$priority" &
            ((RUNNING_COUNT++))
            echo "Started agent for task: $id (PID: $!)"

            sleep 2  # Small delay between spawns
        done < <(load_tasks)

        echo "All agents started. Waiting for completion..."
        wait
        echo "All agents completed."
        ;;

    stop)
        echo "Stopping all OpenCode agents..."
        pkill -f "opencode run" 2>/dev/null
        echo "Agents stopped."
        ;;

    *)
        echo "Usage: $0 {start|stop}"
        exit 1
        ;;
esac