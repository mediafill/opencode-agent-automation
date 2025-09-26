#!/usr/bin/env python3
"""
Agent Lifecycle Manager - Unified management of agent registration, discovery, and graceful shutdown

This module provides comprehensive lifecycle management for agents in the master-slave
architecture, ensuring proper initialization, monitoring, and cleanup.
"""

import asyncio
import threading
import time
import psutil
import signal
import atexit
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Union
from enum import Enum
from dataclasses import dataclass, field
from pathlib import Path
import json
import subprocess

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

try:
    from master_agent_orchestrator import (
        AgentRole, AgentStatus, AgentHierarchy,
        MasterAgentOrchestrator, get_orchestrator
    )
    from agent_pool import AgentPool, get_pool_manager
    from health_monitor import HealthMonitor, get_health_monitor
    ORCHESTRATOR_AVAILABLE = True
except ImportError:
    ORCHESTRATOR_AVAILABLE = False
    logger.warning("Orchestrator components not available")

class LifecycleStage(Enum):
    """Agent lifecycle stages"""
    UNREGISTERED = "unregistered"
    DISCOVERED = "discovered"
    REGISTERING = "registering"
    INITIALIZING = "initializing"
    READY = "ready"
    ACTIVE = "active"
    DEGRADED = "degraded"
    SHUTTING_DOWN = "shutting_down"
    TERMINATED = "terminated"
    FAILED = "failed"

class ShutdownMode(Enum):
    """Shutdown modes"""
    GRACEFUL = "graceful"      # Complete current tasks before shutdown
    FORCEFUL = "forceful"      # Terminate immediately
    DRAIN = "drain"           # Stop accepting new tasks, complete existing ones

@dataclass
class AgentLifecycle:
    """Tracks the complete lifecycle of an agent"""
    agent_id: str
    role: AgentRole
    stage: LifecycleStage = LifecycleStage.UNREGISTERED
    process_info: Optional[Dict[str, Any]] = None
    registration_time: Optional[datetime] = None
    last_heartbeat: Optional[datetime] = None
    shutdown_mode: ShutdownMode = ShutdownMode.GRACEFUL
    graceful_timeout: int = 30  # seconds
    metadata: Dict[str, Any] = field(default_factory=dict)
    dependencies: Set[str] = field(default_factory=set)  # Other agents this one depends on
    dependents: Set[str] = field(default_factory=set)    # Agents that depend on this one

    @property
    def is_alive(self) -> bool:
        """Check if the agent process is still alive"""
        if not self.process_info or 'pid' not in self.process_info:
            return False

        try:
            process = psutil.Process(self.process_info['pid'])
            return process.is_running()
        except psutil.NoSuchProcess:
            return False

    @property
    def uptime(self) -> Optional[float]:
        """Get agent uptime in seconds"""
        if not self.registration_time:
            return None
        return (datetime.now() - self.registration_time).total_seconds()

