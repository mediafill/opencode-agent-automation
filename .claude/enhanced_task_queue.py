#!/usr/bin/env python3
"""
Enhanced Task Queue System with Advanced Priority Management

This module provides sophisticated task scheduling with:
- Deadline-based priority scheduling
- Resource-aware task assignment
- Task dependencies and prerequisites
- SLA (Service Level Agreement) management
- Dynamic priority adjustment
- Fair scheduling algorithms
"""

import heapq
import time
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Union, Tuple
from enum import Enum
from collections import defaultdict, deque
import json
import logging

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

# Define TaskStatus locally to avoid import issues
class TaskStatus(Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class TaskPriority(Enum):
    """Enhanced priority levels with more granularity"""
    CRITICAL = 0
    URGENT = 1
    HIGH = 2
    MEDIUM_HIGH = 3
    MEDIUM = 4
    MEDIUM_LOW = 5
    LOW = 6
    BACKGROUND = 7

class TaskType(Enum):
    """Task type classifications for resource allocation"""
    COMPUTE_INTENSIVE = "compute_intensive"
    MEMORY_INTENSIVE = "memory_intensive"
    IO_INTENSIVE = "io_intensive"
    NETWORK_INTENSIVE = "network_intensive"
    GENERAL = "general"
    REAL_TIME = "real_time"
    BATCH = "batch"

class SLAType(Enum):
    """Service Level Agreement types"""
    STRICT = "strict"  # Must complete by deadline
    BEST_EFFORT = "best_effort"  # Try to complete by deadline
    FLEXIBLE = "flexible"  # No strict deadline

class ResourceRequirements:
    """Resource requirements for task execution"""

    def __init__(self,
                 cpu_cores: float = 1.0,
                 memory_mb: int = 256,
                 disk_space_mb: int = 100,
                 network_bandwidth: Optional[int] = None,
                 gpu_required: bool = False,
                 special_hardware: Optional[List[str]] = None):
        self.cpu_cores = cpu_cores
        self.memory_mb = memory_mb
        self.disk_space_mb = disk_space_mb
        self.network_bandwidth = network_bandwidth
        self.gpu_required = gpu_required
        self.special_hardware = special_hardware or []

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        return {
            'cpu_cores': self.cpu_cores,
            'memory_mb': self.memory_mb,
            'disk_space_mb': self.disk_space_mb,
            'network_bandwidth': self.network_bandwidth,
            'gpu_required': self.gpu_required,
            'special_hardware': self.special_hardware
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ResourceRequirements':
        """Create from dictionary"""
        return cls(
            cpu_cores=data.get('cpu_cores', 1.0),
            memory_mb=data.get('memory_mb', 256),
            disk_space_mb=data.get('disk_space_mb', 100),
            network_bandwidth=data.get('network_bandwidth'),
            gpu_required=data.get('gpu_required', False),
            special_hardware=data.get('special_hardware', [])
        )

class EnhancedTask:
    """Enhanced task with advanced scheduling features"""

    def __init__(self, task_data: Dict):
        # Basic task information
        self.id = task_data.get("id", f"task_{int(time.time())}")
        self.type = TaskType(task_data.get("type", "general").upper())
        self.base_priority = TaskPriority[task_data.get("priority", "MEDIUM").upper()]
        self.description = task_data.get("description", "")
        self.files_pattern = task_data.get("files_pattern", "**/*")

        # Advanced scheduling features
        self.deadline: Optional[datetime] = None
        if task_data.get("deadline"):
            self.deadline = datetime.fromisoformat(task_data["deadline"])

        self.sla_type = SLAType(task_data.get("sla_type", "best_effort").upper())
        self.resource_requirements = ResourceRequirements.from_dict(
            task_data.get("resource_requirements", {})
        )

        # Dependencies
        self.dependencies: Set[str] = set(task_data.get("dependencies", []))
        self.dependents: Set[str] = set()  # Tasks that depend on this one

        # Execution state
        self.status = TaskStatus.PENDING
        self.progress = 0
        self.created_at = datetime.now()
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self.error: Optional[str] = None
        self.retry_count = 0
        self.max_retries = task_data.get("max_retries", 3)

        # Dynamic priority calculation
        self.dynamic_priority = self._calculate_dynamic_priority()
        self.priority_boost = 0

        # Resource allocation
        self.assigned_agent: Optional[str] = None
        self.allocated_resources: Dict[str, Any] = {}

        # Performance tracking
        self.estimated_duration = task_data.get("estimated_duration", 300)
        self.actual_duration: Optional[float] = None
        self.resource_usage: Dict[str, Any] = {}

        # Callbacks
        self.on_status_change: Optional[Callable] = None
        self.on_progress_update: Optional[Callable] = None
        self.on_dependency_resolved: Optional[Callable] = None

    def _calculate_dynamic_priority(self) -> float:
        """Calculate dynamic priority based on multiple factors"""
        base_score = self.base_priority.value

        # Deadline-based urgency
        deadline_boost = 0
        if self.deadline:
            time_to_deadline = (self.deadline - datetime.now()).total_seconds()
            if time_to_deadline > 0:
                # Exponential boost as deadline approaches
                urgency_factor = max(0, 1 - (time_to_deadline / (24 * 3600)))  # 24 hours window
                deadline_boost = urgency_factor * 3  # Max 3 points boost
            else:
                # Overdue tasks get maximum boost
                deadline_boost = 5

        # SLA-based adjustment
        sla_boost = 0
        if self.sla_type == SLAType.STRICT:
            sla_boost = 2
        elif self.sla_type == SLAType.BEST_EFFORT:
            sla_boost = 1

        # Resource intensity adjustment (higher resource needs = higher priority)
        resource_boost = 0
        if self.resource_requirements.cpu_cores > 2:
            resource_boost += 1
        if self.resource_requirements.memory_mb > 1024:
            resource_boost += 1
        if self.resource_requirements.gpu_required:
            resource_boost += 2

        # Age-based adjustment (older tasks get slight boost to prevent starvation)
        age_hours = (datetime.now() - self.created_at).total_seconds() / 3600
        age_boost = min(1, age_hours / 24)  # Max 1 point after 24 hours

        total_priority = base_score - deadline_boost - sla_boost - resource_boost - age_boost
        return max(0, total_priority)  # Ensure non-negative

    def update_dynamic_priority(self):
        """Recalculate dynamic priority"""
        old_priority = self.dynamic_priority
        self.dynamic_priority = self._calculate_dynamic_priority()

        if abs(old_priority - self.dynamic_priority) > 0.1:  # Significant change
            logger.debug(f"Task {self.id} priority changed: {old_priority:.2f} -> {self.dynamic_priority:.2f}")

    def can_execute(self, completed_tasks: Set[str]) -> bool:
        """Check if task can execute based on dependencies"""
        return all(dep in completed_tasks for dep in self.dependencies)

    def add_dependency(self, task_id: str):
        """Add a dependency"""
        self.dependencies.add(task_id)

    def remove_dependency(self, task_id: str):
        """Remove a dependency"""
        self.dependencies.discard(task_id)
        if self.on_dependency_resolved:
            self.on_dependency_resolved(self, task_id)

    def get_time_to_deadline(self) -> Optional[float]:
        """Get time remaining to deadline in seconds"""
        if not self.deadline:
            return None
        return max(0, (self.deadline - datetime.now()).total_seconds())

    def is_overdue(self) -> bool:
        """Check if task is overdue"""
        if not self.deadline:
            return False
        return datetime.now() > self.deadline

    def get_sla_compliance_score(self) -> float:
        """Get SLA compliance score (0-1, higher is better)"""
        if not self.deadline or not self.completed_at:
            return 1.0 if not self.deadline else 0.5  # Neutral for no deadline

        if self.completed_at <= self.deadline:
            return 1.0  # Perfect compliance

        # Calculate compliance based on how late it was
        lateness = (self.completed_at - self.deadline).total_seconds()
        deadline_window = max(3600, self.estimated_duration * 2)  # 1 hour or 2x estimated time
        compliance = max(0, 1 - (lateness / deadline_window))

        return compliance

    def to_dict(self) -> Dict:
        """Convert task to dictionary for serialization"""
        return {
            "id": self.id,
            "type": self.type.value,
            "base_priority": self.base_priority.name.lower(),
            "dynamic_priority": self.dynamic_priority,
            "description": self.description,
            "files_pattern": self.files_pattern,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "sla_type": self.sla_type.value,
            "resource_requirements": self.resource_requirements.to_dict(),
            "dependencies": list(self.dependencies),
            "dependents": list(self.dependents),
            "status": self.status.value,
            "progress": self.progress,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error": self.error,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "estimated_duration": self.estimated_duration,
            "actual_duration": self.actual_duration,
            "assigned_agent": self.assigned_agent,
            "allocated_resources": self.allocated_resources,
            "resource_usage": self.resource_usage,
            "sla_compliance_score": self.get_sla_compliance_score()
        }

class EnhancedTaskQueue:
    """
    Advanced task queue with priority scheduling and resource awareness
    """

    def __init__(self):
        # Priority queue using heap (priority, insertion_order, task)
        self.queue = []
        self.insertion_counter = 0
        self.lock = threading.RLock()

        # Task storage and indexing
        self.tasks: Dict[str, EnhancedTask] = {}
        self.completed_tasks: Set[str] = set()
        self.failed_tasks: Set[str] = set()

        # Dependency tracking
        self.dependency_graph: Dict[str, Set[str]] = defaultdict(set)  # task -> dependents
        self.reverse_dependencies: Dict[str, Set[str]] = defaultdict(set)  # task -> dependencies

        # Resource tracking
        self.resource_pool: Dict[str, Any] = {}
        self.resource_allocations: Dict[str, Dict[str, Any]] = {}  # task_id -> resources

        # Scheduling statistics
        self.stats = {
            'total_tasks': 0,
            'completed_tasks': 0,
            'failed_tasks': 0,
            'avg_wait_time': 0.0,
            'avg_execution_time': 0.0,
            'sla_compliance_rate': 0.0,
            'resource_utilization': 0.0
        }

    def add_task(self, task: EnhancedTask):
        """Add task to queue with priority scheduling"""
        with self.lock:
            task.status = TaskStatus.QUEUED
            self.tasks[task.id] = task

            # Update dependency graph
            for dep in task.dependencies:
                self.reverse_dependencies[task.id].add(dep)
                self.dependency_graph[dep].add(task.id)

            # Only add to priority queue if dependencies are satisfied
            if task.can_execute(self.completed_tasks):
                self._add_to_priority_queue(task)
            else:
                logger.debug(f"Task {task.id} queued but waiting for dependencies: {task.dependencies}")

            self.stats['total_tasks'] += 1

    def _add_to_priority_queue(self, task: EnhancedTask):
        """Add task to priority queue"""
        heapq.heappush(self.queue, (task.dynamic_priority, self.insertion_counter, task))
        self.insertion_counter += 1

    def get_next_task(self, available_resources: Optional[Dict[str, Any]] = None) -> Optional[EnhancedTask]:
        """
        Get next task that can be executed with available resources

        Args:
            available_resources: Dictionary of available system resources
        """
        with self.lock:
            candidates = []

            # Check all queued tasks (not just the top one) for resource fit
            for priority, counter, task in self.queue:
                if self._can_allocate_resources(task, available_resources):
                    candidates.append((priority, counter, task))

            if not candidates:
                return None

            # Select best candidate (already sorted by priority)
            priority, counter, selected_task = candidates[0]

            # Remove from queue
            self.queue.remove((priority, counter, selected_task))
            heapq.heapify(self.queue)

            # Mark as running
            selected_task.status = TaskStatus.RUNNING
            selected_task.started_at = datetime.now()

            # Allocate resources
            if available_resources:
                self._allocate_resources(selected_task, available_resources)

            logger.debug(f"Selected task {selected_task.id} for execution (priority: {selected_task.dynamic_priority:.2f})")
            return selected_task

    def _can_allocate_resources(self, task: EnhancedTask, available_resources: Optional[Dict[str, Any]]) -> bool:
        """Check if resources can be allocated for task"""
        if not available_resources:
            return True  # No resource constraints

        req = task.resource_requirements

        # Check CPU cores
        if available_resources.get('cpu_cores', 0) < req.cpu_cores:
            return False

        # Check memory
        if available_resources.get('memory_mb', 0) < req.memory_mb:
            return False

        # Check disk space
        if available_resources.get('disk_space_mb', 0) < req.disk_space_mb:
            return False

        # Check GPU requirement
        if req.gpu_required and not available_resources.get('gpu_available', False):
            return False

        # Check special hardware
        available_hardware = set(available_resources.get('special_hardware', []))
        if not set(req.special_hardware).issubset(available_hardware):
            return False

        return True

    def _allocate_resources(self, task: EnhancedTask, available_resources: Dict[str, Any]):
        """Allocate resources for task execution"""
        allocation = {}

        # Allocate CPU cores
        allocation['cpu_cores'] = task.resource_requirements.cpu_cores
        available_resources['cpu_cores'] -= task.resource_requirements.cpu_cores

        # Allocate memory
        allocation['memory_mb'] = task.resource_requirements.memory_mb
        available_resources['memory_mb'] -= task.resource_requirements.memory_mb

        # Allocate disk space
        allocation['disk_space_mb'] = task.resource_requirements.disk_space_mb
        available_resources['disk_space_mb'] -= task.resource_requirements.disk_space_mb

        # Allocate special hardware
        allocation['special_hardware'] = task.resource_requirements.special_hardware.copy()
        for hardware in task.resource_requirements.special_hardware:
            if hardware in available_resources.get('special_hardware', []):
                available_resources['special_hardware'].remove(hardware)

        task.allocated_resources = allocation
        self.resource_allocations[task.id] = allocation

    def release_resources(self, task_id: str, available_resources: Dict[str, Any]):
        """Release resources allocated to task"""
        if task_id in self.resource_allocations:
            allocation = self.resource_allocations[task_id]

            # Return CPU cores
            available_resources['cpu_cores'] += allocation.get('cpu_cores', 0)

            # Return memory
            available_resources['memory_mb'] += allocation.get('memory_mb', 0)

            # Return disk space
            available_resources['disk_space_mb'] += allocation.get('disk_space_mb', 0)

            # Return special hardware
            for hardware in allocation.get('special_hardware', []):
                if 'special_hardware' not in available_resources:
                    available_resources['special_hardware'] = []
                available_resources['special_hardware'].append(hardware)

            del self.resource_allocations[task_id]

    def complete_task(self, task_id: str, success: bool = True, error: Optional[str] = None):
        """Mark task as completed"""
        with self.lock:
            if task_id not in self.tasks:
                return

            task = self.tasks[task_id]

            if success:
                task.status = TaskStatus.COMPLETED
                task.completed_at = datetime.now()
                self.completed_tasks.add(task_id)
                self.stats['completed_tasks'] += 1

                # Calculate actual duration
                if task.started_at:
                    task.actual_duration = (task.completed_at - task.started_at).total_seconds()

                # Notify dependents
                self._notify_dependents(task_id)

            else:
                task.status = TaskStatus.FAILED
                task.error = error
                self.failed_tasks.add(task_id)
                self.stats['failed_tasks'] += 1

                # Check retry logic
                if task.retry_count < task.max_retries:
                    task.retry_count += 1
                    task.status = TaskStatus.PENDING
                    task.error = None
                    task.progress = 0
                    task.started_at = None
                    task.completed_at = None

                    # Re-queue task
                    if task.can_execute(self.completed_tasks):
                        self._add_to_priority_queue(task)
                        logger.info(f"Retrying task {task_id} (attempt {task.retry_count})")
                    else:
                        logger.info(f"Task {task_id} waiting for dependencies before retry")

    def _notify_dependents(self, completed_task_id: str):
        """Notify dependent tasks that a dependency has been resolved"""
        if completed_task_id in self.dependency_graph:
            for dependent_id in self.dependency_graph[completed_task_id]:
                if dependent_id in self.tasks:
                    dependent_task = self.tasks[dependent_id]
                    dependent_task.remove_dependency(completed_task_id)

                    # Check if dependent can now execute
                    if dependent_task.can_execute(self.completed_tasks) and dependent_task.status == TaskStatus.PENDING:
                        self._add_to_priority_queue(dependent_task)
                        logger.debug(f"Task {dependent_id} now ready for execution")

    def update_priorities(self):
        """Update dynamic priorities for all queued tasks"""
        with self.lock:
            # Rebuild priority queue with updated priorities
            queued_tasks = []
            for priority, counter, task in self.queue:
                task.update_dynamic_priority()
                queued_tasks.append(task)

            # Clear and rebuild queue
            self.queue.clear()
            for task in queued_tasks:
                self._add_to_priority_queue(task)

    def get_overdue_tasks(self) -> List[EnhancedTask]:
        """Get tasks that are overdue"""
        with self.lock:
            overdue = []
            for task in self.tasks.values():
                if task.is_overdue() and task.status in [TaskStatus.PENDING, TaskStatus.QUEUED, TaskStatus.RUNNING]:
                    overdue.append(task)
            return overdue

    def get_sla_violations(self) -> List[EnhancedTask]:
        """Get tasks that violate SLA agreements"""
        with self.lock:
            violations = []
            for task in self.tasks.values():
                if task.sla_type == SLAType.STRICT and task.is_overdue():
                    violations.append(task)
            return violations

    def get_queue_status(self) -> Dict[str, Any]:
        """Get comprehensive queue status"""
        with self.lock:
            queued_tasks = [task for _, _, task in self.queue]
            priority_distribution = defaultdict(int)

            for task in queued_tasks:
                priority_distribution[task.base_priority.name.lower()] += 1

            overdue_count = len(self.get_overdue_tasks())
            sla_violations = len(self.get_sla_violations())

            return {
                'total_queued': len(queued_tasks),
                'priority_distribution': dict(priority_distribution),
                'overdue_tasks': overdue_count,
                'sla_violations': sla_violations,
                'waiting_for_dependencies': len([t for t in self.tasks.values()
                                               if t.status == TaskStatus.PENDING and not t.can_execute(self.completed_tasks)]),
                'resource_allocations': len(self.resource_allocations),
                'stats': self.stats.copy()
            }

    def cancel_task(self, task_id: str) -> bool:
        """Cancel a task"""
        with self.lock:
            if task_id not in self.tasks:
                return False

            task = self.tasks[task_id]

            # Remove from queue if present
            self.queue = [(p, c, t) for p, c, t in self.queue if t.id != task_id]
            heapq.heapify(self.queue)

            # Remove from resource allocations
            if task_id in self.resource_allocations:
                del self.resource_allocations[task_id]

            task.status = TaskStatus.CANCELLED
            task.completed_at = datetime.now()

            logger.info(f"Cancelled task {task_id}")
            return True

# Global enhanced task queue instance
_enhanced_queue_instance: Optional[EnhancedTaskQueue] = None

def get_enhanced_task_queue() -> EnhancedTaskQueue:
    """Get or create the global enhanced task queue instance"""
    global _enhanced_queue_instance
    if _enhanced_queue_instance is None:
        _enhanced_queue_instance = EnhancedTaskQueue()
    return _enhanced_queue_instance