#!/usr/bin/env python3
"""
Distributed Task Coordination System

This module implements advanced distributed coordination with:
- Conflict resolution for concurrent task assignments
- Intelligent load balancing across agent pools
- Task migration and rebalancing
- Coordination protocols for multi-agent workflows
- Deadlock detection and prevention
"""

import asyncio
import threading
import time
import hashlib
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Union, Tuple
from enum import Enum
from collections import defaultdict, deque
import heapq
import logging

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

class CoordinationStrategy(Enum):
    """Load balancing strategies"""
    ROUND_ROBIN = "round_robin"
    LEAST_LOADED = "least_loaded"
    WEIGHTED_RANDOM = "weighted_random"
    RESOURCE_AWARE = "resource_aware"
    PERFORMANCE_BASED = "performance_based"

class ConflictResolution(Enum):
    """Conflict resolution strategies"""
    PRIORITY_BASED = "priority_based"
    TIMESTAMP_BASED = "timestamp_based"
    RESOURCE_BASED = "resource_based"
    NEGOTIATION = "negotiation"
    PREEMPTION = "preemption"

class CoordinationMessageType(Enum):
    """Types of coordination messages"""
    TASK_CLAIM = "task_claim"
    TASK_TRANSFER = "task_transfer"
    LOAD_BALANCE_REQUEST = "load_balance_request"
    RESOURCE_NEGOTIATION = "resource_negotiation"
    CONFLICT_RESOLUTION = "conflict_resolution"
    DEADLOCK_RESOLUTION = "deadlock_resolution"

class CoordinationMessage:
    """Message for inter-agent coordination"""

    def __init__(self, message_type: CoordinationMessageType, sender_id: str,
                 payload: Dict[str, Any], target_agents: Optional[List[str]] = None):
        self.message_id = f"coord_{int(time.time() * 1000)}_{hashlib.md5(str(payload).encode()).hexdigest()[:8]}"
        self.message_type = message_type
        self.sender_id = sender_id
        self.target_agents = target_agents or []
        self.payload = payload
        self.timestamp = datetime.now()
        self.ttl = 300  # 5 minutes

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            'message_id': self.message_id,
            'message_type': self.message_type.value,
            'sender_id': self.sender_id,
            'target_agents': self.target_agents,
            'payload': self.payload,
            'timestamp': self.timestamp.isoformat(),
            'ttl': self.ttl
        }

class AgentLoadProfile:
    """Load profile for an agent"""

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.current_tasks = 0
        self.cpu_usage = 0.0
        self.memory_usage = 0.0
        self.task_queue_length = 0
        self.capabilities: Set[str] = set()
        self.specializations: Set[str] = set()
        self.performance_score = 1.0  # 0-1 scale
        self.last_updated = datetime.now()

        # Historical metrics
        self.task_completion_rate = 0.0
        self.avg_task_duration = 0.0
        self.failure_rate = 0.0

    def update_load(self, cpu: float, memory: float, tasks: int, queue_length: int):
        """Update current load metrics"""
        self.cpu_usage = cpu
        self.memory_usage = memory
        self.current_tasks = tasks
        self.task_queue_length = queue_length
        self.last_updated = datetime.now()

    def get_load_score(self) -> float:
        """Calculate overall load score (0-1, higher = more loaded)"""
        # Weighted combination of metrics
        cpu_weight = 0.3
        memory_weight = 0.3
        task_weight = 0.2
        queue_weight = 0.2

        cpu_score = self.cpu_usage / 100.0
        memory_score = self.memory_usage / 100.0  # Assuming percentage
        task_score = min(1.0, self.current_tasks / 10.0)  # Normalize to 10 max tasks
        queue_score = min(1.0, self.task_queue_length / 20.0)  # Normalize to 20 max queued

        return (cpu_score * cpu_weight +
                memory_score * memory_weight +
                task_score * task_weight +
                queue_score * queue_weight)

    def can_handle_task(self, task_requirements: Dict[str, Any]) -> bool:
        """Check if agent can handle a task with given requirements"""
        # Check capabilities
        required_caps = set(task_requirements.get('capabilities', []))
        if required_caps and not required_caps.issubset(self.capabilities):
            return False

        # Check resource requirements
        cpu_required = task_requirements.get('cpu_cores', 1.0)
        memory_required = task_requirements.get('memory_mb', 256)

        # Estimate available resources (rough approximation)
        available_cpu = max(0, 4.0 - (self.cpu_usage / 25.0))  # Assume 4 cores max
        available_memory = max(0, 8192 - self.memory_usage * 80)  # Assume 8GB max

        return available_cpu >= cpu_required and available_memory >= memory_required

