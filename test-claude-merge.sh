#!/bin/bash
# Test CLAUDE.md merging functionality

TEST_DIR="/tmp/claude-merge-test"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/.claude"

# Create a mock existing CLAUDE.md
cat > "$TEST_DIR/.claude/CLAUDE.md" << 'EOF'
# Existing CLAUDE.md

This is an existing CLAUDE.md file that already has some project-specific documentation.

## Project Context
- This is a special project
- Has custom requirements
- Uses specific tools

## Custom Instructions
- Follow project guidelines
- Use specific coding patterns
EOF

echo "Created test environment with existing CLAUDE.md:"
echo "=================================="
cat "$TEST_DIR/.claude/CLAUDE.md"
echo "=================================="
echo ""
echo "Now testing the installation merge process..."

# Simulate the installation merge process
if [ -f "$TEST_DIR/.claude/CLAUDE.md" ]; then
    echo "Existing CLAUDE.md found, appending automation system documentation..."
    echo "" >> "$TEST_DIR/.claude/CLAUDE.md"
    echo "# ===== OpenCode Agent Automation System Documentation =====" >> "$TEST_DIR/.claude/CLAUDE.md"
    echo "# Added by installer on $(date)" >> "$TEST_DIR/.claude/CLAUDE.md"
    echo "" >> "$TEST_DIR/.claude/CLAUDE.md"
    cat "/home/ara/Documents/code/opencode-agent-automation/.claude/CLAUDE.md" >> "$TEST_DIR/.claude/CLAUDE.md"
    echo "✅ Merge completed!"
else
    echo "No existing CLAUDE.md, would create new one"
fi

echo ""
echo "Final merged CLAUDE.md (first 20 lines):"
echo "=================================="
head -20 "$TEST_DIR/.claude/CLAUDE.md"
echo "... (content continues) ..."
echo "=================================="
echo ""
echo "Total lines in merged file: $(wc -l < "$TEST_DIR/.claude/CLAUDE.md")"