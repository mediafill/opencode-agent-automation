#!/usr/bin/env python3
"""
Agent Pooling System - Efficient resource management and agent reuse

This module implements connection pooling, agent lifecycle management,
and resource optimization for the master-slave agent architecture.
"""

import asyncio
import threading
import time
import psutil
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Union
from enum import Enum
import heapq
import logging

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

class PoolState(Enum):
    """States for agent pool"""
    INITIALIZING = "initializing"
    READY = "ready"
    SCALING_UP = "scaling_up"
    SCALING_DOWN = "scaling_down"
    MAINTENANCE = "maintenance"
    ERROR = "error"

class AgentPoolEntry:
    """Entry in the agent pool with metadata"""

    def __init__(self, agent_id: str, agent_type: str, capabilities: Set[str]):
        self.agent_id = agent_id
        self.agent_type = agent_type
        self.capabilities = capabilities
        self.created_at = datetime.now()
        self.last_used = datetime.now()
        self.use_count = 0
        self.is_active = True
        self.health_score = 100.0
        self.current_task: Optional[str] = None
        self.resource_usage = {
            'cpu_percent': 0.0,
            'memory_mb': 0.0,
            'connections': 0
        }

    def update_usage(self, cpu_percent: float, memory_mb: float):
        """Update resource usage statistics"""
        self.resource_usage['cpu_percent'] = cpu_percent
        self.resource_usage['memory_mb'] = memory_mb
        self.last_used = datetime.now()
        self.use_count += 1

    def get_idle_time(self) -> float:
        """Get idle time in seconds"""
        return (datetime.now() - self.last_used).total_seconds()

    def is_expired(self, max_idle_time: int) -> bool:
        """Check if agent has been idle too long"""
        return self.get_idle_time() > max_idle_time

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            'agent_id': self.agent_id,
            'agent_type': self.agent_type,
            'capabilities': list(self.capabilities),
            'created_at': self.created_at.isoformat(),
            'last_used': self.last_used.isoformat(),
            'use_count': self.use_count,
            'is_active': self.is_active,
            'health_score': self.health_score,
            'current_task': self.current_task,
            'resource_usage': self.resource_usage
        }

