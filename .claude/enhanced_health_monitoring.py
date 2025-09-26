#!/usr/bin/env python3
"""
Enhanced Agent Health Monitoring System

This module provides advanced health monitoring capabilities including:
- Predictive failure detection using machine learning
- Proactive agent restart mechanisms
- Health trend analysis and anomaly detection
- Automated recovery procedures
- Health-based load balancing
"""

import asyncio
import threading
import time
import psutil
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Union, Tuple
from enum import Enum
from collections import deque
import statistics
import logging

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

class HealthStatus(Enum):
    """Health status levels"""
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    CRITICAL = "critical"
    FAILED = "failed"

class FailurePrediction(Enum):
    """Failure prediction levels"""
    LOW_RISK = "low_risk"
    MEDIUM_RISK = "medium_risk"
    HIGH_RISK = "high_risk"
    IMMINENT_FAILURE = "imminent_failure"

class HealthMetric:
    """Represents a health metric with historical data"""

    def __init__(self, name: str, max_history: int = 100):
        self.name = name
        self.values: deque = deque(maxlen=max_history)
        self.timestamps: deque = deque(maxlen=max_history)
        self.baseline_mean = 0.0
        self.baseline_std = 0.0
        self.is_baseline_calculated = False

    def add_measurement(self, value: float, timestamp: Optional[datetime] = None):
        """Add a new measurement"""
        if timestamp is None:
            timestamp = datetime.now()

        self.values.append(value)
        self.timestamps.append(timestamp)

        # Recalculate baseline periodically
        if len(self.values) >= 10 and len(self.values) % 10 == 0:
            self._calculate_baseline()

    def get_current_value(self) -> Optional[float]:
        """Get the most recent value"""
        return self.values[-1] if self.values else None

    def get_trend(self, window: int = 10) -> float:
        """Calculate trend over recent measurements"""
        if len(self.values) < window:
            return 0.0

        recent = list(self.values)[-window:]
        if len(recent) < 2:
            return 0.0

        # Simple linear trend
        x = np.arange(len(recent))
        slope, _ = np.polyfit(x, recent, 1)
        return slope

    def is_anomalous(self, value: float, threshold_sigma: float = 2.0) -> bool:
        """Check if value is anomalous compared to baseline"""
        if not self.is_baseline_calculated or self.baseline_std == 0:
            return False

        deviation = abs(value - self.baseline_mean) / self.baseline_std
        return deviation > threshold_sigma

    def predict_failure_risk(self) -> FailurePrediction:
        """Predict failure risk based on trends and anomalies"""
        if len(self.values) < 20:
            return FailurePrediction.LOW_RISK

        recent_trend = self.get_trend(window=20)
        current_value = self.get_current_value()

        if current_value is None:
            return FailurePrediction.HIGH_RISK

        # CPU usage prediction
        if self.name == 'cpu_percent':
            if current_value > 95:
                return FailurePrediction.IMMINENT_FAILURE
            elif current_value > 85 or recent_trend > 5:
                return FailurePrediction.HIGH_RISK
            elif current_value > 75 or recent_trend > 2:
                return FailurePrediction.MEDIUM_RISK

        # Memory usage prediction
        elif self.name == 'memory_mb':
            if current_value > 900 or recent_trend > 50:  # Assuming 1GB limit
                return FailurePrediction.HIGH_RISK
            elif current_value > 700 or recent_trend > 20:
                return FailurePrediction.MEDIUM_RISK

        # Task failure rate prediction
        elif self.name == 'task_failure_rate':
            if current_value > 0.5 or recent_trend > 0.1:
                return FailurePrediction.HIGH_RISK
            elif current_value > 0.3 or recent_trend > 0.05:
                return FailurePrediction.MEDIUM_RISK

        return FailurePrediction.LOW_RISK

    def _calculate_baseline(self):
        """Calculate baseline statistics from historical data"""
        if len(self.values) < 10:
            return

        # Use recent stable period for baseline (exclude anomalies)
        values = np.array(self.values)
        mean = np.mean(values)
        std = np.std(values)

        # Remove outliers for more stable baseline
        z_scores = np.abs((values - mean) / std)
        filtered_values = values[z_scores < 2]

        if len(filtered_values) >= 5:
            self.baseline_mean = np.mean(filtered_values)
            self.baseline_std = np.std(filtered_values)
            self.is_baseline_calculated = True

