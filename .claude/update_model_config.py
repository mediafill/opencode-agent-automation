#!/usr/bin/env python3
"""
Update opencode.json with model from environment variable
"""

import json
import os
from pathlib import Path

def update_opencode_config():
    """Update opencode.json with model from .env"""

    # Get model from environment
    model = os.getenv('OPENCODE_MODEL', 'grok-code-fast-1')

    # Path to opencode.json
    config_path = Path(__file__).parent.parent / 'opencode.json'

    # Load existing config or create new
    if config_path.exists():
        with open(config_path, 'r') as f:
            config = json.load(f)
    else:
        config = {}

    # Update model - just the model field is needed
    config = {'model': model}

    # Save updated config
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)

    print(f"Updated opencode.json with model: {model}")

if __name__ == '__main__':
    update_opencode_config()