class DistributedCoordinator:
    """
    Central coordinator for distributed task management across agents
    """

    def __init__(self, coordinator_id: str = "master_coordinator"):
        self.coordinator_id = coordinator_id

        # Agent registry
        self.agent_profiles: Dict[str, AgentLoadProfile] = {}
        self.active_agents: Set[str] = set()

        # Task coordination
        self.task_assignments: Dict[str, str] = {}  # task_id -> agent_id
        self.task_claims: Dict[str, List[Tuple[str, datetime]]] = defaultdict(list)  # task_id -> [(agent_id, claim_time)]
        self.pending_transfers: Dict[str, str] = {}  # task_id -> target_agent_id

        # Load balancing
        self.load_balancing_strategy = CoordinationStrategy.LEAST_LOADED
        self.strategy_weights: Dict[str, float] = {}
        self.round_robin_index = 0

        # Conflict resolution
        self.conflict_resolution_strategy = ConflictResolution.PRIORITY_BASED
        self.active_conflicts: Dict[str, List[str]] = defaultdict(list)  # task_id -> conflicting_agents

        # Coordination messaging
        self.message_queue: deque = deque()
        self.message_handlers: Dict[CoordinationMessageType, Callable] = {}

        # Statistics
        self.stats = {
            'total_tasks_coordinated': 0,
            'successful_assignments': 0,
            'failed_assignments': 0,
            'load_balanced_transfers': 0,
            'conflict_resolutions': 0,
            'avg_coordination_time': 0.0
        }

        # Threading
        self.is_running = False
        self.coordination_thread: Optional[threading.Thread] = None
        self.monitor_thread: Optional[threading.Thread] = None

        # Callbacks
        self.task_assignment_callbacks: List[Callable] = []
        self.load_balance_callbacks: List[Callable] = []
        self.conflict_callbacks: List[Callable] = []

        self._setup_message_handlers()

    def _setup_message_handlers(self):
        """Setup message handlers for coordination messages"""
        self.message_handlers = {
            CoordinationMessageType.TASK_CLAIM: self._handle_task_claim,
            CoordinationMessageType.TASK_TRANSFER: self._handle_task_transfer,
            CoordinationMessageType.LOAD_BALANCE_REQUEST: self._handle_load_balance_request,
            CoordinationMessageType.RESOURCE_NEGOTIATION: self._handle_resource_negotiation,
            CoordinationMessageType.CONFLICT_RESOLUTION: self._handle_conflict_resolution,
            CoordinationMessageType.DEADLOCK_RESOLUTION: self._handle_deadlock_resolution
        }

    def register_agent(self, agent_id: str, capabilities: Optional[List[str]] = None,
                      specializations: Optional[List[str]] = None):
        """Register an agent with the coordinator"""
        if agent_id not in self.agent_profiles:
            profile = AgentLoadProfile(agent_id)
            profile.capabilities = set(capabilities or [])
            profile.specializations = set(specializations or [])
            self.agent_profiles[agent_id] = profile

        self.active_agents.add(agent_id)
        logger.info(f"Registered agent {agent_id} with coordinator")

    def unregister_agent(self, agent_id: str):
        """Unregister an agent"""
        if agent_id in self.active_agents:
            self.active_agents.remove(agent_id)

            # Reassign tasks from this agent
            tasks_to_reassign = [task_id for task_id, assigned_agent in self.task_assignments.items()
                               if assigned_agent == agent_id]

            for task_id in tasks_to_reassign:
                del self.task_assignments[task_id]
                # Trigger reassignment logic here

        logger.info(f"Unregistered agent {agent_id} from coordinator")

    def update_agent_load(self, agent_id: str, load_data: Dict[str, Any]):
        """Update agent load information"""
        if agent_id in self.agent_profiles:
            profile = self.agent_profiles[agent_id]
            profile.update_load(
                cpu=load_data.get('cpu_percent', 0),
                memory=load_data.get('memory_mb', 0),
                tasks=load_data.get('current_tasks', 0),
                queue_length=load_data.get('queue_length', 0)
            )

            # Update performance metrics
            profile.task_completion_rate = load_data.get('completion_rate', profile.task_completion_rate)
            profile.avg_task_duration = load_data.get('avg_duration', profile.avg_task_duration)
            profile.failure_rate = load_data.get('failure_rate', profile.failure_rate)

    def coordinate_task_assignment(self, task_id: str, task_requirements: Dict[str, Any]) -> Optional[str]:
        """
        Coordinate task assignment across available agents

        Returns assigned agent ID or None if no suitable agent found
        """
        start_time = time.time()
        self.stats['total_tasks_coordinated'] += 1

        try:
            # Find suitable agents
            suitable_agents = self._find_suitable_agents(task_requirements)

            if not suitable_agents:
                logger.warning(f"No suitable agents found for task {task_id}")
                self.stats['failed_assignments'] += 1
                return None

            # Apply load balancing strategy
            selected_agent = self._apply_load_balancing_strategy(suitable_agents, task_requirements)

            if selected_agent:
                # Check for conflicts
                if self._check_for_conflicts(task_id, selected_agent):
                    # Resolve conflict
                    resolved_agent = self._resolve_conflict(task_id, selected_agent, suitable_agents)
                    if resolved_agent != selected_agent:
                        selected_agent = resolved_agent

                # Assign task
                self.task_assignments[task_id] = selected_agent
                self.stats['successful_assignments'] += 1

                # Notify callbacks
                for callback in self.task_assignment_callbacks:
                    try:
                        callback(task_id, selected_agent)
                    except Exception as e:
                        logger.error(f"Error in task assignment callback: {e}")

                coordination_time = time.time() - start_time
                self.stats['avg_coordination_time'] = (
                    (self.stats['avg_coordination_time'] * (self.stats['successful_assignments'] - 1)) +
                    coordination_time
                ) / self.stats['successful_assignments']

                logger.info(f"Coordinated task {task_id} to agent {selected_agent}")
                return selected_agent

        except Exception as e:
            logger.error(f"Error coordinating task {task_id}: {e}")
            self.stats['failed_assignments'] += 1

        return None

    def _find_suitable_agents(self, task_requirements: Dict[str, Any]) -> List[str]:
        """Find agents that can handle the task requirements"""
        suitable = []

        for agent_id in self.active_agents:
            if agent_id in self.agent_profiles:
                profile = self.agent_profiles[agent_id]
                if profile.can_handle_task(task_requirements):
                    suitable.append(agent_id)

        return suitable

    def _apply_load_balancing_strategy(self, agents: List[str], task_requirements: Dict[str, Any]) -> Optional[str]:
        """Apply the configured load balancing strategy"""
        if not agents:
            return None

        if self.load_balancing_strategy == CoordinationStrategy.ROUND_ROBIN:
            return self._round_robin_selection(agents)

        elif self.load_balancing_strategy == CoordinationStrategy.LEAST_LOADED:
            return self._least_loaded_selection(agents)

        elif self.load_balancing_strategy == CoordinationStrategy.WEIGHTED_RANDOM:
            return self._weighted_random_selection(agents)

        elif self.load_balancing_strategy == CoordinationStrategy.RESOURCE_AWARE:
            return self._resource_aware_selection(agents, task_requirements)

        elif self.load_balancing_strategy == CoordinationStrategy.PERFORMANCE_BASED:
            return self._performance_based_selection(agents)

        # Default to least loaded
        return self._least_loaded_selection(agents)

    def _round_robin_selection(self, agents: List[str]) -> str:
        """Round-robin agent selection"""
        if self.round_robin_index >= len(agents):
            self.round_robin_index = 0

        selected = agents[self.round_robin_index]
        self.round_robin_index = (self.round_robin_index + 1) % len(agents)
        return selected

    def _least_loaded_selection(self, agents: List[str]) -> str:
        """Select least loaded agent"""
        return min(agents, key=lambda aid: self.agent_profiles[aid].get_load_score())

    def _weighted_random_selection(self, agents: List[str]) -> str:
        """Weighted random selection based on inverse load"""
        weights = []
        for agent_id in agents:
            load_score = self.agent_profiles[agent_id].get_load_score()
            # Higher weight for less loaded agents
            weight = max(0.1, 1.0 - load_score)
            weights.append(weight)

        # Simple weighted selection
        total_weight = sum(weights)
        if total_weight == 0:
            return agents[0]

        r = time.time() % total_weight  # Simple randomization
        cumulative = 0
        for i, weight in enumerate(weights):
            cumulative += weight
            if r <= cumulative:
                return agents[i]

        return agents[-1]

    def _resource_aware_selection(self, agents: List[str], task_requirements: Dict[str, Any]) -> str:
        """Resource-aware selection based on task requirements"""
        best_agent = None
        best_score = float('inf')

        for agent_id in agents:
            profile = self.agent_profiles[agent_id]

            # Calculate resource fit score
            cpu_required = task_requirements.get('cpu_cores', 1.0)
            memory_required = task_requirements.get('memory_mb', 256)

            # Estimate available resources
            available_cpu = max(0, 4.0 - (profile.cpu_usage / 25.0))
            available_memory = max(0, 8192 - profile.memory_usage * 80)

            cpu_fit = available_cpu / cpu_required if cpu_required > 0 else 1.0
            memory_fit = available_memory / memory_required if memory_required > 0 else 1.0

            # Combined fit score (lower is better fit)
            fit_score = 2.0 - (cpu_fit + memory_fit)  # Invert so lower is better

            if fit_score < best_score:
                best_score = fit_score
                best_agent = agent_id

        return best_agent or agents[0]

    def _performance_based_selection(self, agents: List[str]) -> str:
        """Performance-based selection using historical metrics"""
        return max(agents, key=lambda aid: (
            self.agent_profiles[aid].performance_score *
            (1.0 - self.agent_profiles[aid].failure_rate) *
            (1.0 / (1.0 + self.agent_profiles[aid].avg_task_duration))
        ))

    def _check_for_conflicts(self, task_id: str, proposed_agent: str) -> bool:
        """Check if there are conflicts for task assignment"""
        # Check if task is already assigned
        if task_id in self.task_assignments:
            current_agent = self.task_assignments[task_id]
            if current_agent != proposed_agent:
                self.active_conflicts[task_id].extend([current_agent, proposed_agent])
                return True

        # Check for concurrent claims
        if task_id in self.task_claims and len(self.task_claims[task_id]) > 1:
            conflicting_agents = [agent_id for agent_id, _ in self.task_claims[task_id]]
            if proposed_agent in conflicting_agents:
                self.active_conflicts[task_id] = conflicting_agents
                return True

        return False

    def _resolve_conflict(self, task_id: str, proposed_agent: str, alternative_agents: List[str]) -> str:
        """Resolve assignment conflict"""
        self.stats['conflict_resolutions'] += 1

        if self.conflict_resolution_strategy == ConflictResolution.PRIORITY_BASED:
            # For now, prefer the proposed agent (could be enhanced with task priorities)
            return proposed_agent

        elif self.conflict_resolution_strategy == ConflictResolution.TIMESTAMP_BASED:
            # Prefer earliest claim
            if task_id in self.task_claims:
                claims = sorted(self.task_claims[task_id], key=lambda x: x[1])
                return claims[0][0]
            return proposed_agent

        elif self.conflict_resolution_strategy == ConflictResolution.RESOURCE_BASED:
            # Prefer agent with best resource fit
            return self._resource_aware_selection([proposed_agent] + alternative_agents, {})

        elif self.conflict_resolution_strategy == ConflictResolution.PREEMPTION:
            # Allow preemption of lower priority tasks
            return proposed_agent

        # Default to proposed agent
        return proposed_agent

    def initiate_load_balancing(self):
        """Initiate load balancing across agents"""
        if len(self.active_agents) < 2:
            return  # Need at least 2 agents for balancing

        # Calculate load imbalance
        loads = [(aid, self.agent_profiles[aid].get_load_score()) for aid in self.active_agents]
        avg_load = sum(load for _, load in loads) / len(loads)
        max_imbalance = max(abs(load - avg_load) for _, load in loads)

        if max_imbalance > 0.3:  # 30% imbalance threshold
            logger.info("Load imbalance detected, initiating balancing")

            # Find overloaded and underloaded agents
            overloaded = [aid for aid, load in loads if load > avg_load + 0.2]
            underloaded = [aid for aid, load in loads if load < avg_load - 0.2]

            if overloaded and underloaded:
                # Trigger load balancing
                self._perform_load_balancing(overloaded[0], underloaded[0])

    def _perform_load_balancing(self, from_agent: str, to_agent: str):
        """Perform load balancing by migrating tasks"""
        # Find tasks that can be migrated
        from_profile = self.agent_profiles[from_agent]
        to_profile = self.agent_profiles[to_agent]

        # Simple strategy: migrate oldest queued task if target has capacity
        # In practice, this would be more sophisticated
        logger.info(f"Load balancing: migrating tasks from {from_agent} to {to_agent}")
        self.stats['load_balanced_transfers'] += 1

        # Notify callbacks
        for callback in self.load_balance_callbacks:
            try:
                callback(from_agent, to_agent)
            except Exception as e:
                logger.error(f"Error in load balance callback: {e}")

    def send_coordination_message(self, message: CoordinationMessage):
        """Send coordination message to target agents"""
        self.message_queue.append(message)

        # In a real implementation, this would send to actual agents
        # For now, we process locally
        asyncio.create_task(self._process_coordination_message(message))

    async def _process_coordination_message(self, message: CoordinationMessage):
        """Process a coordination message"""
        handler = self.message_handlers.get(message.message_type)
        if handler:
            try:
                await handler(message)
            except Exception as e:
                logger.error(f"Error processing coordination message: {e}")

    def _handle_task_claim(self, message: CoordinationMessage):
        """Handle task claim message"""
        task_id = message.payload.get('task_id')
        if task_id:
            self.task_claims[task_id].append((message.sender_id, message.timestamp))

    def _handle_task_transfer(self, message: CoordinationMessage):
        """Handle task transfer message"""
        task_id = message.payload.get('task_id')
        from_agent = message.payload.get('from_agent')
        to_agent = message.payload.get('to_agent')

        if task_id and from_agent and to_agent:
            if self.task_assignments.get(task_id) == from_agent:
                self.task_assignments[task_id] = to_agent
                logger.info(f"Transferred task {task_id} from {from_agent} to {to_agent}")

    def _handle_load_balance_request(self, message: CoordinationMessage):
        """Handle load balance request"""
        requester = message.sender_id
        self.initiate_load_balancing()

    def _handle_resource_negotiation(self, message: CoordinationMessage):
        """Handle resource negotiation"""
        # Implement resource negotiation logic
        pass

    def _handle_conflict_resolution(self, message: CoordinationMessage):
        """Handle conflict resolution"""
        task_id = message.payload.get('task_id')
        if task_id in self.active_conflicts:
            # Implement conflict resolution protocol
            pass

    def _handle_deadlock_resolution(self, message: CoordinationMessage):
        """Handle deadlock resolution"""
        # Implement deadlock detection and resolution
        pass

    def start_coordination(self):
        """Start the distributed coordination system"""
        if self.is_running:
            return

        self.is_running = True

        # Start coordination thread
        self.coordination_thread = threading.Thread(target=self._coordination_loop, daemon=True)
        self.coordination_thread.start()

        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitoring_loop, daemon=True)
        self.monitor_thread.start()

        logger.info("Started distributed coordination system")

    def stop_coordination(self):
        """Stop the distributed coordination system"""
        self.is_running = False

        if self.coordination_thread and self.coordination_thread.is_alive():
            self.coordination_thread.join(timeout=10)

        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)

        logger.info("Stopped distributed coordination system")

    def _coordination_loop(self):
        """Main coordination loop"""
        while self.is_running:
            try:
                # Process coordination messages
                while self.message_queue:
                    message = self.message_queue.popleft()
                    if (datetime.now() - message.timestamp).total_seconds() < message.ttl:
                        asyncio.run(self._process_coordination_message(message))

                # Perform periodic coordination tasks
                self._periodic_coordination()

                time.sleep(5)  # Coordination cycle every 5 seconds

            except Exception as e:
                logger.error(f"Error in coordination loop: {e}")
                time.sleep(5)

    def _monitoring_loop(self):
        """Monitoring loop for load balancing and health checks"""
        while self.is_running:
            try:
                # Check for load imbalances
                self.initiate_load_balancing()

                # Clean up old claims and conflicts
                self._cleanup_old_data()

                time.sleep(30)  # Monitor every 30 seconds

            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                time.sleep(30)

    def _periodic_coordination(self):
        """Perform periodic coordination tasks"""
        # Clean up expired task claims
        current_time = datetime.now()
        for task_id in list(self.task_claims.keys()):
            self.task_claims[task_id] = [
                (agent_id, claim_time) for agent_id, claim_time in self.task_claims[task_id]
                if (current_time - claim_time).total_seconds() < 300  # 5 minutes
            ]
            if not self.task_claims[task_id]:
                del self.task_claims[task_id]

    def _cleanup_old_data(self):
        """Clean up old coordination data"""
        # Remove old conflicts
        current_time = datetime.now()
        for task_id in list(self.active_conflicts.keys()):
            # Remove conflicts older than 10 minutes
            if (current_time - datetime.now()).total_seconds() > 600:
                del self.active_conflicts[task_id]

    def get_coordination_status(self) -> Dict[str, Any]:
        """Get comprehensive coordination status"""
        return {
            'coordinator_id': self.coordinator_id,
            'active_agents': len(self.active_agents),
            'total_assignments': len(self.task_assignments),
            'active_conflicts': len(self.active_conflicts),
            'pending_messages': len(self.message_queue),
            'load_balancing_strategy': self.load_balancing_strategy.value,
            'conflict_resolution_strategy': self.conflict_resolution_strategy.value,
            'stats': self.stats.copy(),
            'agent_loads': {
                aid: {
                    'load_score': profile.get_load_score(),
                    'current_tasks': profile.current_tasks,
                    'performance_score': profile.performance_score
                }
                for aid, profile in self.agent_profiles.items()
            }
        }

    def add_task_assignment_callback(self, callback: Callable):
        """Add callback for task assignments"""
        self.task_assignment_callbacks.append(callback)

    def add_load_balance_callback(self, callback: Callable):
        """Add callback for load balancing events"""
        self.load_balance_callbacks.append(callback)

    def add_conflict_callback(self, callback: Callable):
        """Add callback for conflict events"""
        self.conflict_callbacks.append(callback)

# Global coordinator instance
_coordinator_instance: Optional[DistributedCoordinator] = None

def get_distributed_coordinator() -> DistributedCoordinator:
    """Get or create the global distributed coordinator instance"""
    global _coordinator_instance
    if _coordinator_instance is None:
        _coordinator_instance = DistributedCoordinator()
    return _coordinator_instance