#!/usr/bin/env python3
"""
Slave Agent Wrapper - Extends OpenCode agents with master-slave communication capabilities

This wrapper enhances OpenCode agents to communicate with the master orchestrator,
report status, receive tasks, and participate in the distributed architecture.
"""

import asyncio
import json
import time
import threading
import uuid
import os
import psutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable
from enum import Enum
import subprocess
import sys

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

try:
    from vector_database import VectorDatabase
    VECTOR_DB_AVAILABLE = True
except ImportError:
    VECTOR_DB_AVAILABLE = False
    VectorDatabase = None
    logger.warning("Vector database not available, using basic communication")

try:
    from master_agent_orchestrator import (
        MasterAgentOrchestrator, AgentMessage, MessageType,
        get_orchestrator, AgentRole, AgentStatus
    )
    ORCHESTRATOR_AVAILABLE = True
except ImportError:
    ORCHESTRATOR_AVAILABLE = False
    logger.warning("Master orchestrator not available")

class SlaveAgentState(Enum):
    """States for slave agent operation"""
    INITIALIZING = "initializing"
    REGISTERING = "registering"
    READY = "ready"
    WORKING = "working"
    REPORTING = "reporting"
    ERROR = "error"
    SHUTTING_DOWN = "shutting_down"

class SlaveAgentWrapper:
    """
    Wrapper that extends OpenCode agents with master-slave communication capabilities

    Responsibilities:
    - Register with master orchestrator
    - Receive and execute tasks
    - Report status and health
    - Handle communication protocol
    - Manage agent lifecycle
    """

    def __init__(self, agent_id: Optional[str] = None, project_dir: Optional[str] = None,
                 capabilities: Optional[List[str]] = None):
        self.agent_id = agent_id or f"slave_{uuid.uuid4().hex[:8]}"
        self.project_dir = Path(project_dir or os.getcwd())
        self.claude_dir = self.project_dir / '.claude'

        # Core components
        self.orchestrator: Optional[MasterAgentOrchestrator] = None
        self.vector_db: Optional[Any] = None
        self.state = SlaveAgentState.INITIALIZING

        # Agent capabilities and status
        self.capabilities = set(capabilities or [
            'code_analysis', 'testing', 'debugging', 'refactoring',
            'documentation', 'performance', 'security'
        ])
        self.current_task: Optional[Dict[str, Any]] = None
        self.task_start_time: Optional[datetime] = None

        # Communication
        self.message_queue: List[AgentMessage] = []
        self.last_message_check = datetime.now()

        # Health monitoring
        self.health_check_interval = 30
        self.last_health_report = datetime.now()
        self.resource_monitor = ResourceMonitor(self.agent_id)

        # Callbacks
        self.task_callbacks: Dict[str, Callable] = {}
        self.status_callbacks: List[Callable] = []

        # Threading
        self.is_running = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.message_thread: Optional[threading.Thread] = None
        self.work_thread: Optional[threading.Thread] = None

        # Initialize
        self._setup_directories()

    def _setup_directories(self):
        """Ensure required directories exist"""
        self.claude_dir.mkdir(exist_ok=True)
        (self.claude_dir / 'logs').mkdir(exist_ok=True)
        (self.claude_dir / 'agent_data').mkdir(exist_ok=True)

    def initialize(self) -> bool:
        """Initialize the slave agent wrapper"""
        try:
            logger.info(f"Initializing slave agent: {self.agent_id}")

            # Initialize vector database for communication
            self._initialize_vector_db()

            # Connect to orchestrator
            self._connect_to_orchestrator()

            # Register with orchestrator
            self._register_with_orchestrator()

            self.state = SlaveAgentState.READY
            logger.info(f"Slave agent {self.agent_id} initialized successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to initialize slave agent {self.agent_id}: {e}")
            self.state = SlaveAgentState.ERROR
            return False

    def _initialize_vector_db(self):
        """Initialize vector database for communication"""
        if VECTOR_DB_AVAILABLE and VectorDatabase is not None:
            try:
                config = {
                    'projectDir': str(self.project_dir),
                    'collectionName': f'agent_{self.agent_id}',
                    'maxRetries': 3,
                    'retryDelay': 1000
                }
                self.vector_db = VectorDatabase(config)
                logger.info("Vector database initialized for communication")
            except Exception as e:
                logger.warning(f"Failed to initialize vector database: {e}")

    def _connect_to_orchestrator(self):
        """Connect to the master orchestrator"""
        if ORCHESTRATOR_AVAILABLE:
            try:
                self.orchestrator = get_orchestrator(str(self.project_dir))
                logger.info("Connected to master orchestrator")
            except Exception as e:
                logger.warning(f"Failed to connect to orchestrator: {e}")
        else:
            logger.warning("Master orchestrator not available")

    def _register_with_orchestrator(self):
        """Register this agent with the orchestrator"""
        if self.orchestrator:
            self.state = SlaveAgentState.REGISTERING
            success = self.orchestrator.register_slave_agent(
                self.agent_id,
                list(self.capabilities)
            )
            if success:
                logger.info(f"Successfully registered with orchestrator")
            else:
                logger.warning("Failed to register with orchestrator")

    def start(self):
        """Start the slave agent"""
        if self.is_running:
            return

        if self.state != SlaveAgentState.READY:
            logger.error(f"Cannot start agent in state: {self.state.value}")
            return

        logger.info(f"Starting slave agent: {self.agent_id}")
        self.is_running = True

        # Start monitoring threads
        self.monitor_thread = threading.Thread(target=self._health_monitor_loop, daemon=True)
        self.monitor_thread.start()

        self.message_thread = threading.Thread(target=self._message_processing_loop, daemon=True)
        self.message_thread.start()

        # Notify orchestrator that we're active
        self._send_status_update('ready')

    def stop(self):
        """Stop the slave agent"""
        if not self.is_running:
            return

        logger.info(f"Stopping slave agent: {self.agent_id}")
        self.is_running = False
        self.state = SlaveAgentState.SHUTTING_DOWN

        # Cancel current task if any
        if self.current_task:
            self._complete_task('cancelled', 'Agent shutting down')

        # Notify orchestrator
        self._send_status_update('shutdown')

        # Wait for threads
        threads_to_wait = []
        if self.monitor_thread and self.monitor_thread.is_alive():
            threads_to_wait.append(self.monitor_thread)
        if self.message_thread and self.message_thread.is_alive():
            threads_to_wait.append(self.message_thread)
        if self.work_thread and self.work_thread.is_alive():
            threads_to_wait.append(self.work_thread)

        for thread in threads_to_wait:
            thread.join(timeout=10)

    def _health_monitor_loop(self):
        """Main health monitoring loop"""
        while self.is_running:
            try:
                self._perform_health_check()
                time.sleep(self.health_check_interval)
            except Exception as e:
                logger.error(f"Error in health monitor loop: {e}")
                time.sleep(5)

    def _perform_health_check(self):
        """Perform health check and report to orchestrator"""
        try:
            # Get resource usage
            resources = self.resource_monitor.get_resource_usage()

            # Send health report
            health_data = {
                'agent_id': self.agent_id,
                'timestamp': datetime.now().isoformat(),
                'cpu_percent': resources['cpu_percent'],
                'memory_mb': resources['memory_mb'],
                'disk_usage': resources.get('disk_usage', {}),
                'network_connections': resources.get('network_connections', 0),
                'state': self.state.value,
                'current_task': self.current_task['task_id'] if self.current_task else None
            }

            self._send_health_report(health_data)
            self.last_health_report = datetime.now()

        except Exception as e:
            logger.error(f"Error performing health check: {e}")

    def _message_processing_loop(self):
        """Main message processing loop"""
        while self.is_running:
            try:
                self._check_for_messages()
                time.sleep(5)  # Check every 5 seconds
            except Exception as e:
                logger.error(f"Error in message processing loop: {e}")
                time.sleep(5)

    def _check_for_messages(self):
        """Check for new messages from orchestrator"""
        # Check vector database for messages
        if self.vector_db:
            asyncio.create_task(self._check_vector_db_messages())

        # Check local message queue
        self._process_local_messages()

    async def _check_vector_db_messages(self):
        """Check for messages in vector database"""
        if not self.vector_db:
            return

        try:
            # Query for messages addressed to this agent
            messages = await self.vector_db.query_similar_solutions(
                f"recipient_id:{self.agent_id}",
                limit=10
            )

            for msg_data in messages:
                try:
                    message = AgentMessage.from_dict(json.loads(msg_data['metadata']['data']))
                    if self._process_message(message):
                        # Mark as processed
                        pass
                except Exception as e:
                    logger.error(f"Error processing vector DB message: {e}")

        except Exception as e:
            logger.error(f"Error checking vector DB messages: {e}")

    def _process_local_messages(self):
        """Process messages in local queue"""
        # This would be populated by direct communication if vector DB is unavailable
        pass

    def _process_message(self, message: AgentMessage) -> bool:
        """Process a received message"""
        try:
            if message.message_type == MessageType.TASK_ASSIGNMENT:
                self._handle_task_assignment(message)
            elif message.message_type == MessageType.HEALTH_CHECK:
                self._handle_health_check_request(message)
            elif message.message_type == MessageType.COORDINATION_SIGNAL:
                self._handle_coordination_signal(message)
            else:
                logger.warning(f"Unknown message type: {message.message_type.value}")

            return True

        except Exception as e:
            logger.error(f"Error processing message {message.message_type.value}: {e}")
            return False

    def _handle_task_assignment(self, message: AgentMessage):
        """Handle task assignment from orchestrator"""
        payload = message.payload
        task_id = payload.get('task_id')
        task_data = payload.get('task_data', {})

        logger.info(f"Received task assignment: {task_id}")

        if self.current_task:
            # Already working on a task, reject this one
            self._send_task_status_update(task_id, 'rejected', 'Agent busy')
            return

        # Accept the task
        self.current_task = {
            'task_id': task_id,
            'data': task_data,
            'assigned_at': datetime.now()
        }
        self.task_start_time = datetime.now()
        self.state = SlaveAgentState.WORKING

        # Start working on the task
        self.work_thread = threading.Thread(target=self._execute_task, daemon=True)
        self.work_thread.start()

        # Send acceptance
        self._send_task_status_update(task_id, 'accepted')

    def _handle_health_check_request(self, message: AgentMessage):
        """Handle health check request from orchestrator"""
        # Health check is already performed in the monitor loop
        # Just acknowledge
        logger.debug("Health check request acknowledged")

    def _handle_coordination_signal(self, message: AgentMessage):
        """Handle coordination signal from orchestrator"""
        signal_type = message.payload.get('signal_type')
        logger.info(f"Received coordination signal: {signal_type}")

        if signal_type == 'shutdown':
            self.stop()
        elif signal_type == 'pause':
            self.state = SlaveAgentState.READY
        elif signal_type == 'resume':
            self.state = SlaveAgentState.READY

    def _execute_task(self):
        """Execute the assigned task"""
        if not self.current_task:
            return

        task_id = self.current_task['task_id']
        task_data = self.current_task['data']

        try:
            logger.info(f"Starting execution of task: {task_id}")

            # Execute the actual OpenCode agent work
            success = self._perform_task_work(task_data)

            if success:
                self._complete_task('completed', 'Task completed successfully')
            else:
                self._complete_task('failed', 'Task execution failed')

        except Exception as e:
            logger.error(f"Error executing task {task_id}: {e}")
            self._complete_task('failed', str(e))

    def _perform_task_work(self, task_data: Dict[str, Any]) -> bool:
        """Perform the actual task work using OpenCode agent"""
        try:
            # Extract task parameters
            objective = task_data.get('description', '')
            files_pattern = task_data.get('files_pattern', '**/*')
            task_type = task_data.get('type', 'general')

            # Prepare the command for OpenCode agent
            prompt = f"""
Task: {objective}
Type: {task_type}
Files to examine: {files_pattern}

Please analyze the code and implement improvements.
"""

            # Execute OpenCode agent
            cmd = ['opencode', 'run', prompt]
            log_file = self.claude_dir / 'logs' / f"{self.current_task['task_id']}.log"

            with open(log_file, 'w') as log:
                result = subprocess.run(
                    cmd,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    cwd=str(self.project_dir),
                    timeout=3600  # 1 hour timeout
                )

            return result.returncode == 0

        except subprocess.TimeoutExpired:
            logger.error(f"Task {self.current_task['task_id']} timed out")
            return False
        except Exception as e:
            logger.error(f"Error in task execution: {e}")
            return False

    def _complete_task(self, status: str, message: str = ""):
        """Complete the current task"""
        if not self.current_task:
            return

        task_id = self.current_task['task_id']

        # Calculate duration
        duration = None
        if self.task_start_time:
            duration = (datetime.now() - self.task_start_time).total_seconds()

        # Send completion status
        self._send_task_status_update(task_id, status, message, duration)

        # Reset state
        self.current_task = None
        self.task_start_time = None
        self.state = SlaveAgentState.READY

        logger.info(f"Task {task_id} completed with status: {status}")

    def _send_task_status_update(self, task_id: str, status: str, message: str = "", duration: Optional[float] = None):
        """Send task status update to orchestrator"""
        if not self.orchestrator:
            return

        payload = {
            'task_id': task_id,
            'status': status,
            'message': message,
            'timestamp': datetime.now().isoformat(),
            'agent_id': self.agent_id
        }

        if duration is not None:
            payload['duration'] = duration

        message = AgentMessage(
            MessageType.TASK_STATUS_UPDATE,
            self.agent_id,
            self.orchestrator.master_id,
            payload
        )

        self._send_message(message)

    def _send_health_report(self, health_data: Dict[str, Any]):
        """Send health report to orchestrator"""
        if not self.orchestrator:
            return

        message = AgentMessage(
            MessageType.HEALTH_CHECK,
            self.agent_id,
            self.orchestrator.master_id,
            health_data
        )

        self._send_message(message)

    def _send_status_update(self, status: str):
        """Send general status update"""
        if not self.orchestrator:
            return

        message = AgentMessage(
            MessageType.COORDINATION_SIGNAL,
            self.agent_id,
            self.orchestrator.master_id,
            {
                'status': status,
                'agent_id': self.agent_id,
                'timestamp': datetime.now().isoformat()
            }
        )

        self._send_message(message)

    def _send_message(self, message: AgentMessage):
        """Send message via available communication channel"""
        if self.vector_db:
            # Send via vector database
            asyncio.create_task(self._store_message_in_vector_db(message))
        else:
            # Fallback: add to local queue (would be picked up by orchestrator)
            self.message_queue.append(message)

    async def _store_message_in_vector_db(self, message: AgentMessage):
        """Store message in vector database"""
        if self.vector_db:
            try:
                document_text = f"Message from {message.sender_id}: {message.message_type.value}"
                metadata = {
                    'message_id': message.message_id,
                    'message_type': message.message_type.value,
                    'sender_id': message.sender_id,
                    'recipient_id': message.recipient_id,
                    'timestamp': message.timestamp.isoformat(),
                    'ttl': message.ttl,
                    'payload': json.dumps(message.payload)
                }

                await self.vector_db.store_task_history({
                    'taskId': message.message_id,
                    'type': 'message',
                    'description': document_text,
                    'status': 'sent',
                    'startTime': message.timestamp.isoformat(),
                    'data': message.to_dict()
                })

            except Exception as e:
                logger.error(f"Failed to store message in vector DB: {e}")

    def add_task_callback(self, task_type: str, callback: Callable):
        """Add callback for specific task types"""
        self.task_callbacks[task_type] = callback

    def add_status_callback(self, callback: Callable):
        """Add status change callback"""
        self.status_callbacks.append(callback)

    def get_status(self) -> Dict[str, Any]:
        """Get current agent status"""
        return {
            'agent_id': self.agent_id,
            'state': self.state.value,
            'current_task': self.current_task['task_id'] if self.current_task else None,
            'capabilities': list(self.capabilities),
            'last_health_report': self.last_health_report.isoformat(),
            'uptime': (datetime.now() - datetime.fromisoformat(
                (self.claude_dir / 'agent_data' / f"{self.agent_id}_start_time.txt")
                .read_text() if (self.claude_dir / 'agent_data' / f"{self.agent_id}_start_time.txt").exists()
                else datetime.now().isoformat()
            )).total_seconds() if self.is_running else 0
        }