class AgentHealthMonitor:
    """
    Advanced health monitor for individual agents with predictive capabilities
    """

    def __init__(self, agent_id: str, agent_type: str = 'worker'):
        self.agent_id = agent_id
        self.agent_type = agent_type

        # Health metrics
        self.metrics = {
            'cpu_percent': HealthMetric('cpu_percent'),
            'memory_mb': HealthMetric('memory_mb'),
            'disk_usage_percent': HealthMetric('disk_usage_percent'),
            'network_connections': HealthMetric('network_connections'),
            'task_completion_rate': HealthMetric('task_completion_rate'),
            'task_failure_rate': HealthMetric('task_failure_rate'),
            'response_time': HealthMetric('response_time'),
            'uptime_seconds': HealthMetric('uptime_seconds')
        }

        # Health status
        self.current_health = HealthStatus.GOOD
        self.failure_prediction = FailurePrediction.LOW_RISK
        self.last_health_check = datetime.now()
        self.consecutive_failures = 0
        self.recovery_attempts = 0

        # Health history
        self.health_history: deque = deque(maxlen=1000)  # Store last 1000 health checks
        self.anomaly_history: deque = deque(maxlen=100)

        # Configuration
        self.health_check_interval = 30  # seconds
        self.max_consecutive_failures = 3
        self.recovery_timeout = 300  # 5 minutes
        self.predictive_window = 10  # measurements for prediction

        # Callbacks
        self.health_change_callbacks: List[Callable] = []
        self.failure_prediction_callbacks: List[Callable] = []
        self.anomaly_callbacks: List[Callable] = []

        # Monitoring state
        self.is_monitoring = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.last_recovery_attempt = datetime.now() - timedelta(hours=1)  # Allow immediate first recovery

    def start_monitoring(self):
        """Start health monitoring"""
        if self.is_monitoring:
            return

        self.is_monitoring = True
        self.monitor_thread = threading.Thread(target=self._monitoring_loop, daemon=True)
        self.monitor_thread.start()

        logger.info(f"Started health monitoring for agent {self.agent_id}")

    def stop_monitoring(self):
        """Stop health monitoring"""
        self.is_monitoring = False

        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)

        logger.info(f"Stopped health monitoring for agent {self.agent_id}")

    def update_health_metrics(self, metrics_data: Dict[str, Any]):
        """
        Update health metrics with new measurements

        Args:
            metrics_data: Dictionary containing metric measurements
        """
        timestamp = datetime.now()

        for metric_name, value in metrics_data.items():
            if metric_name in self.metrics:
                metric = self.metrics[metric_name]
                was_anomalous = metric.is_anomalous(metric.get_current_value() or 0)

                metric.add_measurement(float(value), timestamp)

                # Check for new anomalies
                if not was_anomalous and metric.is_anomalous(float(value)):
                    self._on_anomaly_detected(metric_name, float(value))

        self.last_health_check = timestamp
        self._update_health_status()
        self._update_failure_prediction()

    def _update_health_status(self):
        """Update overall health status based on metrics"""
        old_health = self.current_health

        # Calculate health score from metrics
        health_scores = []

        # CPU health (0-100, lower is better for CPU %)
        cpu_metric = self.metrics['cpu_percent']
        cpu_value = cpu_metric.get_current_value()
        if cpu_value is not None:
            cpu_health = max(0, 100 - cpu_value)  # Invert CPU usage
            health_scores.append(cpu_health)

        # Memory health
        memory_metric = self.metrics['memory_mb']
        memory_value = memory_metric.get_current_value()
        if memory_value is not None:
            # Assume 1GB max memory, scale health accordingly
            memory_health = max(0, 100 - (memory_value / 10))  # Rough scaling
            health_scores.append(memory_health)

        # Task failure rate health
        failure_metric = self.metrics['task_failure_rate']
        failure_value = failure_metric.get_current_value()
        if failure_value is not None:
            failure_health = max(0, 100 - (failure_value * 200))  # Scale failure rate
            health_scores.append(failure_health)

        # Calculate overall health
        if health_scores:
            overall_score = statistics.mean(health_scores)
        else:
            overall_score = 50  # Default neutral health

        # Determine health status
        if overall_score >= 90:
            new_health = HealthStatus.EXCELLENT
        elif overall_score >= 75:
            new_health = HealthStatus.GOOD
        elif overall_score >= 60:
            new_health = HealthStatus.FAIR
        elif overall_score >= 40:
            new_health = HealthStatus.POOR
        elif overall_score >= 20:
            new_health = HealthStatus.CRITICAL
        else:
            new_health = HealthStatus.FAILED

        self.current_health = new_health

        # Notify if health changed
        if old_health != new_health:
            self._on_health_changed(old_health, new_health)

    def _update_failure_prediction(self):
        """Update failure prediction based on metric trends"""
        old_prediction = self.failure_prediction

        # Get predictions from all metrics
        predictions = []
        for metric in self.metrics.values():
            pred = metric.predict_failure_risk()
            predictions.append(pred.value)

        # Determine overall prediction (worst case)
        prediction_order = [
            FailurePrediction.LOW_RISK,
            FailurePrediction.MEDIUM_RISK,
            FailurePrediction.HIGH_RISK,
            FailurePrediction.IMMINENT_FAILURE
        ]

        max_prediction = FailurePrediction.LOW_RISK
        for pred in predictions:
            pred_enum = FailurePrediction(pred)
            if prediction_order.index(pred_enum) > prediction_order.index(max_prediction):
                max_prediction = pred_enum

        self.failure_prediction = max_prediction

        # Notify if prediction changed
        if old_prediction != max_prediction:
            self._on_failure_prediction_changed(old_prediction, max_prediction)

    def _on_health_changed(self, old_health: HealthStatus, new_health: HealthStatus):
        """Handle health status change"""
        logger.info(f"Agent {self.agent_id} health changed: {old_health.value} -> {new_health.value}")

        # Trigger recovery if health is critical
        if new_health in [HealthStatus.CRITICAL, HealthStatus.FAILED]:
            self._attempt_recovery()

        # Notify callbacks
        for callback in self.health_change_callbacks:
            try:
                callback(self.agent_id, old_health, new_health)
            except Exception as e:
                logger.error(f"Error in health change callback: {e}")

    def _on_failure_prediction_changed(self, old_prediction: FailurePrediction, new_prediction: FailurePrediction):
        """Handle failure prediction change"""
        logger.warning(f"Agent {self.agent_id} failure prediction changed: {old_prediction.value} -> {new_prediction.value}")

        # Trigger proactive actions for high risk
        if new_prediction in [FailurePrediction.HIGH_RISK, FailurePrediction.IMMINENT_FAILURE]:
            self._attempt_preventive_recovery()

        # Notify callbacks
        for callback in self.failure_prediction_callbacks:
            try:
                callback(self.agent_id, old_prediction, new_prediction)
            except Exception as e:
                logger.error(f"Error in failure prediction callback: {e}")

    def _on_anomaly_detected(self, metric_name: str, value: float):
        """Handle anomaly detection"""
        logger.warning(f"Anomaly detected in agent {self.agent_id} metric {metric_name}: {value}")

        self.anomaly_history.append({
            'timestamp': datetime.now(),
            'metric': metric_name,
            'value': value
        })

        # Notify callbacks
        for callback in self.anomaly_callbacks:
            try:
                callback(self.agent_id, metric_name, value)
            except Exception as e:
                logger.error(f"Error in anomaly callback: {e}")

    def _attempt_recovery(self):
        """Attempt to recover a failing agent"""
        if (datetime.now() - self.last_recovery_attempt).total_seconds() < self.recovery_timeout:
            logger.debug(f"Recovery attempt too soon for agent {self.agent_id}")
            return

        self.recovery_attempts += 1
        self.last_recovery_attempt = datetime.now()

        logger.info(f"Attempting recovery for agent {self.agent_id} (attempt {self.recovery_attempts})")

        # Implement recovery logic (this would integrate with agent management)
        # For now, just log the attempt
        # In a real implementation, this would:
        # 1. Restart the agent process
        # 2. Reset internal state
        # 3. Reconnect to orchestrator
        # 4. Restore from checkpoint if available

    def _attempt_preventive_recovery(self):
        """Attempt preventive recovery for high-risk agents"""
        logger.info(f"Attempting preventive recovery for agent {self.agent_id}")

        # Less aggressive than full recovery
        # Could involve:
        # 1. Reducing workload
        # 2. Clearing caches
        # 3. Restarting non-critical components
        # 4. Load balancing away from this agent

    def _monitoring_loop(self):
        """Main monitoring loop"""
        while self.is_monitoring:
            try:
                # Collect system metrics
                system_metrics = self._collect_system_metrics()

                # Update health metrics
                self.update_health_metrics(system_metrics)

                # Store health snapshot
                self.health_history.append({
                    'timestamp': datetime.now(),
                    'health': self.current_health.value,
                    'prediction': self.failure_prediction.value,
                    'metrics': {name: metric.get_current_value() for name, metric in self.metrics.items()}
                })

                time.sleep(self.health_check_interval)

            except Exception as e:
                logger.error(f"Error in monitoring loop for agent {self.agent_id}: {e}")
                time.sleep(5)

    def _collect_system_metrics(self) -> Dict[str, Any]:
        """Collect system metrics for the agent"""
        try:
            # In a real implementation, this would collect metrics specific to the agent
            # For now, return mock data
            return {
                'cpu_percent': psutil.cpu_percent(interval=1),
                'memory_mb': psutil.virtual_memory().used / (1024 * 1024),
                'disk_usage_percent': psutil.disk_usage('/').percent,
                'network_connections': len(psutil.net_connections()),
                'task_completion_rate': 0.95,  # Mock data
                'task_failure_rate': 0.05,    # Mock data
                'response_time': 0.1,         # Mock data
                'uptime_seconds': (datetime.now() - datetime(2024, 1, 1)).total_seconds()  # Mock data
            }
        except Exception as e:
            logger.error(f"Error collecting system metrics for agent {self.agent_id}: {e}")
            return {}

    def get_health_report(self) -> Dict[str, Any]:
        """Get comprehensive health report"""
        return {
            'agent_id': self.agent_id,
            'agent_type': self.agent_type,
            'current_health': self.current_health.value,
            'failure_prediction': self.failure_prediction.value,
            'last_health_check': self.last_health_check.isoformat(),
            'consecutive_failures': self.consecutive_failures,
            'recovery_attempts': self.recovery_attempts,
            'metrics': {
                name: {
                    'current_value': metric.get_current_value(),
                    'trend': metric.get_trend(),
                    'baseline_mean': metric.baseline_mean,
                    'baseline_std': metric.baseline_std,
                    'is_anomalous': metric.is_anomalous(metric.get_current_value() or 0)
                }
                for name, metric in self.metrics.items()
            },
            'recent_anomalies': list(self.anomaly_history)[-10:],  # Last 10 anomalies
            'health_history_size': len(self.health_history)
        }

    def add_health_change_callback(self, callback: Callable):
        """Add callback for health status changes"""
        self.health_change_callbacks.append(callback)

    def add_failure_prediction_callback(self, callback: Callable):
        """Add callback for failure prediction changes"""
        self.failure_prediction_callbacks.append(callback)

    def add_anomaly_callback(self, callback: Callable):
        """Add callback for anomaly detection"""
        self.anomaly_callbacks.append(callback)

