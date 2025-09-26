#!/usr/bin/env python3
"""
Initialize the OpenCode Agent System
"""

import sys
from pathlib import Path

def init_agent_system():
    """Initialize the agent system"""
    agent_dir = Path(__file__).parent

    print("🤖 Initializing OpenCode Agent System...")

    # Check if opencode is available
    try:
        import subprocess
        result = subprocess.run(["opencode", "--version"],
                              capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            print("⚠️  Warning: OpenCode CLI not found. Please install it first.")
            print("   Visit: https://opencode.ai for installation instructions.")
        else:
            print("✅ OpenCode CLI found")
    except FileNotFoundError:
        print("❌ OpenCode CLI not found. Please install it first.")
        return False
    except Exception as e:
        print(f"⚠️  Could not verify OpenCode CLI: {e}")

    # Create necessary directories
    logs_dir = agent_dir / "logs"
    logs_dir.mkdir(exist_ok=True)

    # Test basic functionality
    try:
        # Add current directory to path
        current_dir = str(agent_dir)
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)

        from agent_orchestrator import AgentOrchestrator
        orchestrator = AgentOrchestrator()
        status = orchestrator.get_status()
        print(f"✅ Agent system initialized. Status: {status}")
        return True
    except Exception as e:
        print(f"❌ Failed to initialize agent system: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = init_agent_system()
    sys.exit(0 if success else 1)
