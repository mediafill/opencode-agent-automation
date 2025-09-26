#!/bin/bash
# Minimal background monitoring - runs silently, logs to file
LOG_FILE=".claude/monitor.log"

while true; do
    echo "[$(date +%H:%M:%S)]" >> $LOG_FILE
    ps aux | grep opencode | grep -v grep | wc -l | xargs echo "Agents:" >> $LOG_FILE
    .claude/launch.sh status | grep -E "Completed:|Progress:" >> $LOG_FILE 2>/dev/null
    sleep 60
done