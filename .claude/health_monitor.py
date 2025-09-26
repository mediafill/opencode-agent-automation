#!/usr/bin/env python3
"""
Enhanced Health Monitoring System - Predictive failure detection and auto-restart

This module provides comprehensive health monitoring for the master-slave agent
architecture with predictive analytics, automated recovery, and system resilience.
"""

import asyncio
import threading
import time
import psutil
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Callable, Tuple, Set
from enum import Enum
from dataclasses import dataclass, field
from collections import deque
import statistics

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

try:
    from master_agent_orchestrator import (
        AgentRole, AgentStatus, SlaveAgent, MasterAgentOrchestrator,
        get_orchestrator
    )
    ORCHESTRATOR_AVAILABLE = True
except ImportError:
    ORCHESTRATOR_AVAILABLE = False
    logger.warning("Master orchestrator not available")

class HealthStatus(Enum):
    """Health status levels"""
    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"
    FAILED = "failed"
    RECOVERING = "recovering"

class FailureType(Enum):
    """Types of failures that can be detected"""
    RESOURCE_EXHAUSTION = "resource_exhaustion"
    MEMORY_LEAK = "memory_leak"
    HIGH_CPU_USAGE = "high_cpu_usage"
    NETWORK_ISSUES = "network_issues"
    DISK_SPACE_LOW = "disk_space_low"
    PROCESS_CRASH = "process_crash"
    COMMUNICATION_TIMEOUT = "communication_timeout"
    TASK_TIMEOUT = "task_timeout"
    PREDICTIVE_FAILURE = "predictive_failure"

@dataclass
class HealthMetrics:
    """Comprehensive health metrics for an agent"""
    timestamp: datetime = field(default_factory=datetime.now)

    # Resource metrics
    cpu_percent: float = 0.0
    memory_percent: float = 0.0
    memory_mb: float = 0.0
    disk_usage_percent: float = 0.0
    network_connections: int = 0

    # Performance metrics
    response_time: float = 0.0
    tasks_completed: int = 0
    tasks_failed: int = 0
    error_rate: float = 0.0

    # System metrics
    thread_count: int = 0
    open_files: int = 0
    uptime_seconds: float = 0.0

    # Derived metrics
    health_score: float = 100.0
    trend_direction: str = "stable"  # improving, declining, stable

@dataclass
class PredictiveModel:
    """Simple predictive model for failure detection"""
    metric_name: str
    threshold: float
    window_size: int = 10
    sensitivity: float = 0.8

    # Historical data
    values: deque = field(default_factory=lambda: deque(maxlen=50))
    timestamps: deque = field(default_factory=lambda: deque(maxlen=50))

    def add_measurement(self, value: float, timestamp: datetime = None):
        """Add a new measurement to the model"""
        if timestamp is None:
            timestamp = datetime.now()

        self.values.append(value)
        self.timestamps.append(timestamp)

    def predict_failure(self) -> Tuple[bool, float]:
        """
        Predict if failure is likely based on trend analysis

        Returns:
            (will_fail, confidence_score)
        """
        if len(self.values) < self.window_size:
            return False, 0.0

        # Simple trend analysis
        recent_values = list(self.values)[-self.window_size:]
        if len(recent_values) < 3:
            return False, 0.0

        # Calculate trend (slope)
        x = list(range(len(recent_values)))
        try:
            slope = statistics.linear_regression(x, recent_values).slope
        except statistics.StatisticsError:
            return False, 0.0

        # Calculate recent average
        recent_avg = statistics.mean(recent_values[-3:])

        # Predict if trend will cross threshold
        if slope > 0 and recent_avg < self.threshold:
            # Increasing trend toward threshold
            steps_to_threshold = (self.threshold - recent_avg) / max(slope, 0.001)
            confidence = min(1.0, self.sensitivity * (1.0 / max(steps_to_threshold, 1.0)))
            return steps_to_threshold < 5, confidence  # Will fail within 5 steps
        elif slope < 0 and recent_avg > self.threshold:
            # Decreasing trend away from threshold
            return False, 0.0

        return False, 0.0

