import { jest } from '@jest/globals';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('SlaveAgentWrapper Unit Tests', () => {
  let testProjectDir;
  let claudeDir;
  let agentProcess;
  let mockVectorDb;
  let mockOrchestrator;
  let mockResourceMonitor;

  beforeAll(async () => {
    testProjectDir = path.join(os.tmpdir(), 'slave-agent-test-' + Date.now());
    claudeDir = path.join(testProjectDir, '.claude');

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(path.join(claudeDir, 'logs'), { recursive: true });
    await fs.mkdir(path.join(claudeDir, 'agent_data'), { recursive: true });
  });

  beforeEach(async () => {
    // Clean up any existing files
    try {
      const files = await fs.readdir(claudeDir);
      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.log')) {
          await fs.unlink(path.join(claudeDir, file));
        }
      }
    } catch (e) {
      // Ignore if directory doesn't exist
    }

    // Mock external dependencies
    mockVectorDb = {
      store_task_history: jest.fn().mockResolvedValue('doc_id'),
      query_similar_solutions: jest.fn().mockResolvedValue([]),
    };

    mockOrchestrator = {
      master_id: 'master_test_123',
      register_slave_agent: jest.fn().mockReturnValue(true),
    };

    mockResourceMonitor = {
      get_resource_usage: jest.fn().mockReturnValue({
        cpu_percent: 25.5,
        memory_mb: 128.7,
        disk_usage: { percent: 45.2, free_gb: 50.1 },
        network_connections: 3,
        timestamp: new Date().toISOString()
      })
    };

    // Mock the imports
    jest.doMock('vector_database', () => ({
      VectorDatabase: jest.fn().mockImplementation(() => mockVectorDb),
    }));

    jest.doMock('master_agent_orchestrator', () => ({
      MasterAgentOrchestrator: jest.fn(),
      AgentMessage: jest.fn(),
      MessageType: {
        TASK_ASSIGNMENT: 'task_assignment',
        HEALTH_CHECK: 'health_check',
        TASK_STATUS_UPDATE: 'task_status_update',
        COORDINATION_SIGNAL: 'coordination_signal'
      },
      get_orchestrator: jest.fn().mockReturnValue(mockOrchestrator),
      AgentRole: { SLAVE: 'slave' },
      AgentStatus: { READY: 'ready', WORKING: 'working' }
    }));

    jest.doMock('psutil', () => ({
      Process: jest.fn().mockImplementation(() => mockResourceMonitor)
    }));
  });

  afterEach(async () => {
    if (agentProcess && !agentProcess.killed) {
      agentProcess.kill('SIGTERM');
      await new Promise(resolve => {
        agentProcess.on('close', resolve);
      });
    }

    // Clean up any created files
    try {
      const files = await fs.readdir(claudeDir);
      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.log')) {
          await fs.unlink(path.join(claudeDir, file));
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Initialization and Setup', () => {
    test('should initialize with default capabilities', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')

result = {
  'agent_id': agent.agent_id,
  'capabilities': list(agent.capabilities),
  'state': agent.state.value,
  'project_dir': str(agent.project_dir)
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.agent_id).toMatch(/^slave_[a-f0-9]{8}$/);
      expect(result.capabilities).toEqual(
        expect.arrayContaining(['code_analysis', 'testing', 'debugging', 'refactoring', 'documentation', 'performance', 'security'])
      );
      expect(result.state).toBe('initializing');
      expect(result.project_dir).toBe(testProjectDir);
    });

    test('should initialize with custom capabilities', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper
import json

custom_capabilities = ['testing', 'deployment', 'monitoring']
agent = SlaveAgentWrapper(
  agent_id='custom_agent_123',
  project_dir='${testProjectDir}',
  capabilities=custom_capabilities
)

result = {
  'agent_id': agent.agent_id,
  'capabilities': list(agent.capabilities)
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.agent_id).toBe('custom_agent_123');
      expect(result.capabilities).toEqual(['testing', 'deployment', 'monitoring']);
    });

    test('should create required directories', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper
import os

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')

dirs_exist = {
  'claude_dir': os.path.exists(agent.claude_dir),
  'logs_dir': os.path.exists(os.path.join(agent.claude_dir, 'logs')),
  'agent_data_dir': os.path.exists(os.path.join(agent.claude_dir, 'agent_data'))
}

print(str(dirs_exist))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const dirsExist = eval(stdout.trim());
      expect(dirsExist.claude_dir).toBe(true);
      expect(dirsExist.logs_dir).toBe(true);
      expect(dirsExist.agent_data_dir).toBe(true);
    });
  });

  describe('Agent Registration and Connection', () => {
    test('should successfully initialize and register with orchestrator', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')

# Mock successful initialization
success = agent.initialize()

result = {
  'initialization_success': success,
  'final_state': agent.state.value,
  'orchestrator_connected': agent.orchestrator is not None
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.initialization_success).toBe(true);
      expect(result.final_state).toBe('ready');
      expect(result.orchestrator_connected).toBe(true);
    });

    test('should handle orchestrator connection failure gracefully', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')

# Mock orchestrator import failure
import slave_agent_wrapper
slave_agent_wrapper.ORCHESTRATOR_AVAILABLE = False

from slave_agent_wrapper import SlaveAgentWrapper
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
success = agent.initialize()

result = {
  'initialization_success': success,
  'orchestrator_available': agent.orchestrator is not None,
  'state': agent.state.value
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.initialization_success).toBe(true); // Should still succeed without orchestrator
      expect(result.orchestrator_available).toBe(false);
      expect(result.state).toBe('ready');
    });
  });

  describe('Task Execution and Management', () => {
    test('should accept and execute assigned tasks', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper, AgentMessage, MessageType
import json
from datetime import datetime

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Simulate task assignment message
task_data = {
  'task_id': 'test_task_123',
  'description': 'Test task execution',
  'type': 'testing',
  'files_pattern': '**/*.test.js'
}

message = AgentMessage(
  MessageType.TASK_ASSIGNMENT,
  'master_test_123',
  agent.agent_id,
  {
    'task_id': 'test_task_123',
    'task_data': task_data
  }
)

agent._handle_task_assignment(message)

result = {
  'current_task_id': agent.current_task['task_id'] if agent.current_task else None,
  'state': agent.state.value,
  'task_start_time_set': agent.task_start_time is not None
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.current_task_id).toBe('test_task_123');
      expect(result.state).toBe('working');
      expect(result.task_start_time_set).toBe(true);
    });

    test('should reject tasks when already busy', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper, AgentMessage, MessageType
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Set agent as busy with existing task
agent.current_task = {
  'task_id': 'existing_task_456',
  'data': {'description': 'Existing task'},
  'assigned_at': '2024-01-01T00:00:00'
}
agent.state = agent.SlaveAgentState.WORKING

# Try to assign another task
task_data = {
  'task_id': 'new_task_789',
  'description': 'New task',
  'type': 'analysis'
}

message = AgentMessage(
  MessageType.TASK_ASSIGNMENT,
  'master_test_123',
  agent.agent_id,
  {
    'task_id': 'new_task_789',
    'task_data': task_data
  }
)

agent._handle_task_assignment(message)

result = {
  'current_task_id': agent.current_task['task_id'],
  'state': agent.state.value,
  'message_queue_length': len(agent.message_queue)
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.current_task_id).toBe('existing_task_456'); // Should still have original task
      expect(result.state).toBe('working');
      expect(result.message_queue_length).toBeGreaterThan(0); // Should have rejection message
    });

    test('should complete tasks and update status', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper
import json
from datetime import datetime

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Set up a current task
agent.current_task = {
  'task_id': 'completion_test_task',
  'data': {'description': 'Test completion'},
  'assigned_at': datetime.now()
}
agent.task_start_time = datetime.now()
agent.state = agent.SlaveAgentState.WORKING

# Complete the task
agent._complete_task('completed', 'Task completed successfully')

result = {
  'current_task': agent.current_task,
  'state': agent.state.value,
  'task_start_time': agent.task_start_time
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.current_task).toBeNull();
      expect(result.state).toBe('ready');
      expect(result.task_start_time).toBeNull();
    });
  });

  describe('Health Monitoring and Reporting', () => {
    test('should perform health checks and report status', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper, AgentMessage, MessageType
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Mock resource monitor
class MockResourceMonitor:
    def get_resource_usage(self):
        return {
            'cpu_percent': 35.2,
            'memory_mb': 245.8,
            'disk_usage': {'percent': 52.1, 'free_gb': 45.3},
            'network_connections': 5,
            'timestamp': '2024-01-01T12:00:00'
        }

agent.resource_monitor = MockResourceMonitor()

# Perform health check
agent._perform_health_check()

result = {
  'last_health_report_set': agent.last_health_report is not None,
  'message_queue_has_health_report': any(
    msg.message_type == MessageType.HEALTH_CHECK
    for msg in agent.message_queue
  )
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.last_health_report_set).toBe(true);
      expect(result.message_queue_has_health_report).toBe(true);
    });

    test('should handle health check requests from orchestrator', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper, AgentMessage, MessageType
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Simulate health check request
message = AgentMessage(
  MessageType.HEALTH_CHECK,
  'master_test_123',
  agent.agent_id,
  {'request_timestamp': '2024-01-01T12:00:00'}
)

agent._handle_health_check_request(message)

result = {
  'message_processed': True,  # Should not throw error
  'state': agent.state.value
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.message_processed).toBe(true);
      expect(result.state).toBe('ready');
    });
  });

  describe('Message Processing and Communication', () => {
    test('should process task assignment messages', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper, AgentMessage, MessageType
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Create task assignment message
task_data = {
  'description': 'Process task assignment test',
  'type': 'testing',
  'files_pattern': '**/*.js'
}

message = AgentMessage(
  MessageType.TASK_ASSIGNMENT,
  'master_test_123',
  agent.agent_id,
  {
    'task_id': 'msg_test_task',
    'task_data': task_data
  }
)

processed = agent._process_message(message)

result = {
  'message_processed': processed,
  'has_current_task': agent.current_task is not None,
  'task_id': agent.current_task['task_id'] if agent.current_task else None
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.message_processed).toBe(true);
      expect(result.has_current_task).toBe(true);
      expect(result.task_id).toBe('msg_test_task');
    });

    test('should handle coordination signals', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper, AgentMessage, MessageType
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()
agent.state = agent.SlaveAgentState.WORKING

# Test pause signal
pause_message = AgentMessage(
  MessageType.COORDINATION_SIGNAL,
  'master_test_123',
  agent.agent_id,
  {'signal_type': 'pause'}
)

agent._handle_coordination_signal(pause_message)

# Test resume signal
resume_message = AgentMessage(
  MessageType.COORDINATION_SIGNAL,
  'master_test_123',
  agent.agent_id,
  {'signal_type': 'resume'}
)

agent._handle_coordination_signal(resume_message)

result = {
  'pause_handled': True,
  'resume_handled': True,
  'state_after_resume': agent.state.value
}

print(json.dumps(result))
      `], {
        cwd: testProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.pause_handled).toBe(true);
      expect(result.resume_handled).toBe(true);
      expect(result.state_after_resume).toBe('ready');
    });

    test('should handle shutdown signals', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper, AgentMessage, MessageType
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Test shutdown signal
shutdown_message = AgentMessage(
  MessageType.COORDINATION_SIGNAL,
  'master_test_123',
  agent.agent_id,
  {'signal_type': 'shutdown'}
)

agent._handle_coordination_signal(shutdown_message)

result = {
  'shutdown_signal_handled': True,
  'state_after_shutdown': agent.state.value
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.shutdown_signal_handled).toBe(true);
      expect(result.state_after_shutdown).toBe('shutting_down');
    });
  });

  describe('Agent Lifecycle Management', () => {
    test('should start and run monitoring threads', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper
import json
import time
import threading

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Start the agent
agent.start()

# Let it run briefly
time.sleep(2)

result = {
  'is_running': agent.is_running,
  'monitor_thread_alive': agent.monitor_thread.is_alive() if agent.monitor_thread else False,
  'message_thread_alive': agent.message_thread.is_alive() if agent.message_thread else False,
  'state': agent.state.value
}

# Stop the agent
agent.stop()

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.is_running).toBe(false); // Should be stopped
      expect(result.monitor_thread_alive).toBe(false);
      expect(result.message_thread_alive).toBe(false);
      expect(result.state).toBe('shutting_down');
    });

    test('should provide comprehensive status information', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper
import json

agent = SlaveAgentWrapper(
  agent_id='status_test_agent',
  project_dir='${testProjectDir}',
  capabilities=['testing', 'analysis']
)
agent.initialize()

# Set some status
agent.current_task = {'task_id': 'active_task_123'}
agent.state = agent.SlaveAgentState.WORKING

status = agent.get_status()

result = {
  'agent_id': status['agent_id'],
  'state': status['state'],
  'current_task': status['current_task'],
  'capabilities': status['capabilities'],
  'has_last_health_report': 'last_health_report' in status,
  'has_uptime': 'uptime' in status
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.agent_id).toBe('status_test_agent');
      expect(result.state).toBe('working');
      expect(result.current_task).toBe('active_task_123');
      expect(result.capabilities).toEqual(['testing', 'analysis']);
      expect(result.has_last_health_report).toBe(true);
      expect(result.has_uptime).toBe(true);
    });
  });

  describe('Resource Monitor Integration', () => {
    test('should integrate with resource monitor for usage tracking', async () => {
      const agentScript = path.join(__dirname, '..', '..', '.claude', 'slave_agent_wrapper.py');

      agentProcess = spawn('python3', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(agentScript)}')
from slave_agent_wrapper import SlaveAgentWrapper, ResourceMonitor
import json

agent = SlaveAgentWrapper(project_dir='${testProjectDir}')
agent.initialize()

# Test resource monitor directly
monitor = ResourceMonitor(agent.agent_id)
usage = monitor.get_resource_usage()

result = {
  'has_cpu_percent': 'cpu_percent' in usage,
  'has_memory_mb': 'memory_mb' in usage,
  'has_disk_usage': 'disk_usage' in usage,
  'has_network_connections': 'network_connections' in usage,
  'has_timestamp': 'timestamp' in usage,
  'cpu_is_number': isinstance(usage.get('cpu_percent'), (int, float)),
  'memory_is_number': isinstance(usage.get('memory_mb'), (int, float))
}

print(json.dumps(result))
      `], {
        cwd: testProjectDir,
        stdio: 'pipe'
      });

      let stdout = '';
      agentProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise(resolve => {
        agentProcess.on('close', (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      const result = JSON.parse(stdout.trim());
      expect(result.has_cpu_percent).toBe(true);
      expect(result.has_memory_mb).toBe(true);
      expect(result.has_disk_usage).toBe(true);
      expect(result.has_network_connections).toBe(true);
      expect(result.has_timestamp).toBe(true);
      expect(result.cpu_is_number).toBe(true);
      expect(result.memory_is_number).toBe(true);
    });
  });
});