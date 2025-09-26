#!/usr/bin/env python3
"""
Master Agent Orchestrator - Core component of the master-slave agent architecture

This orchestrator manages the entire master-slave system, coordinating slave agents,
handling inter-agent communication, and providing high-level orchestration capabilities.
"""

import asyncio
import json
import time
import threading
import uuid
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any, Set, Callable
from enum import Enum
import subprocess
import psutil

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

class AgentRole(Enum):
    """Agent roles in the hierarchy"""
    MASTER = "master"
    SLAVE = "slave"
    COORDINATOR = "coordinator"

class AgentStatus(Enum):
    """Agent status states"""
    INITIALIZING = "initializing"
    READY = "ready"
    BUSY = "busy"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"
    TERMINATING = "terminating"

class MessageType(Enum):
    """Types of inter-agent messages"""
    TASK_ASSIGNMENT = "task_assignment"
    TASK_STATUS_UPDATE = "task_status_update"
    HEALTH_CHECK = "health_check"
    RESOURCE_REQUEST = "resource_request"
    COORDINATION_SIGNAL = "coordination_signal"
    ERROR_REPORT = "error_report"
    LOAD_BALANCE_REQUEST = "load_balance_request"

class AgentMessage:
    """Standardized message format for inter-agent communication"""

    def __init__(self, message_type: MessageType, sender_id: str, recipient_id: str,
                 payload: Dict[str, Any], message_id: Optional[str] = None):
        self.message_id = message_id or str(uuid.uuid4())
        self.message_type = message_type
        self.sender_id = sender_id
        self.recipient_id = recipient_id
        self.payload = payload
        self.timestamp = datetime.now()
        self.ttl = 300  # 5 minutes default TTL

    def to_dict(self) -> Dict[str, Any]:
        """Convert message to dictionary for serialization"""
        return {
            'message_id': self.message_id,
            'message_type': self.message_type.value,
            'sender_id': self.sender_id,
            'recipient_id': self.recipient_id,
            'payload': self.payload,
            'timestamp': self.timestamp.isoformat(),
            'ttl': self.ttl
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AgentMessage':
        """Create message from dictionary"""
        return cls(
            message_type=MessageType(data['message_type']),
            sender_id=data['sender_id'],
            recipient_id=data['recipient_id'],
            payload=data['payload'],
            message_id=data['message_id']
        )

class SlaveAgent:
    """Represents a slave agent in the system"""

    def __init__(self, agent_id: str, process_info: Dict[str, Any]):
        self.agent_id = agent_id
        self.process_info = process_info
        self.role = AgentRole.SLAVE
        self.status = AgentStatus.INITIALIZING
        self.last_heartbeat = datetime.now()
        self.capabilities: Set[str] = set()
        self.current_task: Optional[str] = None
        self.resource_usage = {
            'cpu_percent': 0.0,
            'memory_mb': 0.0,
            'tasks_completed': 0,
            'tasks_failed': 0
        }
        self.health_score = 100  # 0-100 health score

    def update_health(self, cpu_percent: float, memory_mb: float):
        """Update agent health based on resource usage"""
        self.resource_usage['cpu_percent'] = cpu_percent
        self.resource_usage['memory_mb'] = memory_mb

        # Calculate health score based on resource usage
        cpu_penalty = min(50, cpu_percent * 0.5)  # Max 50 points penalty for high CPU
        memory_penalty = min(30, memory_mb / 100)  # Max 30 points penalty for high memory
        age_penalty = min(20, (datetime.now() - self.last_heartbeat).total_seconds() / 3600)  # Age penalty

        self.health_score = max(0, 100 - cpu_penalty - memory_penalty - age_penalty)

    def is_healthy(self) -> bool:
        """Check if agent is healthy"""
        return self.health_score > 60 and self.status != AgentStatus.FAILED

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            'agent_id': self.agent_id,
            'role': self.role.value,
            'status': self.status.value,
            'last_heartbeat': self.last_heartbeat.isoformat(),
            'capabilities': list(self.capabilities),
            'current_task': self.current_task,
            'resource_usage': self.resource_usage,
            'health_score': self.health_score,
            'process_info': self.process_info
        }