class HealthMonitor:
    """
    Advanced health monitoring system with predictive capabilities
    """

    def __init__(self, orchestrator: Optional[MasterAgentOrchestrator] = None):
        self.orchestrator = orchestrator or (get_orchestrator() if ORCHESTRATOR_AVAILABLE else None)

        # Health monitoring state
        self.is_monitoring = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.recovery_thread: Optional[threading.Thread] = None

        # Health data storage
        self.agent_health: Dict[str, HealthMetrics] = {}
        self.agent_history: Dict[str, List[HealthMetrics]] = {}
        self.predictive_models: Dict[str, Dict[str, PredictiveModel]] = {}

        # Predictive models for failure prediction
        self.predictive_models: Dict[str, PredictiveModel] = {}

        # Failure detection
        self.failure_detectors: Dict[FailureType, Callable] = {}
        self.active_failures: Dict[str, Set[FailureType]] = {}

        # Recovery system
        self.recovery_actions: Dict[FailureType, Callable] = {}
        self.auto_restart_enabled = True
        self.max_restart_attempts = 3
        self.restart_cooldown = 300  # 5 minutes

        # Thresholds
        self.thresholds = {
            'cpu_critical': 90.0,
            'cpu_warning': 75.0,
            'memory_critical': 85.0,
            'memory_warning': 70.0,
            'disk_critical': 95.0,
            'disk_warning': 85.0,
            'error_rate_critical': 0.5,
            'error_rate_warning': 0.2,
            'response_time_critical': 30.0,  # seconds
            'response_time_warning': 10.0,
        }

        # Callbacks
        self.health_callbacks: List[Callable] = []
        self.failure_callbacks: List[Callable] = []
        self.recovery_callbacks: List[Callable] = []

        # Initialize predictive models
        self._setup_predictive_models()

        # Setup failure detectors
        self._setup_failure_detectors()

        # Setup recovery actions
        self._setup_recovery_actions()

    def _setup_predictive_models(self):
        """Setup predictive models for different metrics"""
        self.predictive_models = {}

        metrics_to_monitor = [
            ('cpu_percent', self.thresholds['cpu_critical']),
            ('memory_percent', self.thresholds['memory_critical']),
            ('error_rate', self.thresholds['error_rate_critical']),
            ('response_time', self.thresholds['response_time_critical']),
        ]

        for metric_name, threshold in metrics_to_monitor:
            self.predictive_models[metric_name] = PredictiveModel(
                metric_name=metric_name,
                threshold=threshold,
                window_size=10,
                sensitivity=0.8
            )

    def _setup_failure_detectors(self):
        """Setup failure detection functions"""
        self.failure_detectors = {
            FailureType.RESOURCE_EXHAUSTION: self._detect_resource_exhaustion,
            FailureType.MEMORY_LEAK: self._detect_memory_leak,
            FailureType.HIGH_CPU_USAGE: self._detect_high_cpu_usage,
            FailureType.NETWORK_ISSUES: self._detect_network_issues,
            FailureType.DISK_SPACE_LOW: self._detect_disk_space_low,
            FailureType.PROCESS_CRASH: self._detect_process_crash,
            FailureType.COMMUNICATION_TIMEOUT: self._detect_communication_timeout,
            FailureType.TASK_TIMEOUT: self._detect_task_timeout,
            FailureType.PREDICTIVE_FAILURE: self._detect_predictive_failure,
        }

    def _setup_recovery_actions(self):
        """Setup recovery actions for different failure types"""
        self.recovery_actions = {
            FailureType.RESOURCE_EXHAUSTION: self._recover_resource_exhaustion,
            FailureType.MEMORY_LEAK: self._recover_memory_leak,
            FailureType.HIGH_CPU_USAGE: self._recover_high_cpu_usage,
            FailureType.NETWORK_ISSUES: self._recover_network_issues,
            FailureType.DISK_SPACE_LOW: self._recover_disk_space_low,
            FailureType.PROCESS_CRASH: self._recover_process_crash,
            FailureType.COMMUNICATION_TIMEOUT: self._recover_communication_timeout,
            FailureType.TASK_TIMEOUT: self._recover_task_timeout,
            FailureType.PREDICTIVE_FAILURE: self._recover_predictive_failure,
        }

    def start_monitoring(self):
        """Start the health monitoring system"""
        if self.is_monitoring:
            return

        logger.info("Starting enhanced health monitoring system")
        self.is_monitoring = True

        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitoring_loop, daemon=True)
        self.monitor_thread.start()

        # Start recovery thread
        self.recovery_thread = threading.Thread(target=self._recovery_loop, daemon=True)
        self.recovery_thread.start()

    def stop_monitoring(self):
        """Stop the health monitoring system"""
        if not self.is_monitoring:
            return

        logger.info("Stopping health monitoring system")
        self.is_monitoring = False

        # Wait for threads
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)
        if self.recovery_thread and self.recovery_thread.is_alive():
            self.recovery_thread.join(timeout=10)

    def _monitoring_loop(self):
        """Main monitoring loop"""
        while self.is_monitoring:
            try:
                self._collect_health_metrics()
                self._analyze_health_trends()
                self._detect_failures()
                self._update_predictive_models()

                time.sleep(30)  # Monitor every 30 seconds

            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                time.sleep(5)

    def _recovery_loop(self):
        """Main recovery loop"""
        while self.is_monitoring:
            try:
                self._execute_recovery_actions()
                self._cleanup_resolved_failures()

                time.sleep(60)  # Recovery check every minute

            except Exception as e:
                logger.error(f"Error in recovery loop: {e}")
                time.sleep(10)

    def _collect_health_metrics(self):
        """Collect health metrics from all agents"""
        if not self.orchestrator:
            return

        for agent_id, agent in self.orchestrator.slave_agents.items():
            try:
                metrics = self._collect_agent_metrics(agent)
                self.agent_health[agent_id] = metrics

                # Store in history (keep last 100 entries)
                if agent_id not in self.agent_history:
                    self.agent_history[agent_id] = []
                self.agent_history[agent_id].append(metrics)
                if len(self.agent_history[agent_id]) > 100:
                    self.agent_history[agent_id].pop(0)

            except Exception as e:
                logger.error(f"Error collecting metrics for agent {agent_id}: {e}")

    def _collect_agent_metrics(self, agent: SlaveAgent) -> HealthMetrics:
        """Collect comprehensive metrics for a single agent"""
        metrics = HealthMetrics()

        try:
            # Get process information
            if agent.process_info and agent.process_info.get('pid'):
                pid = agent.process_info['pid']
                try:
                    process = psutil.Process(pid)

                    # CPU and memory
                    metrics.cpu_percent = process.cpu_percent(interval=1)
                    memory_info = process.memory_info()
                    metrics.memory_mb = memory_info.rss / 1024 / 1024
                    metrics.memory_percent = process.memory_percent()

                    # System resources
                    metrics.thread_count = process.num_threads()
                    try:
                        metrics.open_files = len(process.open_files())
                    except:
                        metrics.open_files = 0

                    # Network connections
                    try:
                        metrics.network_connections = len(process.connections())
                    except:
                        metrics.network_connections = 0

                    # Uptime
                    create_time = agent.process_info.get('create_time', time.time())
                    metrics.uptime_seconds = time.time() - create_time

                except psutil.NoSuchProcess:
                    # Process doesn't exist
                    metrics.health_score = 0
                    return metrics

            # Performance metrics from agent
            metrics.tasks_completed = agent.resource_usage.get('tasks_completed', 0)
            metrics.tasks_failed = agent.resource_usage.get('tasks_failed', 0)

            total_tasks = metrics.tasks_completed + metrics.tasks_failed
            if total_tasks > 0:
                metrics.error_rate = metrics.tasks_failed / total_tasks

            # Disk usage (system-wide for now)
            disk = psutil.disk_usage('/')
            metrics.disk_usage_percent = disk.percent

            # Calculate health score
            metrics.health_score = self._calculate_health_score(metrics)

            # Determine trend
            metrics.trend_direction = self._calculate_trend(agent.agent_id, metrics)

        except Exception as e:
            logger.error(f"Error collecting metrics for agent {agent.agent_id}: {e}")
            metrics.health_score = 0

        return metrics

    def _calculate_health_score(self, metrics: HealthMetrics) -> float:
        """Calculate overall health score based on metrics"""
        score = 100.0

        # Resource penalties
        if metrics.cpu_percent > self.thresholds['cpu_critical']:
            score -= 30
        elif metrics.cpu_percent > self.thresholds['cpu_warning']:
            score -= 15

        if metrics.memory_percent > self.thresholds['memory_critical']:
            score -= 25
        elif metrics.memory_percent > self.thresholds['memory_warning']:
            score -= 10

        if metrics.disk_usage_percent > self.thresholds['disk_critical']:
            score -= 20
        elif metrics.disk_usage_percent > self.thresholds['disk_warning']:
            score -= 10

        # Performance penalties
        if metrics.error_rate > self.thresholds['error_rate_critical']:
            score -= 40
        elif metrics.error_rate > self.thresholds['error_rate_warning']:
            score -= 20

        if metrics.response_time > self.thresholds['response_time_critical']:
            score -= 25
        elif metrics.response_time > self.thresholds['response_time_warning']:
            score -= 10

        return max(0.0, min(100.0, score))

    def _calculate_trend(self, agent_id: str, current_metrics: HealthMetrics) -> str:
        """Calculate health trend direction"""
        history = self.agent_history.get(agent_id, [])
        if len(history) < 3:
            return "stable"

        recent_scores = [h.health_score for h in history[-3:]]
        recent_scores.append(current_metrics.health_score)

        if len(recent_scores) < 4:
            return "stable"

        # Simple trend analysis
        if recent_scores[-1] > recent_scores[0] + 5:
            return "improving"
        elif recent_scores[-1] < recent_scores[0] - 5:
            return "declining"
        else:
            return "stable"

    def _analyze_health_trends(self):
        """Analyze health trends and trigger alerts"""
        for agent_id, metrics in self.agent_health.items():
            health_status = self._get_health_status(metrics)

            # Trigger callbacks for status changes
            if health_status in [HealthStatus.CRITICAL, HealthStatus.FAILED]:
                for callback in self.health_callbacks:
                    try:
                        callback(agent_id, health_status, metrics)
                    except Exception as e:
                        logger.error(f"Error in health callback: {e}")

    def _get_health_status(self, metrics: HealthMetrics) -> HealthStatus:
        """Determine health status based on metrics"""
        if metrics.health_score <= 20:
            return HealthStatus.FAILED
        elif metrics.health_score <= 50:
            return HealthStatus.CRITICAL
        elif metrics.health_score <= 75:
            return HealthStatus.WARNING
        else:
            return HealthStatus.HEALTHY

    def _detect_failures(self):
        """Detect various types of failures"""
        for agent_id, metrics in self.agent_health.items():
            detected_failures = set()

            for failure_type, detector in self.failure_detectors.items():
                try:
                    if detector(agent_id, metrics):
                        detected_failures.add(failure_type)
                except Exception as e:
                    logger.error(f"Error in failure detector {failure_type.value}: {e}")

            # Update active failures
            if agent_id not in self.active_failures:
                self.active_failures[agent_id] = set()

            new_failures = detected_failures - self.active_failures[agent_id]
            resolved_failures = self.active_failures[agent_id] - detected_failures

            # Trigger failure callbacks
            for failure in new_failures:
                logger.warning(f"Detected failure {failure.value} for agent {agent_id}")
                for callback in self.failure_callbacks:
                    try:
                        callback(agent_id, failure, True)  # True = detected
                    except Exception as e:
                        logger.error(f"Error in failure callback: {e}")

            for failure in resolved_failures:
                logger.info(f"Resolved failure {failure.value} for agent {agent_id}")
                for callback in self.failure_callbacks:
                    try:
                        callback(agent_id, failure, False)  # False = resolved
                    except Exception as e:
                        logger.error(f"Error in failure callback: {e}")

            self.active_failures[agent_id] = detected_failures

    def _update_predictive_models(self):
        """Update predictive models with new data"""
        for agent_id, metrics in self.agent_health.items():
            for model_name, model in self.predictive_models.items():
                if hasattr(metrics, model_name):
                    value = getattr(metrics, model_name)
                    model.add_measurement(value, metrics.timestamp)

    def _execute_recovery_actions(self):
        """Execute recovery actions for detected failures"""
        if not self.auto_restart_enabled:
            return

        for agent_id, failures in self.active_failures.items():
            for failure in failures:
                recovery_action = self.recovery_actions.get(failure)
                if recovery_action:
                    try:
                        success = recovery_action(agent_id, failure)
                        if success:
                            logger.info(f"Successfully recovered from {failure.value} for agent {agent_id}")
                            for callback in self.recovery_callbacks:
                                try:
                                    callback(agent_id, failure, True)
                                except Exception as e:
                                    logger.error(f"Error in recovery callback: {e}")
                        else:
                            logger.warning(f"Failed to recover from {failure.value} for agent {agent_id}")
                    except Exception as e:
                        logger.error(f"Error executing recovery for {failure.value}: {e}")

    def _cleanup_resolved_failures(self):
        """Clean up resolved failures"""
        agents_to_remove = []
        for agent_id, failures in self.active_failures.items():
            if not failures and agent_id not in self.orchestrator.slave_agents:
                agents_to_remove.append(agent_id)

        for agent_id in agents_to_remove:
            del self.active_failures[agent_id]
            if agent_id in self.agent_history:
                del self.agent_history[agent_id]
            if agent_id in self.agent_health:
                del self.agent_health[agent_id]

    # Failure detection methods
    def _detect_resource_exhaustion(self, agent_id: str, metrics: HealthMetrics) -> bool:
        return (metrics.cpu_percent > self.thresholds['cpu_critical'] or
                metrics.memory_percent > self.thresholds['memory_critical'])

    def _detect_memory_leak(self, agent_id: str, metrics: HealthMetrics) -> bool:
        history = self.agent_history.get(agent_id, [])
        if len(history) < 5:
            return False

        # Check if memory is consistently increasing
        recent_memory = [h.memory_mb for h in history[-5:]]
        if len(recent_memory) < 5:
            return False

        try:
            slope = statistics.linear_regression(range(5), recent_memory).slope
            return slope > 10  # Memory increasing by more than 10MB per measurement
        except:
            return False

    def _detect_high_cpu_usage(self, agent_id: str, metrics: HealthMetrics) -> bool:
        return metrics.cpu_percent > self.thresholds['cpu_critical']

    def _detect_network_issues(self, agent_id: str, metrics: HealthMetrics) -> bool:
        return metrics.network_connections == 0  # No network connections

    def _detect_disk_space_low(self, agent_id: str, metrics: HealthMetrics) -> bool:
        return metrics.disk_usage_percent > self.thresholds['disk_critical']

    def _detect_process_crash(self, agent_id: str, metrics: HealthMetrics) -> bool:
        return metrics.health_score == 0  # Process not responding

    def _detect_communication_timeout(self, agent_id: str, metrics: HealthMetrics) -> bool:
        # Would check last communication time
        return False  # Placeholder

    def _detect_task_timeout(self, agent_id: str, metrics: HealthMetrics) -> bool:
        # Would check for tasks that haven't completed
        return False  # Placeholder

    def _detect_predictive_failure(self, agent_id: str, metrics: HealthMetrics) -> bool:
        """Use predictive models to detect impending failures"""
        for model_name, model in self.predictive_models.items():
            will_fail, confidence = model.predict_failure()
            if will_fail and confidence > 0.7:
                return True
        return False

    # Recovery action methods
    def _recover_resource_exhaustion(self, agent_id: str, failure: FailureType) -> bool:
        return self._attempt_agent_restart(agent_id)

    def _recover_memory_leak(self, agent_id: str, failure: FailureType) -> bool:
        return self._attempt_agent_restart(agent_id)

    def _recover_high_cpu_usage(self, agent_id: str, failure: FailureType) -> bool:
        # Could throttle agent or move to different pool
        return False  # Placeholder

    def _recover_network_issues(self, agent_id: str, failure: FailureType) -> bool:
        # Could restart network-related components
        return False  # Placeholder

    def _recover_disk_space_low(self, agent_id: str, failure: FailureType) -> bool:
        # Could trigger cleanup or alert
        return False  # Placeholder

    def _recover_process_crash(self, agent_id: str, failure: FailureType) -> bool:
        return self._attempt_agent_restart(agent_id)

    def _recover_communication_timeout(self, agent_id: str, failure: FailureType) -> bool:
        return self._attempt_agent_restart(agent_id)

    def _recover_task_timeout(self, agent_id: str, failure: FailureType) -> bool:
        # Could kill stuck tasks and restart agent
        return self._attempt_agent_restart(agent_id)

    def _recover_predictive_failure(self, agent_id: str, failure: FailureType) -> bool:
        # Proactive restart before failure occurs
        return self._attempt_agent_restart(agent_id)

    def _attempt_agent_restart(self, agent_id: str) -> bool:
        """Attempt to restart a failed agent"""
        if not self.orchestrator:
            return False

        try:
            # Check restart limits
            agent = self.orchestrator.slave_agents.get(agent_id)
            if not agent:
                return False

            # Basic restart logic (would be more sophisticated in real implementation)
            logger.info(f"Attempting to restart agent {agent_id}")

            # For now, just mark as recovering
            agent.status = AgentStatus.INITIALIZING

            # In a real implementation, this would spawn a new process
            # and update the agent's process_info

            return True

        except Exception as e:
            logger.error(f"Failed to restart agent {agent_id}: {e}")
            return False

    def add_health_callback(self, callback: Callable):
        """Add health status change callback"""
        self.health_callbacks.append(callback)

    def add_failure_callback(self, callback: Callable):
        """Add failure detection callback"""
        self.failure_callbacks.append(callback)

    def add_recovery_callback(self, callback: Callable):
        """Add recovery action callback"""
        self.recovery_callbacks.append(callback)

    def get_health_report(self) -> Dict[str, Any]:
        """Get comprehensive health report"""
        total_agents = len(self.agent_health)
        healthy_agents = len([m for m in self.agent_health.values() if m.health_score > 75])
        warning_agents = len([m for m in self.agent_health.values() if 50 < m.health_score <= 75])
        critical_agents = len([m for m in self.agent_health.values() if 20 < m.health_score <= 50])
        failed_agents = len([m for m in self.agent_health.values() if m.health_score <= 20])

        return {
            'timestamp': datetime.now().isoformat(),
            'total_agents': total_agents,
            'healthy_agents': healthy_agents,
            'warning_agents': warning_agents,
            'critical_agents': critical_agents,
            'failed_agents': failed_agents,
            'overall_health': (healthy_agents / max(total_agents, 1)) * 100,
            'active_failures': {
                agent_id: [f.value for f in failures]
                for agent_id, failures in self.active_failures.items()
            },
            'agent_details': {
                agent_id: {
                    'health_score': metrics.health_score,
                    'trend': metrics.trend_direction,
                    'cpu_percent': metrics.cpu_percent,
                    'memory_percent': metrics.memory_percent,
                    'error_rate': metrics.error_rate,
                    'response_time': metrics.response_time
                }
                for agent_id, metrics in self.agent_health.items()
            }
        }

# Global health monitor instance
_health_monitor: Optional[HealthMonitor] = None

def get_health_monitor(orchestrator: Optional[MasterAgentOrchestrator] = None) -> HealthMonitor:
    """Get or create the global health monitor instance"""
    global _health_monitor
    if _health_monitor is None:
        _health_monitor = HealthMonitor(orchestrator)
    return _health_monitor

if __name__ == '__main__':
    # Test the health monitoring system
    monitor = HealthMonitor()

    try:
        monitor.start_monitoring()
        logger.info("Health monitoring started. Press Ctrl+C to stop.")

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        logger.info("Stopping health monitoring...")