class SystemHealthOrchestrator:
    """
    Orchestrates health monitoring across all agents in the system
    """

    def __init__(self):
        self.agent_monitors: Dict[str, AgentHealthMonitor] = {}
        self.system_health_history: deque = deque(maxlen=1000)
        self.is_monitoring = False
        self.monitor_thread: Optional[threading.Thread] = None

        # System-wide health thresholds
        self.critical_agent_threshold = 0.2  # 20% of agents critical
        self.system_degradation_threshold = 0.5  # 50% health degradation

        # Callbacks
        self.system_health_callbacks: List[Callable] = []
        self.agent_failure_callbacks: List[Callable] = []

    def add_agent(self, agent_id: str, agent_type: str = 'worker') -> AgentHealthMonitor:
        """Add an agent to health monitoring"""
        if agent_id in self.agent_monitors:
            return self.agent_monitors[agent_id]

        monitor = AgentHealthMonitor(agent_id, agent_type)

        # Set up callbacks
        monitor.add_health_change_callback(self._on_agent_health_changed)
        monitor.add_failure_prediction_callback(self._on_agent_failure_predicted)
        monitor.add_anomaly_callback(self._on_agent_anomaly)

        self.agent_monitors[agent_id] = monitor

        if self.is_monitoring:
            monitor.start_monitoring()

        logger.info(f"Added health monitoring for agent {agent_id}")
        return monitor

    def remove_agent(self, agent_id: str):
        """Remove an agent from health monitoring"""
        if agent_id in self.agent_monitors:
            monitor = self.agent_monitors[agent_id]
            monitor.stop_monitoring()
            del self.agent_monitors[agent_id]
            logger.info(f"Removed health monitoring for agent {agent_id}")

    def start_system_monitoring(self):
        """Start system-wide health monitoring"""
        if self.is_monitoring:
            return

        self.is_monitoring = True

        # Start all agent monitors
        for monitor in self.agent_monitors.values():
            monitor.start_monitoring()

        # Start system monitoring thread
        self.monitor_thread = threading.Thread(target=self._system_monitoring_loop, daemon=True)
        self.monitor_thread.start()

        logger.info("Started system health monitoring")

    def stop_system_monitoring(self):
        """Stop system-wide health monitoring"""
        if not self.is_monitoring:
            return

        self.is_monitoring = False

        # Stop all agent monitors
        for monitor in self.agent_monitors.values():
            monitor.stop_monitoring()

        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)

        logger.info("Stopped system health monitoring")

    def update_agent_metrics(self, agent_id: str, metrics: Dict[str, Any]):
        """Update metrics for a specific agent"""
        if agent_id in self.agent_monitors:
            self.agent_monitors[agent_id].update_health_metrics(metrics)

    def get_system_health_report(self) -> Dict[str, Any]:
        """Get comprehensive system health report"""
        agent_reports = {
            agent_id: monitor.get_health_report()
            for agent_id, monitor in self.agent_monitors.items()
        }

        # Calculate system-wide statistics
        total_agents = len(agent_reports)
        if total_agents == 0:
            return {'system_health': 'unknown', 'agents': {}}

        health_counts = {
            'excellent': 0,
            'good': 0,
            'fair': 0,
            'poor': 0,
            'critical': 0,
            'failed': 0
        }

        prediction_counts = {
            'low_risk': 0,
            'medium_risk': 0,
            'high_risk': 0,
            'imminent_failure': 0
        }

        for report in agent_reports.values():
            health_counts[report['current_health']] += 1
            prediction_counts[report['failure_prediction']] += 1

        # Determine overall system health
        critical_ratio = (health_counts['critical'] + health_counts['failed']) / total_agents
        poor_ratio = (health_counts['poor'] + health_counts['critical'] + health_counts['failed']) / total_agents

        if critical_ratio > self.critical_agent_threshold:
            system_health = 'critical'
        elif poor_ratio > 0.5:
            system_health = 'degraded'
        elif health_counts['excellent'] + health_counts['good'] > total_agents * 0.7:
            system_health = 'healthy'
        else:
            system_health = 'fair'

        return {
            'system_health': system_health,
            'total_agents': total_agents,
            'health_distribution': health_counts,
            'failure_prediction_distribution': prediction_counts,
            'critical_agent_ratio': critical_ratio,
            'agents': agent_reports,
            'timestamp': datetime.now().isoformat()
        }

    def _on_agent_health_changed(self, agent_id: str, old_health: HealthStatus, new_health: HealthStatus):
        """Handle agent health change"""
        logger.info(f"Agent {agent_id} health changed: {old_health.value} -> {new_health.value}")

        # Check for system-wide impact
        if new_health in [HealthStatus.CRITICAL, HealthStatus.FAILED]:
            self._check_system_health_impact()

    def _on_agent_failure_predicted(self, agent_id: str, old_prediction: FailurePrediction, new_prediction: FailurePrediction):
        """Handle agent failure prediction"""
        logger.warning(f"Agent {agent_id} failure prediction: {old_prediction.value} -> {new_prediction.value}")

        if new_prediction == FailurePrediction.IMMINENT_FAILURE:
            # Trigger immediate action
            for callback in self.agent_failure_callbacks:
                try:
                    callback(agent_id, 'imminent_failure')
                except Exception as e:
                    logger.error(f"Error in agent failure callback: {e}")

    def _on_agent_anomaly(self, agent_id: str, metric_name: str, value: float):
        """Handle agent anomaly detection"""
        logger.warning(f"Agent {agent_id} anomaly in {metric_name}: {value}")

    def _check_system_health_impact(self):
        """Check if agent health changes impact system health"""
        report = self.get_system_health_report()

        if report['system_health'] == 'critical':
            logger.critical("System health is critical - triggering system-wide recovery procedures")

            # Notify system health callbacks
            for callback in self.system_health_callbacks:
                try:
                    callback('critical', report)
                except Exception as e:
                    logger.error(f"Error in system health callback: {e}")

    def _system_monitoring_loop(self):
        """System-wide monitoring loop"""
        while self.is_monitoring:
            try:
                # Collect system health snapshot
                system_report = self.get_system_health_report()
                self.system_health_history.append({
                    'timestamp': datetime.now(),
                    'report': system_report
                })

                # Check for system-wide trends
                self._analyze_system_trends()

                time.sleep(60)  # Check every minute

            except Exception as e:
                logger.error(f"Error in system monitoring loop: {e}")
                time.sleep(30)

    def _analyze_system_trends(self):
        """Analyze system-wide health trends"""
        if len(self.system_health_history) < 5:
            return

        # Analyze recent health trends
        recent_reports = list(self.system_health_history)[-5:]

        # Check for degradation trend
        health_scores = []
        for entry in recent_reports:
            health = entry['report']['system_health']
            # Convert to numeric score
            score_map = {
                'healthy': 100,
                'fair': 75,
                'degraded': 50,
                'critical': 25,
                'unknown': 0
            }
            health_scores.append(score_map.get(health, 50))

        if len(health_scores) >= 3:
            trend = np.polyfit(range(len(health_scores)), health_scores, 1)[0]

            if trend < -10:  # Significant degradation
                logger.warning("System health is degrading - consider scaling up resources")

    def add_system_health_callback(self, callback: Callable):
        """Add callback for system health changes"""
        self.system_health_callbacks.append(callback)

    def add_agent_failure_callback(self, callback: Callable):
        """Add callback for agent failure events"""
        self.agent_failure_callbacks.append(callback)

# Global health orchestrator instance
_health_orchestrator_instance: Optional[SystemHealthOrchestrator] = None

def get_health_orchestrator() -> SystemHealthOrchestrator:
    """Get or create the global health orchestrator instance"""
    global _health_orchestrator_instance
    if _health_orchestrator_instance is None:
        _health_orchestrator_instance = SystemHealthOrchestrator()
    return _health_orchestrator_instance