#!/usr/bin/env python3
"""
Setup script for OpenCode Agent Automation
Self-contained, portable AI agent delegation system
"""

from setuptools import setup, find_packages
import os
import json

# Read version from the main module
def get_version():
    try:
        with open('opencode_agent_automation.py', 'r') as f:
            for line in f:
                if line.startswith('__version__'):
                    return line.split('=')[1].strip().strip('"\''')
    except Exception:
        pass
    return '2.0.0'

# Read README
def get_long_description():
    try:
        with open('README.md', 'r', encoding='utf-8') as f:
            return f.read()
    except:
        return 'OpenCode Agent Automation - Self-contained AI agent delegation system'

setup(
    name='opencode-agent-automation',
    version=get_version(),
    description='Self-contained OpenCode AI agent delegation system for Claude integration',
    long_description=get_long_description(),
    long_description_content_type='text/markdown',
    author='OpenCode Agent Automation Team',
    author_email='support@opencode.ai',
    url='https://github.com/mediafill/opencode-agent-automation',
    license='MIT',

    # Main module
    py_modules=['opencode_agent_automation'],

    # Entry points
    entry_points={
        'console_scripts': [
            'opencode-agents=opencode_agent_automation:main',
            'agents=opencode_agent_automation:main',
        ],
    },

    # Dependencies
    install_requires=[
        'requests',  # For downloading files
        'psutil',    # For system monitoring
    ],

    # Optional dependencies
    extras_require={
        'dev': [
            'pytest',
            'flake8',
            'mypy',
        ],
        'web': [
            'flask',
            'flask-cors',
        ],
    },

    # Classifiers
    classifiers=[
        'Development Status :: 4 - Beta',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: MIT License',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.7',
        'Programming Language :: Python :: 3.8',
        'Programming Language :: Python :: 3.9',
        'Programming Language :: Python :: 3.10',
        'Programming Language :: Python :: 3.11',
        'Topic :: Software Development :: Libraries :: Python Modules',
        'Topic :: System :: Distributed Computing',
        'Topic :: Utilities',
    ],

    # Keywords
    keywords='opencode claude ai automation agent delegation development',

    # Python version
    python_requires='>=3.7',

    # Include package data
    include_package_data=True,

    # Project status
    zip_safe=False,
)