class MasterAgentOrchestrator:
    """
    Master Agent Orchestrator - Central coordinator for the master-slave architecture

    Responsibilities:
    - Manage slave agent lifecycle
    - Coordinate task distribution
    - Handle inter-agent communication
    - Monitor system health
    - Implement load balancing
    - Provide fault tolerance
    """

    def __init__(self, project_dir: Optional[str] = None):
        self.project_dir = Path(project_dir or os.getcwd())
        self.claude_dir = self.project_dir / '.claude'
        self.config_file = self.claude_dir / 'master_orchestrator_config.json'
        self.message_queue_file = self.claude_dir / 'message_queue.json'

        # Core components
        self.master_id = f"master_{uuid.uuid4().hex[:8]}"
        self.slave_agents: Dict[str, SlaveAgent] = {}
        self.message_queue: List[AgentMessage] = []
        self.task_assignments: Dict[str, str] = {}  # task_id -> agent_id

        # Communication system
        self.vector_db: Optional[Any] = None  # Will be initialized later
        self.message_handlers: Dict[MessageType, Callable] = {}

        # Health monitoring
        self.health_check_interval = 30  # seconds
        self.agent_timeout = 120  # seconds
        self.max_slave_agents = 10

        # Load balancing
        self.load_balancer = self._create_load_balancer()

        # Threading and async
        self.is_running = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.message_thread: Optional[threading.Thread] = None

        # Callbacks
        self.status_callbacks: List[Callable] = []
        self.error_callbacks: List[Callable] = []

        # Initialize
        self._setup_directories()
        self._load_config()
        self._initialize_vector_db()
        self._setup_message_handlers()

    def _setup_directories(self):
        """Ensure required directories exist"""
        self.claude_dir.mkdir(exist_ok=True)
        (self.claude_dir / 'logs').mkdir(exist_ok=True)
        (self.claude_dir / 'vector_db').mkdir(exist_ok=True)

    def _load_config(self):
        """Load orchestrator configuration"""
        if self.config_file.exists():
            with open(self.config_file, 'r') as f:
                config = json.load(f)
                self.health_check_interval = config.get('health_check_interval', 30)
                self.agent_timeout = config.get('agent_timeout', 120)
                self.max_slave_agents = config.get('max_slave_agents', 10)

    def _save_config(self):
        """Save current configuration"""
        config = {
            'health_check_interval': self.health_check_interval,
            'agent_timeout': self.agent_timeout,
            'max_slave_agents': self.max_slave_agents,
            'master_id': self.master_id
        }
        with open(self.config_file, 'w') as f:
            json.dump(config, f, indent=2)

    def _initialize_vector_db(self):
        """Initialize vector database for communication"""
        if VECTOR_DB_AVAILABLE and VectorDatabase is not None:
            config = {
                'projectDir': str(self.project_dir),
                'collectionName': 'agent_communication',
                'maxRetries': 3,
                'retryDelay': 1000
            }
            self.vector_db = VectorDatabase(config)

    def _setup_message_handlers(self):
        """Setup handlers for different message types"""
        self.message_handlers = {
            MessageType.TASK_STATUS_UPDATE: self._handle_task_status_update,
            MessageType.HEALTH_CHECK: self._handle_health_check,
            MessageType.RESOURCE_REQUEST: self._handle_resource_request,
            MessageType.ERROR_REPORT: self._handle_error_report,
            MessageType.LOAD_BALANCE_REQUEST: self._handle_load_balance_request
        }

    def _create_load_balancer(self) -> Callable:
        """Create load balancing function"""
        def load_balancer(available_agents: List[SlaveAgent]) -> Optional[SlaveAgent]:
            """Simple load balancer based on health score and current load"""
            if not available_agents:
                return None

            # Sort by health score (descending) and then by current task (None first)
            sorted_agents = sorted(
                available_agents,
                key=lambda a: (a.health_score, a.current_task is None),
                reverse=True
            )

            return sorted_agents[0] if sorted_agents else None

        return load_balancer

    def discover_slave_agents(self):
        """Discover and register existing slave agents"""
        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time']):
                try:
                    cmdline = proc.info['cmdline']
                    if cmdline and 'opencode' in ' '.join(cmdline).lower():
                        # Skip master orchestrator and other non-agent processes
                        if any(x in ' '.join(cmdline) for x in ['orchestrator', 'master']):
                            continue

                        agent_id = f"slave_{proc.info['pid']}"
                        process_info = {
                            'pid': proc.info['pid'],
                            'name': proc.info['name'],
                            'cmdline': ' '.join(cmdline),
                            'create_time': proc.info['create_time']
                        }

                        if agent_id not in self.slave_agents:
                            slave = SlaveAgent(agent_id, process_info)
                            self.slave_agents[agent_id] = slave
                            logger.info(f"Discovered slave agent: {agent_id}")

                except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                    continue

        except Exception as e:
            logger.error(f"Error discovering slave agents: {e}")

    def register_slave_agent(self, agent_id: str, capabilities: Optional[List[str]] = None) -> bool:
        """Register a new slave agent"""
        if len(self.slave_agents) >= self.max_slave_agents:
            logger.warning(f"Maximum slave agents ({self.max_slave_agents}) reached")
            return False

        if agent_id in self.slave_agents:
            logger.warning(f"Agent {agent_id} already registered")
            return False

        # Create slave agent entry (will be populated when agent reports)
        slave = SlaveAgent(agent_id, {})
        slave.capabilities = set(capabilities or [])
        slave.status = AgentStatus.READY

        self.slave_agents[agent_id] = slave
        logger.info(f"Registered slave agent: {agent_id}")
        return True

    def unregister_slave_agent(self, agent_id: str):
        """Unregister a slave agent"""
        if agent_id in self.slave_agents:
            slave = self.slave_agents[agent_id]
            if slave.current_task:
                # Reassign task if agent was working on something
                self._reassign_task(slave.current_task, agent_id)

            del self.slave_agents[agent_id]
            logger.info(f"Unregistered slave agent: {agent_id}")

    def assign_task_to_agent(self, task_id: str, task_data: Dict[str, Any]) -> Optional[str]:
        """Assign a task to the best available agent"""
        available_agents = [
            agent for agent in self.slave_agents.values()
            if agent.is_healthy() and agent.status == AgentStatus.READY
        ]

        if not available_agents:
            logger.warning("No available agents for task assignment")
            return None

        # Use load balancer to select agent
        selected_agent = self.load_balancer(available_agents)
        if not selected_agent:
            return None

        # Assign task
        selected_agent.current_task = task_id
        selected_agent.status = AgentStatus.BUSY
        self.task_assignments[task_id] = selected_agent.agent_id

        # Send assignment message
        message = AgentMessage(
            MessageType.TASK_ASSIGNMENT,
            self.master_id,
            selected_agent.agent_id,
            {'task_id': task_id, 'task_data': task_data}
        )
        self._send_message(message)

        logger.info(f"Assigned task {task_id} to agent {selected_agent.agent_id}")
        return selected_agent.agent_id

    def _reassign_task(self, task_id: str, failed_agent_id: str):
        """Reassign a task from a failed agent"""
        if task_id in self.task_assignments:
            del self.task_assignments[task_id]

        # Find new agent for the task
        logger.info(f"Reassigning task {task_id} from failed agent {failed_agent_id}")

        # This would typically involve getting task data and reassigning
        # For now, just log the reassignment need

    def _send_message(self, message: AgentMessage):
        """Send message to agent via vector database or direct communication"""
        if self.vector_db:
            # Store message in vector database for agent to pick up
            asyncio.create_task(self._store_message_in_vector_db(message))
        else:
            # Fallback: store in local queue
            self.message_queue.append(message)
            self._save_message_queue()

    async def _store_message_in_vector_db(self, message: AgentMessage):
        """Store message in vector database"""
        if self.vector_db:
            try:
                document_text = f"Message from {message.sender_id} to {message.recipient_id}: {message.message_type.value}"
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

    def _save_message_queue(self):
        """Save message queue to file"""
        try:
            messages_data = [msg.to_dict() for msg in self.message_queue]
            with open(self.message_queue_file, 'w') as f:
                json.dump(messages_data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save message queue: {e}")

    def _load_message_queue(self):
        """Load message queue from file"""
        try:
            if self.message_queue_file.exists():
                with open(self.message_queue_file, 'r') as f:
                    messages_data = json.load(f)
                    self.message_queue = [AgentMessage.from_dict(data) for data in messages_data]
        except Exception as e:
            logger.error(f"Failed to load message queue: {e}")

    def process_incoming_messages(self):
        """Process messages from agents"""
        # Check vector database for new messages
        if self.vector_db:
            asyncio.create_task(self._process_vector_db_messages())

        # Process local queue messages
        messages_to_remove = []
        for message in self.message_queue:
            if self._process_message(message):
                messages_to_remove.append(message)

        # Remove processed messages
        for msg in messages_to_remove:
            self.message_queue.remove(msg)

        if messages_to_remove:
            self._save_message_queue()

    async def _process_vector_db_messages(self):
        """Process messages from vector database"""
        if not self.vector_db:
            return

        try:
            # Query for messages addressed to master
            messages = await self.vector_db.query_similar_solutions(
                f"recipient_id:{self.master_id}",
                limit=50
            )

            for msg_data in messages:
                try:
                    message = AgentMessage.from_dict(json.loads(msg_data['metadata']['data']))
                    if self._process_message(message):
                        # Mark message as processed (could delete or update status)
                        pass
                except Exception as e:
                    logger.error(f"Error processing vector DB message: {e}")

        except Exception as e:
            logger.error(f"Error processing vector DB messages: {e}")

    def _process_message(self, message: AgentMessage) -> bool:
        """Process a single message"""
        # Check TTL
        if (datetime.now() - message.timestamp).total_seconds() > message.ttl:
            logger.warning(f"Message {message.message_id} expired")
            return True  # Remove expired message

        # Route to appropriate handler
        handler = self.message_handlers.get(message.message_type)
        if handler:
            try:
                handler(message)
                return True
            except Exception as e:
                logger.error(f"Error handling message {message.message_type.value}: {e}")
                return False
        else:
            logger.warning(f"No handler for message type: {message.message_type.value}")
            return False

    def _handle_task_status_update(self, message: AgentMessage):
        """Handle task status update from slave agent"""
        payload = message.payload
        agent_id = message.sender_id
        task_id = payload.get('task_id')
        status = payload.get('status')

        if agent_id in self.slave_agents:
            agent = self.slave_agents[agent_id]

            if status == 'completed':
                agent.resource_usage['tasks_completed'] += 1
                agent.current_task = None
                agent.status = AgentStatus.READY
                if task_id in self.task_assignments:
                    del self.task_assignments[task_id]

            elif status == 'failed':
                agent.resource_usage['tasks_failed'] += 1
                agent.current_task = None
                agent.status = AgentStatus.READY
                # Could trigger retry logic here

            logger.info(f"Task {task_id} status update from {agent_id}: {status}")

    def _handle_health_check(self, message: AgentMessage):
        """Handle health check response from slave agent"""
        agent_id = message.sender_id
        if agent_id in self.slave_agents:
            agent = self.slave_agents[agent_id]
            agent.last_heartbeat = datetime.now()

            # Update resource usage
            payload = message.payload
            cpu_percent = payload.get('cpu_percent', 0)
            memory_mb = payload.get('memory_mb', 0)
            agent.update_health(cpu_percent, memory_mb)

    def _handle_resource_request(self, message: AgentMessage):
        """Handle resource request from slave agent"""
        # Could implement resource allocation logic here
        logger.info(f"Resource request from {message.sender_id}: {message.payload}")

    def _handle_error_report(self, message: AgentMessage):
        """Handle error report from slave agent"""
        agent_id = message.sender_id
        error_info = message.payload

        logger.error(f"Error reported by {agent_id}: {error_info}")

        # Mark agent as potentially unhealthy
        if agent_id in self.slave_agents:
            agent = self.slave_agents[agent_id]
            agent.health_score = max(0, agent.health_score - 20)

    def _handle_load_balance_request(self, message: AgentMessage):
        """Handle load balancing request"""
        # Could implement load balancing coordination here
        logger.info(f"Load balance request from {message.sender_id}")

    def health_monitoring_loop(self):
        """Main health monitoring loop"""
        while self.is_running:
            try:
                self._perform_health_checks()
                self._cleanup_failed_agents()
                time.sleep(self.health_check_interval)

            except Exception as e:
                logger.error(f"Error in health monitoring loop: {e}")
                time.sleep(5)

    def _perform_health_checks(self):
        """Perform health checks on all agents"""
        current_time = datetime.now()

        for agent_id, agent in list(self.slave_agents.items()):
            # Check for agent timeout
            if (current_time - agent.last_heartbeat).total_seconds() > self.agent_timeout:
                logger.warning(f"Agent {agent_id} timed out")
                agent.status = AgentStatus.UNAVAILABLE
                agent.health_score = 0

                # Try to restart agent
                if agent.process_info.get('pid'):
                    self._attempt_agent_restart(agent)

            # Send health check request
            health_message = AgentMessage(
                MessageType.HEALTH_CHECK,
                self.master_id,
                agent_id,
                {'request_timestamp': current_time.isoformat()}
            )
            self._send_message(health_message)

    def _cleanup_failed_agents(self):
        """Clean up failed or unhealthy agents"""
        agents_to_remove = []

        for agent_id, agent in self.slave_agents.items():
            if agent.health_score <= 0 or agent.status == AgentStatus.FAILED:
                agents_to_remove.append(agent_id)

                # Reassign any tasks
                if agent.current_task:
                    self._reassign_task(agent.current_task, agent_id)

        for agent_id in agents_to_remove:
            logger.info(f"Removing failed agent: {agent_id}")
            del self.slave_agents[agent_id]

    def _attempt_agent_restart(self, agent: SlaveAgent):
        """Attempt to restart a failed agent"""
        try:
            # This would implement agent restart logic
            # For now, just mark as failed
            agent.status = AgentStatus.FAILED
            logger.info(f"Marked agent {agent.agent_id} as failed (restart not implemented)")

        except Exception as e:
            logger.error(f"Failed to restart agent {agent.agent_id}: {e}")

    def message_processing_loop(self):
        """Main message processing loop"""
        while self.is_running:
            try:
                self.process_incoming_messages()
                time.sleep(5)  # Process messages every 5 seconds

            except Exception as e:
                logger.error(f"Error in message processing loop: {e}")
                time.sleep(5)

    def start(self):
        """Start the master orchestrator"""
        if self.is_running:
            return

        logger.info(f"Starting Master Agent Orchestrator ({self.master_id})")
        self.is_running = True

        # Load existing state
        self._load_message_queue()
        self.discover_slave_agents()

        # Start monitoring threads
        self.monitor_thread = threading.Thread(target=self.health_monitoring_loop, daemon=True)
        self.monitor_thread.start()

        self.message_thread = threading.Thread(target=self.message_processing_loop, daemon=True)
        self.message_thread.start()

        # Save configuration
        self._save_config()

    def stop(self):
        """Stop the master orchestrator"""
        if not self.is_running:
            return

        logger.info("Stopping Master Agent Orchestrator")
        self.is_running = False

        # Wait for threads to finish
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)

        if self.message_thread and self.message_thread.is_alive():
            self.message_thread.join(timeout=10)

        # Save final state
        self._save_message_queue()

    def get_system_status(self) -> Dict[str, Any]:
        """Get overall system status"""
        total_agents = len(self.slave_agents)
        healthy_agents = len([a for a in self.slave_agents.values() if a.is_healthy()])
        busy_agents = len([a for a in self.slave_agents.values() if a.status == AgentStatus.BUSY])

        return {
            'master_id': self.master_id,
            'total_agents': total_agents,
            'healthy_agents': healthy_agents,
            'busy_agents': busy_agents,
            'unhealthy_agents': total_agents - healthy_agents,
            'active_tasks': len(self.task_assignments),
            'pending_messages': len(self.message_queue),
            'system_health': (healthy_agents / max(1, total_agents)) * 100
        }

    def add_status_callback(self, callback: Callable):
        """Add status change callback"""
        self.status_callbacks.append(callback)

    def add_error_callback(self, callback: Callable):
        """Add error callback"""
        self.error_callbacks.append(callback)

# Global orchestrator instance
_orchestrator_instance: Optional[MasterAgentOrchestrator] = None

def get_orchestrator(project_dir: Optional[str] = None) -> MasterAgentOrchestrator:
    """Get or create the global orchestrator instance"""
    global _orchestrator_instance
    if _orchestrator_instance is None:
        _orchestrator_instance = MasterAgentOrchestrator(project_dir)
    return _orchestrator_instance

if __name__ == '__main__':
    # Test the orchestrator
    orchestrator = MasterAgentOrchestrator()

    try:
        orchestrator.start()
        logger.info("Master Orchestrator started. Press Ctrl+C to stop.")

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        logger.info("Shutting down orchestrator...")
        orchestrator.stop()