class ResourceMonitor:
    """Monitor system resources for the agent"""

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.process = psutil.Process()

    def get_resource_usage(self) -> Dict[str, Any]:
        """Get current resource usage"""
        try:
            cpu_percent = self.process.cpu_percent(interval=1)
            memory_info = self.process.memory_info()
            memory_mb = memory_info.rss / 1024 / 1024

            # Get disk usage
            disk_usage = psutil.disk_usage('/')
            disk_percent = disk_usage.percent

            # Get network connections
            connections = len(self.process.connections())

            return {
                'cpu_percent': cpu_percent,
                'memory_mb': memory_mb,
                'disk_usage': {
                    'percent': disk_percent,
                    'free_gb': disk_usage.free / (1024**3)
                },
                'network_connections': connections,
                'timestamp': datetime.now().isoformat()
            }

        except Exception as e:
            logger.error(f"Error getting resource usage: {e}")
            return {
                'cpu_percent': 0.0,
                'memory_mb': 0.0,
                'disk_usage': {'percent': 0.0, 'free_gb': 0.0},
                'network_connections': 0,
                'timestamp': datetime.now().isoformat()
            }

# Global agent instance
_agent_instance: Optional[SlaveAgentWrapper] = None

def get_slave_agent(project_dir: Optional[str] = None, capabilities: Optional[List[str]] = None) -> SlaveAgentWrapper:
    """Get or create the global slave agent instance"""
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = SlaveAgentWrapper(project_dir=project_dir, capabilities=capabilities)
        if not _agent_instance.initialize():
            logger.error("Failed to initialize slave agent")
            return None
    return _agent_instance

if __name__ == '__main__':
    # Test the slave agent wrapper
    agent = SlaveAgentWrapper()

    if agent.initialize():
        try:
            agent.start()
            logger.info("Slave agent started. Press Ctrl+C to stop.")

            while True:
                time.sleep(1)

        except KeyboardInterrupt:
            logger.info("Shutting down slave agent...")
            agent.stop()
    else:
        logger.error("Failed to initialize slave agent")