class AgentPool:
    """
    Connection pool for managing agent instances efficiently

    Features:
    - Connection pooling and reuse
    - Automatic scaling based on demand
    - Health monitoring and cleanup
    - Resource optimization
    - Load balancing across pool instances
    """

    def __init__(self, pool_config: Dict[str, Any]):
        """
        Initialize agent pool with configuration

        Args:
            pool_config: Configuration dictionary containing:
                - pool_name: Name of the pool
                - agent_type: Type of agents in this pool
                - min_size: Minimum pool size
                - max_size: Maximum pool size
                - max_idle_time: Maximum idle time before cleanup (seconds)
                - health_check_interval: Health check interval (seconds)
                - scale_up_threshold: CPU threshold for scaling up
                - scale_down_threshold: CPU threshold for scaling down
        """
        self.config = {
            'pool_name': pool_config.get('pool_name', 'default_pool'),
            'agent_type': pool_config.get('agent_type', 'worker'),
            'min_size': pool_config.get('min_size', 2),
            'max_size': pool_config.get('max_size', 10),
            'max_idle_time': pool_config.get('max_idle_time', 300),  # 5 minutes
            'health_check_interval': pool_config.get('health_check_interval', 30),
            'scale_up_threshold': pool_config.get('scale_up_threshold', 70.0),  # CPU %
            'scale_down_threshold': pool_config.get('scale_down_threshold', 30.0),  # CPU %
            'capabilities': set(pool_config.get('capabilities', []))
        }

        # Pool state
        self.state = PoolState.INITIALIZING
        self.pool: Dict[str, AgentPoolEntry] = {}
        self.available_agents: Set[str] = set()  # Available for use
        self.busy_agents: Set[str] = set()  # Currently in use
        self.quarantined_agents: Set[str] = set()  # Unhealthy agents

        # Statistics
        self.stats = {
            'total_requests': 0,
            'successful_requests': 0,
            'failed_requests': 0,
            'average_wait_time': 0.0,
            'peak_pool_size': 0,
            'current_pool_size': 0,
            'total_agent_creations': 0,
            'total_agent_destructions': 0
        }

        # Threading and synchronization
        self.lock = threading.RLock()
        self.is_running = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.scaling_thread: Optional[threading.Thread] = None

        # Callbacks
        self.agent_creation_callback: Optional[Callable] = None
        self.agent_destruction_callback: Optional[Callable] = None
        self.pool_event_callbacks: List[Callable] = []

        # Initialize pool
        self._initialize_pool()

    def _initialize_pool(self):
        """Initialize the agent pool with minimum size"""
        try:
            logger.info(f"Initializing agent pool '{self.config['pool_name']}' with min size {self.config['min_size']}")

            # Create minimum number of agents
            for i in range(self.config['min_size']):
                agent_id = self._create_agent()
                if agent_id:
                    self.available_agents.add(agent_id)

            self.state = PoolState.READY
            self.stats['current_pool_size'] = len(self.pool)
            self.stats['peak_pool_size'] = len(self.pool)

            logger.info(f"Agent pool '{self.config['pool_name']}' initialized with {len(self.pool)} agents")

        except Exception as e:
            logger.error(f"Failed to initialize agent pool: {e}")
            self.state = PoolState.ERROR

    def _create_agent(self) -> Optional[str]:
        """Create a new agent instance"""
        try:
            agent_id = f"{self.config['agent_type']}_{self.config['pool_name']}_{int(time.time() * 1000)}"

            # Create agent entry
            agent_entry = AgentPoolEntry(
                agent_id=agent_id,
                agent_type=self.config['agent_type'],
                capabilities=self.config['capabilities']
            )

            self.pool[agent_id] = agent_entry
            self.stats['total_agent_creations'] += 1

            # Notify creation callback
            if self.agent_creation_callback:
                try:
                    self.agent_creation_callback(agent_entry)
                except Exception as e:
                    logger.error(f"Error in agent creation callback: {e}")

            logger.debug(f"Created agent {agent_id} in pool '{self.config['pool_name']}'")
            return agent_id

        except Exception as e:
            logger.error(f"Failed to create agent: {e}")
            return None

    def _destroy_agent(self, agent_id: str) -> bool:
        """Destroy an agent instance"""
        try:
            if agent_id not in self.pool:
                return False

            agent_entry = self.pool[agent_id]

            # Notify destruction callback
            if self.agent_destruction_callback:
                try:
                    self.agent_destruction_callback(agent_entry)
                except Exception as e:
                    logger.error(f"Error in agent destruction callback: {e}")

            # Remove from all sets
            self.available_agents.discard(agent_id)
            self.busy_agents.discard(agent_id)
            self.quarantined_agents.discard(agent_id)
            del self.pool[agent_id]

            self.stats['total_agent_destructions'] += 1
            self.stats['current_pool_size'] = len(self.pool)

            logger.debug(f"Destroyed agent {agent_id} from pool '{self.config['pool_name']}'")
            return True

        except Exception as e:
            logger.error(f"Failed to destroy agent {agent_id}: {e}")
            return False

    def acquire_agent(self, required_capabilities: Optional[Set[str]] = None,
                     timeout: float = 30.0) -> Optional[str]:
        """
        Acquire an agent from the pool

        Args:
            required_capabilities: Set of capabilities the agent must have
            timeout: Maximum time to wait for an agent

        Returns:
            Agent ID if successful, None if timeout or no suitable agent
        """
        start_time = time.time()
        self.stats['total_requests'] += 1

        with self.lock:
            try:
                # Find suitable agent
                suitable_agents = self._find_suitable_agents(required_capabilities)

                if not suitable_agents:
                    # Try to scale up if possible
                    if self._should_scale_up():
                        self._scale_up()
                        # Wait a bit for new agents
                        time.sleep(1)
                        suitable_agents = self._find_suitable_agents(required_capabilities)

                # Wait for available agent
                wait_start = time.time()
                while not suitable_agents and (time.time() - wait_start) < timeout:
                    # Check if any quarantined agents recovered
                    self._check_quarantined_agents()
                    suitable_agents = self._find_suitable_agents(required_capabilities)
                    if not suitable_agents:
                        time.sleep(0.1)

                if not suitable_agents:
                    logger.warning(f"No suitable agent available in pool '{self.config['pool_name']}' within timeout")
                    return None

                # Get the best agent (least recently used)
                agent_id = self._select_best_agent(suitable_agents)

                if agent_id:
                    # Mark as busy
                    self.available_agents.remove(agent_id)
                    self.busy_agents.add(agent_id)
                    self.pool[agent_id].current_task = f"task_{int(time.time())}"

                    wait_time = time.time() - start_time
                    self.stats['successful_requests'] += 1
                    self.stats['average_wait_time'] = (
                        (self.stats['average_wait_time'] * (self.stats['successful_requests'] - 1)) + wait_time
                    ) / self.stats['successful_requests']

                    logger.debug(f"Acquired agent {agent_id} from pool '{self.config['pool_name']}'")
                    return agent_id

            except Exception as e:
                logger.error(f"Error acquiring agent from pool: {e}")
                self.stats['failed_requests'] += 1

            return None

    def _find_suitable_agents(self, required_capabilities: Optional[Set[str]]) -> List[str]:
        """Find agents that match the requirements"""
        suitable = []

        for agent_id in self.available_agents:
            agent_entry = self.pool[agent_id]

            # Check if agent is healthy and active
            if not agent_entry.is_active or agent_entry.health_score < 60:
                continue

            # Check capabilities if required
            if required_capabilities and not required_capabilities.issubset(agent_entry.capabilities):
                continue

            suitable.append(agent_id)

        return suitable

    def _select_best_agent(self, agent_ids: List[str]) -> Optional[str]:
        """Select the best agent from suitable candidates (LRU strategy)"""
        if not agent_ids:
            return None

        # Sort by last used time (oldest first = least recently used)
        sorted_agents = sorted(
            agent_ids,
            key=lambda aid: self.pool[aid].last_used
        )

        return sorted_agents[0]

    def release_agent(self, agent_id: str, health_update: Optional[Dict[str, Any]] = None):
        """
        Release an agent back to the pool

        Args:
            agent_id: ID of the agent to release
            health_update: Optional health/resource update
        """
        with self.lock:
            try:
                if agent_id not in self.pool:
                    logger.warning(f"Attempted to release unknown agent {agent_id}")
                    return

                agent_entry = self.pool[agent_id]

                # Update health if provided
                if health_update:
                    cpu_percent = health_update.get('cpu_percent', 0)
                    memory_mb = health_update.get('memory_mb', 0)
                    agent_entry.update_usage(cpu_percent, memory_mb)

                # Clear current task
                agent_entry.current_task = None

                # Check if agent should be quarantined
                if agent_entry.health_score < 40:
                    self.quarantined_agents.add(agent_id)
                    logger.warning(f"Agent {agent_id} quarantined due to low health score")
                else:
                    # Return to available pool
                    self.busy_agents.remove(agent_id)
                    self.available_agents.add(agent_id)

                logger.debug(f"Released agent {agent_id} back to pool '{self.config['pool_name']}'")

            except Exception as e:
                logger.error(f"Error releasing agent {agent_id}: {e}")

    def _check_quarantined_agents(self):
        """Check if quarantined agents have recovered"""
        recovered = []

        for agent_id in self.quarantined_agents.copy():
            agent_entry = self.pool[agent_id]

            # Simple recovery check - if health improved
            if agent_entry.health_score >= 60:
                self.quarantined_agents.remove(agent_id)
                self.available_agents.add(agent_id)
                recovered.append(agent_id)
                logger.info(f"Agent {agent_id} recovered from quarantine")

        if recovered:
            logger.info(f"Recovered {len(recovered)} agents from quarantine in pool '{self.config['pool_name']}'")

    def _should_scale_up(self) -> bool:
        """Determine if pool should scale up"""
        current_size = len(self.pool)
        if current_size >= self.config['max_size']:
            return False

        # Check system resources
        system_cpu = psutil.cpu_percent(interval=1)
        return system_cpu < self.config['scale_up_threshold']

    def _should_scale_down(self) -> bool:
        """Determine if pool should scale down"""
        current_size = len(self.pool)
        available_count = len(self.available_agents)

        if current_size <= self.config['min_size']:
            return False

        # Scale down if many agents are idle
        idle_ratio = available_count / current_size
        return idle_ratio > 0.7  # 70% idle

    def _scale_up(self, count: int = 1):
        """Scale up the pool by creating new agents"""
        if self.state == PoolState.SCALING_UP:
            return

        self.state = PoolState.SCALING_UP

        try:
            created = 0
            for _ in range(count):
                if len(self.pool) >= self.config['max_size']:
                    break

                agent_id = self._create_agent()
                if agent_id:
                    self.available_agents.add(agent_id)
                    created += 1

            if created > 0:
                self.stats['current_pool_size'] = len(self.pool)
                self.stats['peak_pool_size'] = max(self.stats['peak_pool_size'], len(self.pool))
                logger.info(f"Scaled up pool '{self.config['pool_name']}' by {created} agents")

                # Notify event callbacks
                self._notify_pool_event('scaled_up', {'agents_added': created})

        except Exception as e:
            logger.error(f"Error scaling up pool: {e}")
        finally:
            self.state = PoolState.READY

    def _scale_down(self, count: int = 1):
        """Scale down the pool by destroying idle agents"""
        if self.state == PoolState.SCALING_DOWN:
            return

        self.state = PoolState.SCALING_DOWN

        try:
            destroyed = 0
            # Destroy oldest idle agents first
            idle_agents = sorted(
                list(self.available_agents),
                key=lambda aid: self.pool[aid].last_used
            )

            for agent_id in idle_agents[:count]:
                if self._destroy_agent(agent_id):
                    destroyed += 1

            if destroyed > 0:
                self.stats['current_pool_size'] = len(self.pool)
                logger.info(f"Scaled down pool '{self.config['pool_name']}' by {destroyed} agents")

                # Notify event callbacks
                self._notify_pool_event('scaled_down', {'agents_removed': destroyed})

        except Exception as e:
            logger.error(f"Error scaling down pool: {e}")
        finally:
            self.state = PoolState.READY

    def _notify_pool_event(self, event_type: str, event_data: Dict[str, Any]):
        """Notify pool event callbacks"""
        for callback in self.pool_event_callbacks:
            try:
                callback(self.config['pool_name'], event_type, event_data)
            except Exception as e:
                logger.error(f"Error in pool event callback: {e}")

    def start_monitoring(self):
        """Start the pool monitoring and maintenance"""
        if self.is_running:
            return

        self.is_running = True

        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitoring_loop, daemon=True)
        self.monitor_thread.start()

        # Start scaling thread
        self.scaling_thread = threading.Thread(target=self._scaling_loop, daemon=True)
        self.scaling_thread.start()

        logger.info(f"Started monitoring for agent pool '{self.config['pool_name']}'")

    def stop_monitoring(self):
        """Stop the pool monitoring"""
        if not self.is_running:
            return

        self.is_running = False

        # Wait for threads
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)

        if self.scaling_thread and self.scaling_thread.is_alive():
            self.scaling_thread.join(timeout=10)

        logger.info(f"Stopped monitoring for agent pool '{self.config['pool_name']}'")

    def _monitoring_loop(self):
        """Main monitoring loop for pool maintenance"""
        while self.is_running:
            try:
                self._perform_maintenance()
                time.sleep(self.config['health_check_interval'])
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                time.sleep(5)

    def _scaling_loop(self):
        """Main scaling loop for dynamic pool sizing"""
        while self.is_running:
            try:
                if self._should_scale_up():
                    self._scale_up()
                elif self._should_scale_down():
                    self._scale_down()

                time.sleep(60)  # Check scaling every minute
            except Exception as e:
                logger.error(f"Error in scaling loop: {e}")
                time.sleep(30)

    def _perform_maintenance(self):
        """Perform pool maintenance tasks"""
        try:
            # Clean up expired agents
            expired_agents = []
            for agent_id, agent_entry in self.pool.items():
                if agent_entry.is_expired(self.config['max_idle_time']):
                    expired_agents.append(agent_id)

            for agent_id in expired_agents:
                logger.info(f"Removing expired agent {agent_id} from pool '{self.config['pool_name']}'")
                self._destroy_agent(agent_id)

            # Update health scores (simplified)
            for agent_entry in self.pool.values():
                # Decay health score over time if not used recently
                idle_time = agent_entry.get_idle_time()
                if idle_time > 3600:  # 1 hour
                    decay = min(10, idle_time // 3600)
                    agent_entry.health_score = max(0, agent_entry.health_score - decay)

        except Exception as e:
            logger.error(f"Error in pool maintenance: {e}")

    def get_pool_status(self) -> Dict[str, Any]:
        """Get comprehensive pool status"""
        with self.lock:
            return {
                'pool_name': self.config['pool_name'],
                'agent_type': self.config['agent_type'],
                'state': self.state.value,
                'current_size': len(self.pool),
                'available_count': len(self.available_agents),
                'busy_count': len(self.busy_agents),
                'quarantined_count': len(self.quarantined_agents),
                'min_size': self.config['min_size'],
                'max_size': self.config['max_size'],
                'stats': self.stats.copy(),
                'agents': {
                    agent_id: agent_entry.to_dict()
                    for agent_id, agent_entry in self.pool.items()
                }
            }

    def set_agent_creation_callback(self, callback: Callable):
        """Set callback for agent creation events"""
        self.agent_creation_callback = callback

    def set_agent_destruction_callback(self, callback: Callable):
        """Set callback for agent destruction events"""
        self.agent_destruction_callback = callback

    def add_pool_event_callback(self, callback: Callable):
        """Add callback for pool events"""
        self.pool_event_callbacks.append(callback)

class AgentPoolManager:
    """
    Manager for multiple agent pools with intelligent routing
    """

    def __init__(self):
        self.pools: Dict[str, AgentPool] = {}
        self.pool_routing_rules: Dict[str, Callable] = {}
        self.is_running = False
        self.monitor_thread: Optional[threading.Thread] = None

    def create_pool(self, pool_config: Dict[str, Any]) -> AgentPool:
        """Create a new agent pool"""
        pool_name = pool_config.get('pool_name', 'default')
        if pool_name in self.pools:
            raise ValueError(f"Pool '{pool_name}' already exists")

        pool = AgentPool(pool_config)
        self.pools[pool_name] = pool

        # Set up event callbacks
        pool.add_pool_event_callback(self._on_pool_event)

        logger.info(f"Created agent pool '{pool_name}'")
        return pool

    def get_pool(self, pool_name: str) -> Optional[AgentPool]:
        """Get a pool by name"""
        return self.pools.get(pool_name)

    def acquire_agent_from_pool(self, pool_name: str, required_capabilities: Optional[Set[str]] = None,
                               timeout: float = 30.0) -> Optional[str]:
        """Acquire an agent from a specific pool"""
        pool = self.get_pool(pool_name)
        if not pool:
            logger.error(f"Pool '{pool_name}' not found")
            return None

        return pool.acquire_agent(required_capabilities, timeout)

    def acquire_agent_smart(self, agent_type: str, required_capabilities: Optional[Set[str]] = None,
                           timeout: float = 30.0) -> Optional[str]:
        """
        Intelligently acquire an agent based on routing rules and availability
        """
        # Find suitable pools
        suitable_pools = []
        for pool_name, pool in self.pools.items():
            if pool.config['agent_type'] == agent_type:
                if not required_capabilities or required_capabilities.issubset(pool.config['capabilities']):
                    suitable_pools.append((pool_name, pool))

        if not suitable_pools:
            logger.warning(f"No suitable pools found for agent type '{agent_type}'")
            return None

        # Sort by availability (most available agents first)
        suitable_pools.sort(key=lambda x: len(x[1].available_agents), reverse=True)

        # Try pools in order
        for pool_name, pool in suitable_pools:
            agent_id = pool.acquire_agent(required_capabilities, timeout)
            if agent_id:
                return agent_id

        logger.warning(f"No available agents in suitable pools for type '{agent_type}'")
        return None

    def release_agent(self, agent_id: str, pool_name: Optional[str] = None,
                     health_update: Optional[Dict[str, Any]] = None):
        """Release an agent back to its pool"""
        if pool_name:
            pool = self.get_pool(pool_name)
            if pool:
                pool.release_agent(agent_id, health_update)
                return

        # Find pool containing the agent
        for pool in self.pools.values():
            if agent_id in pool.pool:
                pool.release_agent(agent_id, health_update)
                return

        logger.warning(f"Could not find pool containing agent {agent_id}")

    def start_all_pools(self):
        """Start monitoring for all pools"""
        for pool in self.pools.values():
            pool.start_monitoring()

        self.is_running = True
        self.monitor_thread = threading.Thread(target=self._global_monitoring_loop, daemon=True)
        self.monitor_thread.start()

        logger.info("Started all agent pools")

    def stop_all_pools(self):
        """Stop monitoring for all pools"""
        self.is_running = False

        for pool in self.pools.values():
            pool.stop_monitoring()

        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)

        logger.info("Stopped all agent pools")

    def _global_monitoring_loop(self):
        """Global monitoring loop for pool manager"""
        while self.is_running:
            try:
                # Global pool optimization logic could go here
                # For example, redistribute agents between pools based on demand
                time.sleep(300)  # Check every 5 minutes
            except Exception as e:
                logger.error(f"Error in global monitoring loop: {e}")
                time.sleep(60)

    def _on_pool_event(self, pool_name: str, event_type: str, event_data: Dict[str, Any]):
        """Handle pool events"""
        logger.info(f"Pool event: {pool_name} {event_type} {event_data}")

    def get_system_status(self) -> Dict[str, Any]:
        """Get status of all pools"""
        return {
            'total_pools': len(self.pools),
            'pools': {
                name: pool.get_pool_status()
                for name, pool in self.pools.items()
            },
            'system_stats': self._calculate_system_stats()
        }

    def _calculate_system_stats(self) -> Dict[str, Any]:
        """Calculate system-wide statistics"""
        total_agents = sum(len(pool.pool) for pool in self.pools.values())
        available_agents = sum(len(pool.available_agents) for pool in self.pools.values())
        busy_agents = sum(len(pool.busy_agents) for pool in self.pools.values())

        return {
            'total_agents': total_agents,
            'available_agents': available_agents,
            'busy_agents': busy_agents,
            'utilization_rate': (busy_agents / max(1, total_agents)) * 100
        }

# Global pool manager instance
_pool_manager_instance: Optional[AgentPoolManager] = None

def get_pool_manager() -> AgentPoolManager:
    """Get or create the global pool manager instance"""
    global _pool_manager_instance
    if _pool_manager_instance is None:
        _pool_manager_instance = AgentPoolManager()
    return _pool_manager_instance