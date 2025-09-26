#!/usr/bin/env python3
"""
Agent Pooling System - Efficient resource allocation and load balancing

This module provides intelligent agent pooling capabilities for the master-slave
architecture, enabling efficient resource usage and dynamic load balancing.
"""

import asyncio
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Tuple
from enum import Enum
from dataclasses import dataclass
import heapq

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

try:
    from master_agent_orchestrator import (
        AgentRole, AgentStatus, AgentPermission, AgentHierarchy,
        SlaveAgent, MasterAgentOrchestrator
    )
    ORCHESTRATOR_AVAILABLE = True
except ImportError:
    ORCHESTRATOR_AVAILABLE = False
    logger.warning("Master orchestrator not available")

class PoolStrategy(Enum):
    """Agent pool allocation strategies"""
    ROUND_ROBIN = "round_robin"
    LEAST_LOADED = "least_loaded"
    RESOURCE_AWARE = "resource_aware"
    CAPABILITY_BASED = "capability_based"
    HYBRID = "hybrid"

class PoolStatus(Enum):
    """Pool status states"""
    INITIALIZING = "initializing"
    ACTIVE = "active"
    SCALING_UP = "scaling_up"
    SCALING_DOWN = "scaling_down"
    MAINTENANCE = "maintenance"
    DEGRADED = "degraded"

@dataclass
class PoolMetrics:
    """Metrics for pool performance monitoring"""
    total_agents: int = 0
    active_agents: int = 0
    idle_agents: int = 0
    busy_agents: int = 0
    failed_agents: int = 0
    average_response_time: float = 0.0
    throughput: float = 0.0
    resource_utilization: float = 0.0
    last_updated: Optional[datetime] = None