class AgentLifecycleManager:
    """
    Unified manager for agent lifecycle operations
    """

    def __init__(self, orchestrator: Optional[MasterAgentOrchestrator] = None):
        self.orchestrator = orchestrator or (get_orchestrator() if ORCHESTRATOR_AVAILABLE else None)
        self.pool_manager = get_pool_manager(self.orchestrator) if ORCHESTRATOR_AVAILABLE else None
        self.health_monitor = get_health_monitor(self.orchestrator) if ORCHESTRATOR_AVAILABLE else None

        # Lifecycle tracking
        self.agent_lifecycles: Dict[str, AgentLifecycle] = {}
        self.lifecycle_history: Dict[str, List[Dict[str, Any]]] = {}

        # Discovery and registration
        self.discovery_interval = 30  # seconds
        self.heartbeat_timeout = 120  # seconds
        self.registration_timeout = 60  # seconds

        # Shutdown management
        self.shutdown_queue: List[str] = []
        self.shutdown_in_progress: Set[str] = set()

        # Threading
        self.is_managing = False
        self.discovery_thread: Optional[threading.Thread] = None
        self.lifecycle_thread: Optional[threading.Thread] = None
        self.shutdown_thread: Optional[threading.Thread] = None

        # Callbacks
        self.lifecycle_callbacks: List[Callable] = []
        self.discovery_callbacks: List[Callable] = []
        self.shutdown_callbacks: List[Callable] = []

        # Configuration
        self.auto_discovery = True
        self.auto_registration = True
        self.graceful_shutdown_timeout = 60

        # Register cleanup handlers
        atexit.register(self._emergency_cleanup)

    def start_management(self):
        """Start the lifecycle management system"""
        if self.is_managing:
            return

        logger.info("Starting agent lifecycle management")
        self.is_managing = True

        # Start management threads
        self.discovery_thread = threading.Thread(target=self._discovery_loop, daemon=True)
        self.discovery_thread.start()

        self.lifecycle_thread = threading.Thread(target=self._lifecycle_loop, daemon=True)
        self.lifecycle_thread.start()

        self.shutdown_thread = threading.Thread(target=self._shutdown_loop, daemon=True)
        self.shutdown_thread.start()

    def stop_management(self):
        """Stop the lifecycle management system"""
        if not self.is_managing:
            return

        logger.info("Stopping agent lifecycle management")
        self.is_managing = False

        # Wait for threads
        threads = [self.discovery_thread, self.lifecycle_thread, self.shutdown_thread]
        for thread in threads:
            if thread and thread.is_alive():
                thread.join(timeout=10)

    def register_agent(self, agent_id: str, role: AgentRole = AgentRole.SLAVE,
                      capabilities: Optional[List[str]] = None,
                      process_info: Optional[Dict[str, Any]] = None,
                      dependencies: Optional[Set[str]] = None) -> bool:
        """Register a new agent with the system"""
        if agent_id in self.agent_lifecycles:
            logger.warning(f"Agent {agent_id} already registered")
            return False

        # Create lifecycle entry
        lifecycle = AgentLifecycle(
            agent_id=agent_id,
            role=role,
            stage=LifecycleStage.REGISTERING,
            process_info=process_info or {},
            registration_time=datetime.now(),
            dependencies=dependencies or set()
        )

        self.agent_lifecycles[agent_id] = lifecycle
        self.lifecycle_history[agent_id] = []

        # Log lifecycle change
        self._log_lifecycle_event(agent_id, LifecycleStage.UNREGISTERED, LifecycleStage.REGISTERING)

        # Register with orchestrator if available
        if self.orchestrator:
            success = self.orchestrator.register_slave_agent(
                agent_id=agent_id,
                capabilities=capabilities,
                role=role
            )
            if success:
                lifecycle.stage = LifecycleStage.INITIALIZING
                self._log_lifecycle_event(agent_id, LifecycleStage.REGISTERING, LifecycleStage.INITIALIZING)
                logger.info(f"Registered agent {agent_id} with role {role.value}")
                return True
            else:
                lifecycle.stage = LifecycleStage.FAILED
                self._log_lifecycle_event(agent_id, LifecycleStage.REGISTERING, LifecycleStage.FAILED)
                logger.error(f"Failed to register agent {agent_id} with orchestrator")
                return False

        # If no orchestrator, mark as ready
        lifecycle.stage = LifecycleStage.READY
        self._log_lifecycle_event(agent_id, LifecycleStage.REGISTERING, LifecycleStage.READY)
        logger.info(f"Registered agent {agent_id} (no orchestrator)")
        return True

    def unregister_agent(self, agent_id: str, shutdown_mode: ShutdownMode = ShutdownMode.GRACEFUL) -> bool:
        """Unregister an agent from the system"""
        if agent_id not in self.agent_lifecycles:
            return False

        lifecycle = self.agent_lifecycles[agent_id]

        # Check if agent has dependents
        if lifecycle.dependents and shutdown_mode != ShutdownMode.FORCEFUL:
            logger.warning(f"Agent {agent_id} has dependents, use forceful shutdown or handle dependencies first")
            return False

        # Initiate shutdown
        lifecycle.stage = LifecycleStage.SHUTTING_DOWN
        lifecycle.shutdown_mode = shutdown_mode
        self._log_lifecycle_event(agent_id, lifecycle.stage, LifecycleStage.SHUTTING_DOWN)

        # Add to shutdown queue
        self.shutdown_queue.append(agent_id)

        logger.info(f"Initiated shutdown for agent {agent_id} with mode {shutdown_mode.value}")
        return True

    def discover_agents(self) -> List[str]:
        """Discover running OpenCode agents"""
        discovered_agents = []

        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time']):
                try:
                    cmdline = proc.info['cmdline']
                    if cmdline and 'opencode' in ' '.join(cmdline).lower():
                        # Skip orchestrator and manager processes
                        if any(x in ' '.join(cmdline) for x in ['orchestrator', 'lifecycle', 'manager']):
                            continue

                        agent_id = f"discovered_{proc.info['pid']}"
                        process_info = {
                            'pid': proc.info['pid'],
                            'name': proc.info['name'],
                            'cmdline': ' '.join(cmdline),
                            'create_time': proc.info['create_time']
                        }

                        # Check if already known
                        if agent_id not in self.agent_lifecycles:
                            lifecycle = AgentLifecycle(
                                agent_id=agent_id,
                                role=AgentRole.SLAVE,  # Default role
                                stage=LifecycleStage.DISCOVERED,
                                process_info=process_info
                            )
                            self.agent_lifecycles[agent_id] = lifecycle
                            self.lifecycle_history[agent_id] = []
                            discovered_agents.append(agent_id)

                            # Trigger discovery callback
                            for callback in self.discovery_callbacks:
                                try:
                                    callback(agent_id, lifecycle)
                                except Exception as e:
                                    logger.error(f"Error in discovery callback: {e}")

                except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                    continue

        except Exception as e:
            logger.error(f"Error discovering agents: {e}")

        if discovered_agents:
            logger.info(f"Discovered {len(discovered_agents)} new agents: {discovered_agents}")

        return discovered_agents

    def update_agent_heartbeat(self, agent_id: str):
        """Update agent heartbeat timestamp"""
        if agent_id in self.agent_lifecycles:
            lifecycle = self.agent_lifecycles[agent_id]
            lifecycle.last_heartbeat = datetime.now()

            # Update stage if appropriate
            if lifecycle.stage == LifecycleStage.READY:
                lifecycle.stage = LifecycleStage.ACTIVE
                self._log_lifecycle_event(agent_id, LifecycleStage.READY, LifecycleStage.ACTIVE)

    def get_agent_status(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get comprehensive status of an agent"""
        if agent_id not in self.agent_lifecycles:
            return None

        lifecycle = self.agent_lifecycles[agent_id]

        return {
            'agent_id': agent_id,
            'role': lifecycle.role.value,
            'stage': lifecycle.stage.value,
            'is_alive': lifecycle.is_alive,
            'uptime': lifecycle.uptime,
            'last_heartbeat': lifecycle.last_heartbeat.isoformat() if lifecycle.last_heartbeat else None,
            'registration_time': lifecycle.registration_time.isoformat() if lifecycle.registration_time else None,
            'process_info': lifecycle.process_info,
            'dependencies': list(lifecycle.dependencies),
            'dependents': list(lifecycle.dependents),
            'metadata': lifecycle.metadata.copy()
        }

    def list_agents(self, stage_filter: Optional[LifecycleStage] = None,
                   role_filter: Optional[AgentRole] = None) -> List[Dict[str, Any]]:
        """List agents with optional filtering"""
        agents = []

        for agent_id, lifecycle in self.agent_lifecycles.items():
            if stage_filter and lifecycle.stage != stage_filter:
                continue
            if role_filter and lifecycle.role != role_filter:
                continue

            agents.append(self.get_agent_status(agent_id))

        return agents

    def add_dependency(self, dependent_id: str, dependency_id: str) -> bool:
        """Add a dependency relationship between agents"""
        if dependent_id not in self.agent_lifecycles or dependency_id not in self.agent_lifecycles:
            return False

        dependent = self.agent_lifecycles[dependent_id]
        dependency = self.agent_lifecycles[dependency_id]

        dependent.dependencies.add(dependency_id)
        dependency.dependents.add(dependent_id)

        logger.info(f"Added dependency: {dependent_id} depends on {dependency_id}")
        return True

    def remove_dependency(self, dependent_id: str, dependency_id: str) -> bool:
        """Remove a dependency relationship between agents"""
        if dependent_id not in self.agent_lifecycles or dependency_id not in self.agent_lifecycles:
            return False

        dependent = self.agent_lifecycles[dependent_id]
        dependency = self.agent_lifecycles[dependency_id]

        dependent.dependencies.discard(dependency_id)
        dependency.dependents.discard(dependent_id)

        logger.info(f"Removed dependency: {dependent_id} no longer depends on {dependency_id}")
        return True

    def _discovery_loop(self):
        """Main discovery loop"""
        while self.is_managing:
            try:
                if self.auto_discovery:
                    self.discover_agents()

                time.sleep(self.discovery_interval)

            except Exception as e:
                logger.error(f"Error in discovery loop: {e}")
                time.sleep(5)

    def _lifecycle_loop(self):
        """Main lifecycle monitoring loop"""
        while self.is_managing:
            try:
                self._check_agent_health()
                self._check_timeouts()
                self._update_agent_stages()

                time.sleep(15)  # Check every 15 seconds

            except Exception as e:
                logger.error(f"Error in lifecycle loop: {e}")
                time.sleep(5)

    def _shutdown_loop(self):
        """Main shutdown processing loop"""
        while self.is_managing:
            try:
                self._process_shutdown_queue()
                time.sleep(5)

            except Exception as e:
                logger.error(f"Error in shutdown loop: {e}")
                time.sleep(5)

    def _check_agent_health(self):
        """Check health of all registered agents"""
        current_time = datetime.now()

        for agent_id, lifecycle in list(self.agent_lifecycles.items()):
            # Check if process is still alive
            if not lifecycle.is_alive and lifecycle.stage not in [LifecycleStage.TERMINATED, LifecycleStage.FAILED]:
                logger.warning(f"Agent {agent_id} process is no longer alive")
                lifecycle.stage = LifecycleStage.FAILED
                self._log_lifecycle_event(agent_id, lifecycle.stage, LifecycleStage.FAILED)

            # Check heartbeat timeout
            if (lifecycle.last_heartbeat and
                (current_time - lifecycle.last_heartbeat).seconds > self.heartbeat_timeout):
                if lifecycle.stage != LifecycleStage.DEGRADED:
                    logger.warning(f"Agent {agent_id} heartbeat timeout")
                    lifecycle.stage = LifecycleStage.DEGRADED
                    self._log_lifecycle_event(agent_id, lifecycle.stage, LifecycleStage.DEGRADED)

    def _check_timeouts(self):
        """Check for registration and other timeouts"""
        current_time = datetime.now()

        for agent_id, lifecycle in list(self.agent_lifecycles.items()):
            # Check registration timeout
            if (lifecycle.stage == LifecycleStage.REGISTERING and
                lifecycle.registration_time and
                (current_time - lifecycle.registration_time).seconds > self.registration_timeout):
                logger.warning(f"Agent {agent_id} registration timeout")
                lifecycle.stage = LifecycleStage.FAILED
                self._log_lifecycle_event(agent_id, LifecycleStage.REGISTERING, LifecycleStage.FAILED)

    def _update_agent_stages(self):
        """Update agent stages based on current conditions"""
        for agent_id, lifecycle in list(self.agent_lifecycles.items()):
            # Auto-transition from INITIALIZING to READY
            if lifecycle.stage == LifecycleStage.INITIALIZING:
                # Check if agent has sent heartbeat or been active
                if lifecycle.last_heartbeat:
                    lifecycle.stage = LifecycleStage.READY
                    self._log_lifecycle_event(agent_id, LifecycleStage.INITIALIZING, LifecycleStage.READY)

    def _process_shutdown_queue(self):
        """Process agents waiting for shutdown"""
        if not self.shutdown_queue:
            return

        # Process one agent at a time to avoid overwhelming the system
        agent_id = self.shutdown_queue[0]

        if agent_id in self.shutdown_in_progress:
            # Already being shut down
            return

        if agent_id not in self.agent_lifecycles:
            self.shutdown_queue.pop(0)
            return

        lifecycle = self.agent_lifecycles[agent_id]

        try:
            self.shutdown_in_progress.add(agent_id)

            if lifecycle.shutdown_mode == ShutdownMode.GRACEFUL:
                success = self._graceful_shutdown(agent_id, lifecycle)
            elif lifecycle.shutdown_mode == ShutdownMode.FORCEFUL:
                success = self._forceful_shutdown(agent_id, lifecycle)
            elif lifecycle.shutdown_mode == ShutdownMode.DRAIN:
                success = self._drain_shutdown(agent_id, lifecycle)
            else:
                success = False

            if success:
                # Remove from shutdown queue
                self.shutdown_queue.pop(0)
                self.shutdown_in_progress.discard(agent_id)

                # Finalize termination
                lifecycle.stage = LifecycleStage.TERMINATED
                self._log_lifecycle_event(agent_id, lifecycle.stage, LifecycleStage.TERMINATED)

                # Clean up from orchestrator and pools
                self._cleanup_agent(agent_id)

                logger.info(f"Successfully shut down agent {agent_id}")

            else:
                # Check timeout
                if hasattr(lifecycle, '_shutdown_start') and lifecycle._shutdown_start:
                    if (datetime.now() - lifecycle._shutdown_start).seconds > self.graceful_shutdown_timeout:
                        logger.warning(f"Shutdown timeout for agent {agent_id}, forcing shutdown")
                        self._forceful_shutdown(agent_id, lifecycle)
                        self.shutdown_queue.pop(0)
                        self.shutdown_in_progress.discard(agent_id)

        except Exception as e:
            logger.error(f"Error shutting down agent {agent_id}: {e}")
            # Force shutdown on error
            self._forceful_shutdown(agent_id, lifecycle)
            self.shutdown_queue.pop(0)
            self.shutdown_in_progress.discard(agent_id)

    def _graceful_shutdown(self, agent_id: str, lifecycle: AgentLifecycle) -> bool:
        """Perform graceful shutdown"""
        if not hasattr(lifecycle, '_shutdown_start'):
            lifecycle._shutdown_start = datetime.now()

        # Send shutdown signal
        if lifecycle.process_info and 'pid' in lifecycle.process_info:
            try:
                os.kill(lifecycle.process_info['pid'], signal.SIGTERM)
                # Wait for process to terminate
                time.sleep(2)
                return not lifecycle.is_alive
            except (OSError, ProcessLookupError):
                return True  # Process already gone

        return False

    def _forceful_shutdown(self, agent_id: str, lifecycle: AgentLifecycle) -> bool:
        """Perform forceful shutdown"""
        if lifecycle.process_info and 'pid' in lifecycle.process_info:
            try:
                os.kill(lifecycle.process_info['pid'], signal.SIGKILL)
                time.sleep(1)
                return not lifecycle.is_alive
            except (OSError, ProcessLookupError):
                return True  # Process already gone

        return False

    def _drain_shutdown(self, agent_id: str, lifecycle: AgentLifecycle) -> bool:
        """Perform drain shutdown (stop accepting new work, complete existing)"""
        # For now, just do graceful shutdown
        # In a full implementation, this would coordinate with task managers
        return self._graceful_shutdown(agent_id, lifecycle)

    def _cleanup_agent(self, agent_id: str):
        """Clean up agent from all systems"""
        # Remove from orchestrator
        if self.orchestrator:
            self.orchestrator.unregister_slave_agent(agent_id)

        # Remove from pools
        if self.pool_manager:
            for pool in self.pool_manager.pools.values():
                pool.remove_agent(agent_id)

        # Remove lifecycle entry after some time
        def delayed_cleanup():
            time.sleep(300)  # Keep history for 5 minutes
            if agent_id in self.agent_lifecycles:
                del self.agent_lifecycles[agent_id]

        cleanup_thread = threading.Thread(target=delayed_cleanup, daemon=True)
        cleanup_thread.start()

    def _log_lifecycle_event(self, agent_id: str, from_stage: LifecycleStage, to_stage: LifecycleStage):
        """Log a lifecycle stage change"""
        event = {
            'timestamp': datetime.now().isoformat(),
            'agent_id': agent_id,
            'from_stage': from_stage.value,
            'to_stage': to_stage.value
        }

        if agent_id in self.lifecycle_history:
            self.lifecycle_history[agent_id].append(event)

            # Keep only last 100 events
            if len(self.lifecycle_history[agent_id]) > 100:
                self.lifecycle_history[agent_id].pop(0)

        # Trigger callbacks
        for callback in self.lifecycle_callbacks:
            try:
                callback(agent_id, from_stage, to_stage, event)
            except Exception as e:
                logger.error(f"Error in lifecycle callback: {e}")

    def _emergency_cleanup(self):
        """Emergency cleanup on system shutdown"""
        logger.info("Performing emergency cleanup")

        # Force shutdown all agents
        for agent_id in list(self.agent_lifecycles.keys()):
            lifecycle = self.agent_lifecycles[agent_id]
            if lifecycle.stage not in [LifecycleStage.TERMINATED, LifecycleStage.FAILED]:
                self._forceful_shutdown(agent_id, lifecycle)

    def add_lifecycle_callback(self, callback: Callable):
        """Add lifecycle event callback"""
        self.lifecycle_callbacks.append(callback)

    def add_discovery_callback(self, callback: Callable):
        """Add discovery event callback"""
        self.discovery_callbacks.append(callback)

    def add_shutdown_callback(self, callback: Callable):
        """Add shutdown event callback"""
        self.shutdown_callbacks.append(callback)

    def get_lifecycle_summary(self) -> Dict[str, Any]:
        """Get summary of agent lifecycle states"""
        stage_counts = {}
        role_counts = {}

        for lifecycle in self.agent_lifecycles.values():
            stage_counts[lifecycle.stage.value] = stage_counts.get(lifecycle.stage.value, 0) + 1
            role_counts[lifecycle.role.value] = role_counts.get(lifecycle.role.value, 0) + 1

        return {
            'total_agents': len(self.agent_lifecycles),
            'stage_distribution': stage_counts,
            'role_distribution': role_counts,
            'alive_agents': len([l for l in self.agent_lifecycles.values() if l.is_alive]),
            'shutdown_queue': len(self.shutdown_queue),
            'shutdown_in_progress': len(self.shutdown_in_progress)
        }

# Global lifecycle manager instance
_lifecycle_manager: Optional[AgentLifecycleManager] = None

def get_lifecycle_manager(orchestrator: Optional[MasterAgentOrchestrator] = None) -> AgentLifecycleManager:
    """Get or create the global lifecycle manager instance"""
    global _lifecycle_manager
    if _lifecycle_manager is None:
        _lifecycle_manager = AgentLifecycleManager(orchestrator)
    return _lifecycle_manager

if __name__ == '__main__':
    # Test the lifecycle manager
    manager = AgentLifecycleManager()

    try:
        manager.start_management()
        logger.info("Lifecycle manager started. Press Ctrl+C to stop.")

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        logger.info("Stopping lifecycle manager...")
    finally:
        try:
            manager.stop_management()
        except Exception as error:
            logger.exception("Error while stopping lifecycle manager: %s", error)
