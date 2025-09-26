#!/usr/bin/env python3
import subprocess
import sys

def test_opencode_call():
    prompt = """
Analyze this development objective: continue building the frontend task viewer

Please respond with EXACTLY this format:
TASK: frontend | high | Complete the task viewer interface | *.html,*.js,*.css
TASK: testing | medium | Add tests for task viewer | *test*.js
"""

    try:
        result = subprocess.run(
            ['opencode', 'run', prompt],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        print("Return code:", result.returncode)
        print("STDOUT:")
        print(result.stdout)
        print("STDERR:")
        print(result.stderr)
        
        # Test parsing
        if result.stdout:
            lines = result.stdout.strip().split('\n')
            print("\nParsing tasks:")
            for line in lines:
                if line.strip().startswith('TASK:'):
                    print(f"Found task line: {line}")
                    parts = line.replace('TASK:', '').strip().split(' | ')
                    print(f"  Parts: {parts}")
                    
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    test_opencode_call()