class AgentPool:
    """
    Intelligent agent pool for efficient resource management and load balancing
    """

    def __init__(self, pool_id: str, role: AgentRole, orchestrator: Optional[MasterAgentOrchestrator] = None,
                 max_size: int = 10, min_size: int = 1, strategy: PoolStrategy = PoolStrategy.HYBRID):
        self.pool_id = pool_id
        self.role = role
        self.orchestrator = orchestrator
        self.max_size = max_size
        self.min_size = min_size
        self.strategy = strategy

        # Pool state
        self.status = PoolStatus.INITIALIZING
        self.agents: Dict[str, SlaveAgent] = {}
        self.available_agents: Set[str] = set()
        self.last_assignment_index = 0  # For round-robin

        # Metrics and monitoring
        self.metrics = PoolMetrics()
        self.metrics_history: List[Tuple[datetime, PoolMetrics]] = []

        # Resource thresholds
        self.cpu_threshold = 80.0  # Max CPU % before scaling
        self.memory_threshold = 85.0  # Max memory % before scaling
        self.task_queue_threshold = 5  # Max queued tasks before scaling

        # Scaling parameters
        self.scale_up_factor = 1.5
        self.scale_down_factor = 0.7
        self.cooldown_period = 300  # 5 minutes between scaling operations

        # Threading and async
        self.is_running = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.scaling_thread: Optional[threading.Thread] = None
        self.last_scale_time = datetime.now() - timedelta(seconds=self.cooldown_period)

        # Callbacks
        self.status_callbacks: List[Callable] = []
        self.scaling_callbacks: List[Callable] = []

    def start(self):
        """Start the agent pool"""
        if self.is_running:
            return

        logger.info(f"Starting agent pool {self.pool_id} for role {self.role.value}")
        self.is_running = True
        self.status = PoolStatus.ACTIVE

        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitoring_loop, daemon=True)
        self.monitor_thread.start()

        # Start scaling thread
        self.scaling_thread = threading.Thread(target=self._scaling_loop, daemon=True)
        self.scaling_thread.start()

    def stop(self):
        """Stop the agent pool"""
        if not self.is_running:
            return

        logger.info(f"Stopping agent pool {self.pool_id}")
        self.is_running = False
        self.status = PoolStatus.INITIALIZING

        # Wait for threads
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)
        if self.scaling_thread and self.scaling_thread.is_alive():
            self.scaling_thread.join(timeout=10)

    def add_agent(self, agent: SlaveAgent) -> bool:
        """Add an agent to the pool"""
        if len(self.agents) >= self.max_size:
            logger.warning(f"Pool {self.pool_id} at maximum capacity ({self.max_size})")
            return False

        if agent.agent_id in self.agents:
            logger.warning(f"Agent {agent.agent_id} already in pool {self.pool_id}")
            return False

        if agent.role != self.role:
            logger.warning(f"Agent {agent.agent_id} role {agent.role.value} doesn't match pool role {self.role.value}")
            return False

        self.agents[agent.agent_id] = agent
        if agent.status == AgentStatus.READY:
            self.available_agents.add(agent.agent_id)

        self._update_metrics()
        logger.info(f"Added agent {agent.agent_id} to pool {self.pool_id}")
        return True

    def remove_agent(self, agent_id: str) -> bool:
        """Remove an agent from the pool"""
        if agent_id not in self.agents:
            return False

        agent = self.agents[agent_id]

        # Check if agent is busy
        if agent.status == AgentStatus.BUSY:
            logger.warning(f"Cannot remove busy agent {agent_id} from pool {self.pool_id}")
            return False

        # Remove from available agents
        self.available_agents.discard(agent_id)
        del self.agents[agent_id]

        self._update_metrics()
        logger.info(f"Removed agent {agent_id} from pool {self.pool_id}")
        return True

    def get_agent(self, capabilities: Optional[Set[str]] = None,
                  strategy: Optional[PoolStrategy] = None) -> Optional[SlaveAgent]:
        """Get an available agent from the pool using the specified strategy"""
        if not self.available_agents:
            return None

        strategy = strategy or self.strategy
        available_agents = [self.agents[aid] for aid in self.available_agents]

        # Filter by capabilities if specified
        if capabilities:
            available_agents = [
                agent for agent in available_agents
                if capabilities.issubset(agent.capabilities)
            ]

        if not available_agents:
            return None

        selected_agent = None

        if strategy == PoolStrategy.ROUND_ROBIN:
            selected_agent = self._select_round_robin(available_agents)
        elif strategy == PoolStrategy.LEAST_LOADED:
            selected_agent = self._select_least_loaded(available_agents)
        elif strategy == PoolStrategy.RESOURCE_AWARE:
            selected_agent = self._select_resource_aware(available_agents)
        elif strategy == PoolStrategy.CAPABILITY_BASED:
            selected_agent = self._select_capability_based(available_agents, capabilities)
        elif strategy == PoolStrategy.HYBRID:
            selected_agent = self._select_hybrid(available_agents, capabilities)

        if selected_agent:
            # Mark agent as busy
            selected_agent.status = AgentStatus.BUSY
            self.available_agents.remove(selected_agent.agent_id)
            self._update_metrics()

        return selected_agent

    def return_agent(self, agent_id: str):
        """Return an agent to the available pool"""
        if agent_id in self.agents:
            agent = self.agents[agent_id]
            if agent.status == AgentStatus.BUSY:
                agent.status = AgentStatus.READY
                self.available_agents.add(agent_id)
                self._update_metrics()

    def _select_round_robin(self, available_agents: List[SlaveAgent]) -> Optional[SlaveAgent]:
        """Round-robin agent selection"""
        if not available_agents:
            return None

        self.last_assignment_index = (self.last_assignment_index + 1) % len(available_agents)
        return available_agents[self.last_assignment_index]

    def _select_least_loaded(self, available_agents: List[SlaveAgent]) -> Optional[SlaveAgent]:
        """Select agent with least current load"""
        if not available_agents:
            return None

        # Sort by health score (higher is better) and current task (None is better)
        sorted_agents = sorted(
            available_agents,
            key=lambda a: (a.health_score, a.current_task is None),
            reverse=True
        )
        return sorted_agents[0]

    def _select_resource_aware(self, available_agents: List[SlaveAgent]) -> Optional[SlaveAgent]:
        """Select agent based on resource utilization"""
        if not available_agents:
            return None

        # Calculate resource scores (lower is better)
        def resource_score(agent: SlaveAgent) -> float:
            cpu_score = agent.resource_usage.get('cpu_percent', 0) / 100.0
            mem_score = agent.resource_usage.get('memory_mb', 0) / 8192.0  # Normalize to 8GB
            return (cpu_score + mem_score) / 2.0

        return min(available_agents, key=resource_score)

    def _select_capability_based(self, available_agents: List[SlaveAgent],
                               capabilities: Optional[Set[str]] = None) -> Optional[SlaveAgent]:
        """Select agent based on capability matching"""
        if not capabilities:
            return self._select_least_loaded(available_agents)

        # Score agents by capability match quality
        def capability_score(agent: SlaveAgent) -> float:
            if not capabilities:
                return 1.0
            matching = len(capabilities.intersection(agent.capabilities))
            total = len(capabilities)
            return matching / total if total > 0 else 1.0

        return max(available_agents, key=capability_score)

    def _select_hybrid(self, available_agents: List[SlaveAgent],
                      capabilities: Optional[Set[str]] = None) -> Optional[SlaveAgent]:
        """Hybrid selection combining multiple factors"""
        if not available_agents:
            return None

        # Calculate composite scores
        def composite_score(agent: SlaveAgent) -> float:
            # Capability score (0-1, higher better)
            cap_score = self._capability_score(agent, capabilities)

            # Resource score (0-1, lower better, inverted)
            resource_score = 1.0 - self._resource_score(agent)

            # Health score (0-1, higher better)
            health_score = agent.health_score / 100.0

            # Load score (0-1, lower better)
            load_score = 1.0 if agent.current_task is None else 0.5

            # Weighted combination
            return (cap_score * 0.4 + resource_score * 0.3 +
                   health_score * 0.2 + load_score * 0.1)

        return max(available_agents, key=composite_score)

    def _capability_score(self, agent: SlaveAgent, capabilities: Optional[Set[str]]) -> float:
        """Calculate capability matching score"""
        if not capabilities:
            return 1.0
        matching = len(capabilities.intersection(agent.capabilities))
        return matching / len(capabilities) if capabilities else 1.0

    def _resource_score(self, agent: SlaveAgent) -> float:
        """Calculate resource utilization score (0-1, higher = more utilized)"""
        cpu = agent.resource_usage.get('cpu_percent', 0) / 100.0
        mem = min(agent.resource_usage.get('memory_mb', 0) / 4096.0, 1.0)  # Cap at 4GB
        return (cpu + mem) / 2.0

    def _monitoring_loop(self):
        """Main monitoring loop"""
        while self.is_running:
            try:
                self._update_metrics()
                self._check_pool_health()
                time.sleep(30)  # Monitor every 30 seconds
            except Exception as e:
                logger.error(f"Error in monitoring loop for pool {self.pool_id}: {e}")
                time.sleep(5)

    def _scaling_loop(self):
        """Main scaling loop"""
        while self.is_running:
            try:
                self._evaluate_scaling_needs()
                time.sleep(60)  # Evaluate scaling every minute
            except Exception as e:
                logger.error(f"Error in scaling loop for pool {self.pool_id}: {e}")
                time.sleep(10)

    def _update_metrics(self):
        """Update pool metrics"""
        total = len(self.agents)
        active = len([a for a in self.agents.values() if a.status != AgentStatus.FAILED])
        idle = len(self.available_agents)
        busy = len([a for a in self.agents.values() if a.status == AgentStatus.BUSY])
        failed = len([a for a in self.agents.values() if a.status == AgentStatus.FAILED])

        self.metrics.total_agents = total
        self.metrics.active_agents = active
        self.metrics.idle_agents = idle
        self.metrics.busy_agents = busy
        self.metrics.failed_agents = failed
        self.metrics.resource_utilization = busy / max(active, 1)
        self.metrics.last_updated = datetime.now()

        # Keep history (last 100 entries)
        self.metrics_history.append((datetime.now(), self.metrics))
        if len(self.metrics_history) > 100:
            self.metrics_history.pop(0)

    def _check_pool_health(self):
        """Check overall pool health"""
        if not self.agents:
            self.status = PoolStatus.DEGRADED
            return

        healthy_agents = len([a for a in self.agents.values() if a.is_healthy()])
        health_ratio = healthy_agents / len(self.agents)

        if health_ratio < 0.5:
            self.status = PoolStatus.DEGRADED
        elif health_ratio < 0.8:
            self.status = PoolStatus.MAINTENANCE
        else:
            self.status = PoolStatus.ACTIVE

    def _evaluate_scaling_needs(self):
        """Evaluate if the pool needs scaling"""
        if not self.orchestrator:
            return

        current_time = datetime.now()
        if (current_time - self.last_scale_time).seconds < self.cooldown_period:
            return  # Still in cooldown

        current_size = len(self.agents)
        busy_ratio = self.metrics.busy_agents / max(current_size, 1)

        # Scale up conditions
        scale_up = (
            busy_ratio > 0.8 and  # High utilization
            current_size < self.max_size and  # Not at max
            len(self.orchestrator.get_agents_by_role(self.role)) < self.orchestrator.max_slave_agents
        )

        # Scale down conditions
        scale_down = (
            busy_ratio < 0.3 and  # Low utilization
            current_size > self.min_size and  # Above minimum
            self.metrics.idle_agents > 2  # Keep some idle agents
        )

        if scale_up:
            self._scale_up()
        elif scale_down:
            self._scale_down()

    def _scale_up(self):
        """Scale up the pool by adding agents"""
        current_size = len(self.agents)
        target_size = min(int(current_size * self.scale_up_factor), self.max_size)
        agents_to_add = target_size - current_size

        if agents_to_add <= 0:
            return

        logger.info(f"Scaling up pool {self.pool_id} from {current_size} to {target_size} agents")
        self.status = PoolStatus.SCALING_UP
        self.last_scale_time = datetime.now()

        # Request new agents from orchestrator
        for i in range(agents_to_add):
            agent_id = f"{self.role.value}_{self.pool_id}_{int(time.time())}_{i}"
            success = self.orchestrator.register_slave_agent(
                agent_id=agent_id,
                role=self.role,
                capabilities=self._get_default_capabilities()
            )
            if success:
                # Create and add agent to pool
                agent = SlaveAgent(agent_id, {}, self.role)
                agent.capabilities = self._get_default_capabilities()
                agent.status = AgentStatus.READY
                self.add_agent(agent)

        self.status = PoolStatus.ACTIVE

    def _scale_down(self):
        """Scale down the pool by removing idle agents"""
        idle_agents = [aid for aid in self.available_agents]
        if len(idle_agents) <= 1:  # Keep at least one idle agent
            return

        agents_to_remove = max(1, len(idle_agents) - 1)  # Remove all but one
        current_size = len(self.agents)
        target_size = max(self.min_size, current_size - agents_to_remove)

        if target_size >= current_size:
            return

        logger.info(f"Scaling down pool {self.pool_id} from {current_size} to {target_size} agents")
        self.status = PoolStatus.SCALING_DOWN
        self.last_scale_time = datetime.now()

        # Remove idle agents
        for agent_id in idle_agents[:agents_to_remove]:
            if self.remove_agent(agent_id):
                # Unregister from orchestrator
                self.orchestrator.unregister_slave_agent(agent_id)

        self.status = PoolStatus.ACTIVE

    def _get_default_capabilities(self) -> Set[str]:
        """Get default capabilities for this pool's role"""
        base_capabilities = {
            AgentRole.SLAVE: {'code_analysis', 'testing', 'debugging'},
            AgentRole.COORDINATOR: {'task_coordination', 'resource_management', 'monitoring'},
            AgentRole.SUPERVISOR: {'agent_management', 'system_monitoring', 'coordination'}
        }
        return base_capabilities.get(self.role, set())

    def get_pool_status(self) -> Dict[str, Any]:
        """Get comprehensive pool status"""
        return {
            'pool_id': self.pool_id,
            'role': self.role.value,
            'status': self.status.value,
            'size': len(self.agents),
            'max_size': self.max_size,
            'min_size': self.min_size,
            'available': len(self.available_agents),
            'busy': self.metrics.busy_agents,
            'failed': self.metrics.failed_agents,
            'resource_utilization': self.metrics.resource_utilization,
            'strategy': self.strategy.value,
            'last_scale_time': self.last_scale_time.isoformat(),
            'agents': [
                {
                    'id': agent.agent_id,
                    'status': agent.status.value,
                    'health': agent.health_score,
                    'current_task': agent.current_task
                }
                for agent in self.agents.values()
            ]
        }

class AgentPoolManager:
    """
    Manager for multiple agent pools with cross-pool coordination
    """

    def __init__(self, orchestrator: Optional[MasterAgentOrchestrator] = None):
        self.orchestrator = orchestrator
        self.pools: Dict[str, AgentPool] = {}
        self.role_pools: Dict[AgentRole, List[str]] = {}
        self.is_running = False

        # Global metrics
        self.global_metrics = PoolMetrics()

    def create_pool(self, role: AgentRole, max_size: int = 10, min_size: int = 1,
                   strategy: PoolStrategy = PoolStrategy.HYBRID) -> str:
        """Create a new agent pool"""
        pool_id = f"pool_{role.value}_{len(self.pools)}"
        pool = AgentPool(pool_id, role, self.orchestrator, max_size, min_size, strategy)

        self.pools[pool_id] = pool
        if role not in self.role_pools:
            self.role_pools[role] = []
        self.role_pools[role].append(pool_id)

        logger.info(f"Created agent pool {pool_id} for role {role.value}")
        return pool_id

    def get_pool_for_role(self, role: AgentRole) -> Optional[AgentPool]:
        """Get the primary pool for a role"""
        pool_ids = self.role_pools.get(role, [])
        if not pool_ids:
            return None
        return self.pools.get(pool_ids[0])

    def get_agent_from_role(self, role: AgentRole, capabilities: Optional[Set[str]] = None) -> Optional[SlaveAgent]:
        """Get an agent from the appropriate role pool"""
        pool = self.get_pool_for_role(role)
        if pool:
            return pool.get_agent(capabilities)
        return None

    def start_all_pools(self):
        """Start all agent pools"""
        for pool in self.pools.values():
            pool.start()
        self.is_running = True

    def stop_all_pools(self):
        """Stop all agent pools"""
        for pool in self.pools.values():
            pool.stop()
        self.is_running = False

    def get_global_status(self) -> Dict[str, Any]:
        """Get global pool manager status"""
        total_pools = len(self.pools)
        active_pools = len([p for p in self.pools.values() if p.status == PoolStatus.ACTIVE])
        total_agents = sum(p.metrics.total_agents for p in self.pools.values())
        active_agents = sum(p.metrics.active_agents for p in self.pools.values())
        busy_agents = sum(p.metrics.busy_agents for p in self.pools.values())

        return {
            'total_pools': total_pools,
            'active_pools': active_pools,
            'total_agents': total_agents,
            'active_agents': active_agents,
            'busy_agents': busy_agents,
            'utilization': busy_agents / max(active_agents, 1),
            'pools': {pid: pool.get_pool_status() for pid, pool in self.pools.items()}
        }

# Global pool manager instance
_pool_manager: Optional[AgentPoolManager] = None

def get_pool_manager(orchestrator: Optional[MasterAgentOrchestrator] = None) -> AgentPoolManager:
    """Get or create the global pool manager instance"""
    global _pool_manager
    if _pool_manager is None:
        _pool_manager = AgentPoolManager(orchestrator)
    return _pool_manager

if __name__ == '__main__':
    # Test the agent pool system
    manager = AgentPoolManager()

    # Create pools for different roles
    slave_pool = manager.create_pool(AgentRole.SLAVE, max_size=5, min_size=1)
    coord_pool = manager.create_pool(AgentRole.COORDINATOR, max_size=3, min_size=1)

    print(f"Created pools: {list(manager.pools.keys())}")
    print(f"Global status: {manager.get_global_status()}")