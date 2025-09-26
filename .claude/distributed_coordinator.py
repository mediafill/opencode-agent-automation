#!/usr/bin/env python3
"""
Distributed Task Coordination System - Task dependencies, parallel execution, and cross-agent synchronization

This module provides advanced task coordination capabilities for the master-slave agent
architecture, enabling complex workflows with dependencies and parallel processing.
"""

import asyncio
import threading
import time
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Tuple, Union
from enum import Enum
from dataclasses import dataclass, field
from collections import defaultdict, deque
import networkx as nx

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

try:
    from master_agent_orchestrator import (
        AgentRole, AgentStatus, MessageType, AgentMessage,
        MasterAgentOrchestrator, get_orchestrator
    )
    from task_manager import Task, TaskStatus, TaskPriority
    ORCHESTRATOR_AVAILABLE = True
    TASK_MANAGER_AVAILABLE = True
except ImportError:
    ORCHESTRATOR_AVAILABLE = False
    TASK_MANAGER_AVAILABLE = False
    logger.warning("Orchestrator or task manager not available")

class TaskDependencyType(Enum):
    """Types of task dependencies"""
    FINISH_TO_START = "finish_to_start"  # Task B starts after Task A finishes
    START_TO_START = "start_to_start"    # Task B starts when Task A starts
    FINISH_TO_FINISH = "finish_to_finish"  # Task B finishes when Task A finishes
    START_TO_FINISH = "start_to_finish"   # Task B finishes when Task A starts

class ExecutionMode(Enum):
    """Task execution modes"""
    SEQUENTIAL = "sequential"      # Tasks execute one after another
    PARALLEL = "parallel"          # Tasks can execute simultaneously
    CONDITIONAL = "conditional"    # Execution based on conditions
    LOOP = "loop"                  # Repeated execution
    BRANCH = "branch"              # Conditional branching

class SynchronizationPoint(Enum):
    """Points where tasks synchronize"""
    TASK_START = "task_start"
    TASK_COMPLETE = "task_complete"
    CHECKPOINT = "checkpoint"
    BARRIER = "barrier"

@dataclass
class TaskDependency:
    """Represents a dependency between tasks"""
    from_task: str
    to_task: str
    dependency_type: TaskDependencyType
    lag_time: int = 0  # Delay in seconds
    condition: Optional[str] = None  # Conditional dependency

@dataclass
class SynchronizationBarrier:
    """Synchronization point for multiple tasks"""
    barrier_id: str
    required_tasks: Set[str]
    completed_tasks: Set[str] = field(default_factory=set)
    sync_type: SynchronizationPoint = SynchronizationPoint.BARRIER
    timeout: Optional[int] = None  # Timeout in seconds

@dataclass
class WorkflowDefinition:
    """Definition of a complex workflow"""
    workflow_id: str
    name: str
    description: str
    tasks: Dict[str, Dict[str, Any]]  # task_id -> task definition
    dependencies: List[TaskDependency]
    execution_mode: ExecutionMode = ExecutionMode.SEQUENTIAL
    max_parallel: int = 4
    timeout: Optional[int] = None
    retry_policy: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)

class DistributedCoordinator:
    """
    Coordinates complex distributed task execution with dependencies and synchronization
    """

    def __init__(self, orchestrator: Optional[MasterAgentOrchestrator] = None):
        self.orchestrator = orchestrator or (get_orchestrator() if ORCHESTRATOR_AVAILABLE else None)

        # Workflow management
        self.active_workflows: Dict[str, WorkflowDefinition] = {}
        self.workflow_status: Dict[str, Dict[str, Any]] = {}
        self.workflow_graphs: Dict[str, nx.DiGraph] = {}

        # Task coordination
        self.task_dependencies: Dict[str, List[TaskDependency]] = {}
        self.reverse_dependencies: Dict[str, List[TaskDependency]] = {}
        self.task_states: Dict[str, TaskStatus] = {}

        # Synchronization
        self.barriers: Dict[str, SynchronizationBarrier] = {}
        self.waiting_tasks: Dict[str, Set[str]] = defaultdict(set)  # barrier_id -> waiting tasks

        # Execution control
        self.execution_queues: Dict[str, deque] = {}  # workflow_id -> task queue
        self.running_tasks: Dict[str, Set[str]] = defaultdict(set)  # workflow_id -> running task ids
        self.completed_tasks: Dict[str, Set[str]] = defaultdict(set)  # workflow_id -> completed task ids
        self.failed_tasks: Dict[str, Set[str]] = defaultdict(set)  # workflow_id -> failed task ids

        # Threading and async
        self.is_coordinating = False
        self.coordination_thread: Optional[threading.Thread] = None
        self.monitor_thread: Optional[threading.Thread] = None

        # Callbacks
        self.workflow_callbacks: List[Callable] = []
        self.task_callbacks: List[Callable] = []
        self.sync_callbacks: List[Callable] = []

    def start_coordination(self):
        """Start the distributed coordination system"""
        if self.is_coordinating:
            return

        logger.info("Starting distributed task coordination")
        self.is_coordinating = True

        # Start coordination thread
        self.coordination_thread = threading.Thread(target=self._coordination_loop, daemon=True)
        self.coordination_thread.start()

        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitoring_loop, daemon=True)
        self.monitor_thread.start()

    def stop_coordination(self):
        """Stop the distributed coordination system"""
        if not self.is_coordinating:
            return

        logger.info("Stopping distributed task coordination")
        self.is_coordinating = False

        # Wait for threads
        if self.coordination_thread and self.coordination_thread.is_alive():
            self.coordination_thread.join(timeout=10)
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)

    def submit_workflow(self, workflow: WorkflowDefinition) -> str:
        """Submit a workflow for execution"""
        workflow_id = workflow.workflow_id

        # Store workflow
        self.active_workflows[workflow_id] = workflow
        self.workflow_status[workflow_id] = {
            'status': 'submitted',
            'submitted_at': datetime.now(),
            'tasks_total': len(workflow.tasks),
            'tasks_completed': 0,
            'tasks_failed': 0,
            'tasks_running': 0,
            'start_time': None,
            'end_time': None,
            'progress': 0.0
        }

        # Build dependency graph
        self._build_dependency_graph(workflow)

        # Initialize execution queue
        self.execution_queues[workflow_id] = deque()
        self._initialize_execution_queue(workflow_id)

        logger.info(f"Submitted workflow {workflow_id} with {len(workflow.tasks)} tasks")
        return workflow_id

    def _build_dependency_graph(self, workflow: WorkflowDefinition):
        """Build dependency graph for the workflow"""
        graph = nx.DiGraph()
        workflow_id = workflow.workflow_id

        # Add all tasks as nodes
        for task_id in workflow.tasks.keys():
            graph.add_node(task_id)

        # Add dependencies as edges
        self.task_dependencies[workflow_id] = []
        self.reverse_dependencies[workflow_id] = []

        for dep in workflow.dependencies:
            graph.add_edge(dep.from_task, dep.to_task)
            self.task_dependencies[workflow_id].append(dep)

            # Build reverse dependencies for quick lookup
            if dep.to_task not in self.reverse_dependencies:
                self.reverse_dependencies[workflow_id] = []
            self.reverse_dependencies[workflow_id].append(dep)

        self.workflow_graphs[workflow_id] = graph

    def _initialize_execution_queue(self, workflow_id: str):
        """Initialize the execution queue based on dependencies"""
        workflow = self.active_workflows[workflow_id]
        graph = self.workflow_graphs[workflow_id]

        # Find tasks with no dependencies (can start immediately)
        ready_tasks = []
        for task_id in workflow.tasks.keys():
            if graph.in_degree(task_id) == 0:  # No incoming edges
                ready_tasks.append(task_id)

        # Sort by priority if available
        ready_tasks.sort(key=lambda t: workflow.tasks[t].get('priority', 0), reverse=True)

        # Add to execution queue
        self.execution_queues[workflow_id].extend(ready_tasks)

        # Update workflow status
        self.workflow_status[workflow_id]['status'] = 'ready'

    def _coordination_loop(self):
        """Main coordination loop"""
        while self.is_coordinating:
            try:
                self._process_workflows()
                self._check_barriers()
                self._handle_timeouts()

                time.sleep(2)  # Coordinate every 2 seconds

            except Exception as e:
                logger.error(f"Error in coordination loop: {e}")
                time.sleep(5)

    def _monitoring_loop(self):
        """Main monitoring loop"""
        while self.is_coordinating:
            try:
                self._monitor_workflow_progress()
                self._detect_deadlocks()
                self._optimize_execution()

                time.sleep(10)  # Monitor every 10 seconds

            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                time.sleep(5)

    def _process_workflows(self):
        """Process active workflows"""
        for workflow_id in list(self.active_workflows.keys()):
            try:
                self._process_single_workflow(workflow_id)
            except Exception as e:
                logger.error(f"Error processing workflow {workflow_id}: {e}")

    def _process_single_workflow(self, workflow_id: str):
        """Process a single workflow"""
        workflow = self.active_workflows.get(workflow_id)
        if not workflow:
            return

        status = self.workflow_status[workflow_id]
        if status['status'] in ['completed', 'failed', 'cancelled']:
            return

        # Start workflow if ready
        if status['status'] == 'ready':
            status['status'] = 'running'
            status['start_time'] = datetime.now()
            logger.info(f"Started workflow {workflow_id}")

        # Execute available tasks
        self._execute_available_tasks(workflow_id)

        # Check if workflow is complete
        self._check_workflow_completion(workflow_id)

    def _execute_available_tasks(self, workflow_id: str):
        """Execute tasks that are ready to run"""
        workflow = self.active_workflows[workflow_id]
        queue = self.execution_queues[workflow_id]
        running = self.running_tasks[workflow_id]

        # Check how many tasks can run in parallel
        max_parallel = workflow.max_parallel
        available_slots = max_parallel - len(running)

        if available_slots <= 0:
            return

        # Execute tasks from queue
        executed = 0
        while queue and executed < available_slots:
            task_id = queue.popleft()

            # Check if task can actually start (dependencies satisfied)
            if self._can_start_task(workflow_id, task_id):
                self._start_task(workflow_id, task_id)
                executed += 1
            else:
                # Put back in queue if not ready
                queue.appendleft(task_id)
                break

    def _can_start_task(self, workflow_id: str, task_id: str) -> bool:
        """Check if a task can start based on dependencies"""
        dependencies = self.task_dependencies.get(workflow_id, [])
        task_deps = [d for d in dependencies if d.to_task == task_id]

        for dep in task_deps:
            from_task_status = self.task_states.get(dep.from_task, TaskStatus.PENDING)

            if dep.dependency_type == TaskDependencyType.FINISH_TO_START:
                if from_task_status != TaskStatus.COMPLETED:
                    return False
            elif dep.dependency_type == TaskDependencyType.START_TO_START:
                if from_task_status not in [TaskStatus.RUNNING, TaskStatus.COMPLETED]:
                    return False
            # Add other dependency types as needed

        return True

    def _start_task(self, workflow_id: str, task_id: str):
        """Start execution of a task"""
        workflow = self.active_workflows[workflow_id]
        task_def = workflow.tasks[task_id]

        # Create task data for orchestrator
        task_data = {
            'workflow_id': workflow_id,
            'task_id': task_id,
            'type': task_def.get('type', 'general'),
            'description': task_def.get('description', ''),
            'files_pattern': task_def.get('files_pattern', '**/*'),
            'priority': task_def.get('priority', 'medium'),
            'estimated_duration': task_def.get('estimated_duration', 300),
        }

        # Submit to orchestrator
        if self.orchestrator:
            agent_id = self.orchestrator.assign_task_hierarchically(
                task_id=f"{workflow_id}_{task_id}",
                task_data=task_data
            )

            if agent_id:
                self.task_states[task_id] = TaskStatus.RUNNING
                self.running_tasks[workflow_id].add(task_id)

                # Update workflow status
                status = self.workflow_status[workflow_id]
                status['tasks_running'] += 1

                logger.info(f"Started task {task_id} in workflow {workflow_id} on agent {agent_id}")
            else:
                logger.warning(f"Failed to assign task {task_id} in workflow {workflow_id}")
                # Put back in queue for retry
                self.execution_queues[workflow_id].appendleft(task_id)

    def update_task_status(self, workflow_id: str, task_id: str, status: TaskStatus,
                          result: Optional[Dict[str, Any]] = None):
        """Update the status of a task"""
        if workflow_id not in self.active_workflows:
            return

        old_status = self.task_states.get(task_id, TaskStatus.PENDING)
        self.task_states[task_id] = status

        workflow_status = self.workflow_status[workflow_id]

        if status == TaskStatus.COMPLETED:
            self.running_tasks[workflow_id].discard(task_id)
            self.completed_tasks[workflow_id].add(task_id)
            workflow_status['tasks_completed'] += 1
            workflow_status['tasks_running'] -= 1

            # Add dependent tasks to queue
            self._enqueue_dependent_tasks(workflow_id, task_id)

        elif status == TaskStatus.FAILED:
            self.running_tasks[workflow_id].discard(task_id)
            self.failed_tasks[workflow_id].add(task_id)
            workflow_status['tasks_failed'] += 1
            workflow_status['tasks_running'] -= 1

            # Handle task failure based on retry policy
            self._handle_task_failure(workflow_id, task_id)

        # Update progress
        total_tasks = workflow_status['tasks_total']
        completed = workflow_status['tasks_completed']
        workflow_status['progress'] = (completed / total_tasks) * 100 if total_tasks > 0 else 0

        # Trigger callbacks
        for callback in self.task_callbacks:
            try:
                callback(workflow_id, task_id, old_status, status, result)
            except Exception as e:
                logger.error(f"Error in task callback: {e}")

    def _enqueue_dependent_tasks(self, workflow_id: str, completed_task_id: str):
        """Add dependent tasks to the execution queue"""
        dependencies = self.task_dependencies.get(workflow_id, [])
        dependent_tasks = [d.to_task for d in dependencies if d.from_task == completed_task_id]

        for task_id in dependent_tasks:
            if self._can_start_task(workflow_id, task_id):
                if task_id not in self.execution_queues[workflow_id]:
                    self.execution_queues[workflow_id].append(task_id)

    def _handle_task_failure(self, workflow_id: str, task_id: str):
        """Handle task failure based on workflow retry policy"""
        workflow = self.active_workflows[workflow_id]
        retry_policy = workflow.retry_policy

        max_retries = retry_policy.get('max_retries', 0)
        retry_delay = retry_policy.get('retry_delay', 60)

        # Implement retry logic here
        # For now, just log the failure
        logger.warning(f"Task {task_id} in workflow {workflow_id} failed")

    def _check_workflow_completion(self, workflow_id: str):
        """Check if a workflow has completed"""
        status = self.workflow_status[workflow_id]
        workflow = self.active_workflows[workflow_id]

        total_tasks = len(workflow.tasks)
        completed_tasks = len(self.completed_tasks[workflow_id])
        failed_tasks = len(self.failed_tasks[workflow_id])

        if completed_tasks + failed_tasks >= total_tasks:
            if failed_tasks == 0:
                status['status'] = 'completed'
                status['end_time'] = datetime.now()
                logger.info(f"Workflow {workflow_id} completed successfully")
            else:
                status['status'] = 'failed'
                status['end_time'] = datetime.now()
                logger.warning(f"Workflow {workflow_id} failed with {failed_tasks} failed tasks")

            # Trigger workflow completion callback
            for callback in self.workflow_callbacks:
                try:
                    callback(workflow_id, status['status'])
                except Exception as e:
                    logger.error(f"Error in workflow callback: {e}")

    def create_barrier(self, barrier_id: str, required_tasks: Set[str],
                      sync_type: SynchronizationPoint = SynchronizationPoint.BARRIER,
                      timeout: Optional[int] = None) -> bool:
        """Create a synchronization barrier"""
        if barrier_id in self.barriers:
            return False

        barrier = SynchronizationBarrier(
            barrier_id=barrier_id,
            required_tasks=required_tasks.copy(),
            sync_type=sync_type,
            timeout=timeout
        )

        self.barriers[barrier_id] = barrier
        logger.info(f"Created barrier {barrier_id} for {len(required_tasks)} tasks")
        return True

    def _check_barriers(self):
        """Check synchronization barriers"""
        for barrier_id, barrier in list(self.barriers.items()):
            # Check if all required tasks are complete
            completed = barrier.completed_tasks
            required = barrier.required_tasks

            if required.issubset(completed):
                # Barrier satisfied
                self._release_barrier(barrier_id)
            elif barrier.timeout:
                # Check for timeout
                created_time = datetime.now()  # Would need to store creation time
                if (datetime.now() - created_time).seconds > barrier.timeout:
                    self._timeout_barrier(barrier_id)

    def _release_barrier(self, barrier_id: str):
        """Release a satisfied barrier"""
        barrier = self.barriers[barrier_id]

        # Release waiting tasks
        waiting_tasks = self.waiting_tasks[barrier_id]
        for task_id in waiting_tasks:
            # Add tasks back to execution queues
            # This would need workflow_id context
            pass

        # Trigger sync callback
        for callback in self.sync_callbacks:
            try:
                callback(barrier_id, 'released', barrier.completed_tasks)
            except Exception as e:
                logger.error(f"Error in sync callback: {e}")

        # Clean up
        del self.barriers[barrier_id]
        del self.waiting_tasks[barrier_id]

        logger.info(f"Released barrier {barrier_id}")

    def _timeout_barrier(self, barrier_id: str):
        """Handle barrier timeout"""
        barrier = self.barriers[barrier_id]

        logger.warning(f"Barrier {barrier_id} timed out")

        # Trigger sync callback
        for callback in self.sync_callbacks:
            try:
                callback(barrier_id, 'timed_out', barrier.completed_tasks)
            except Exception as e:
                logger.error(f"Error in sync callback: {e}")

        # Clean up
        del self.barriers[barrier_id]
        del self.waiting_tasks[barrier_id]

    def _handle_timeouts(self):
        """Handle workflow and task timeouts"""
        current_time = datetime.now()

        # Check workflow timeouts
        for workflow_id, status in self.workflow_status.items():
            workflow = self.active_workflows.get(workflow_id)
            if not workflow or not workflow.timeout:
                continue

            start_time = status.get('start_time')
            if start_time and (current_time - start_time).seconds > workflow.timeout:
                logger.warning(f"Workflow {workflow_id} timed out")
                status['status'] = 'timed_out'
                status['end_time'] = current_time

    def _monitor_workflow_progress(self):
        """Monitor overall workflow progress"""
        for workflow_id, status in self.workflow_status.items():
            if status['status'] == 'running':
                # Calculate progress metrics
                running = status['tasks_running']
                completed = status['tasks_completed']
                failed = status['tasks_failed']
                total = status['tasks_total']

                # Estimate time remaining
                if completed > 0:
                    avg_task_time = 300  # Would calculate from actual times
                    remaining_tasks = total - completed - failed
                    estimated_remaining = remaining_tasks * avg_task_time
                    status['estimated_completion'] = datetime.now() + timedelta(seconds=estimated_remaining)

    def _detect_deadlocks(self):
        """Detect potential deadlocks in workflows"""
        for workflow_id, graph in self.workflow_graphs.items():
            # Check for cycles (would indicate circular dependencies)
            if not nx.is_directed_acyclic_graph(graph):
                logger.error(f"Deadlock detected in workflow {workflow_id}: circular dependency")
                # Handle deadlock resolution

    def _optimize_execution(self):
        """Optimize workflow execution"""
        # Could implement load balancing, resource optimization, etc.
        pass

    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get status of a workflow"""
        return self.workflow_status.get(workflow_id)

    def cancel_workflow(self, workflow_id: str) -> bool:
        """Cancel a workflow"""
        if workflow_id not in self.active_workflows:
            return False

        # Cancel all running tasks
        running = self.running_tasks[workflow_id]
        for task_id in running:
            if self.orchestrator:
                self.orchestrator.cancel_task(f"{workflow_id}_{task_id}")

        # Update status
        self.workflow_status[workflow_id]['status'] = 'cancelled'
        self.workflow_status[workflow_id]['end_time'] = datetime.now()

        logger.info(f"Cancelled workflow {workflow_id}")
        return True

    def add_workflow_callback(self, callback: Callable):
        """Add workflow status callback"""
        self.workflow_callbacks.append(callback)

    def add_task_callback(self, callback: Callable):
        """Add task status callback"""
        self.task_callbacks.append(callback)

    def add_sync_callback(self, callback: Callable):
        """Add synchronization callback"""
        self.sync_callbacks.append(callback)

    def get_coordination_status(self) -> Dict[str, Any]:
        """Get overall coordination system status"""
        total_workflows = len(self.active_workflows)
        running_workflows = len([w for w in self.workflow_status.values() if w['status'] == 'running'])
        completed_workflows = len([w for w in self.workflow_status.values() if w['status'] == 'completed'])
        failed_workflows = len([w for w in self.workflow_status.values() if w['status'] in ['failed', 'timed_out']])

        total_tasks = sum(len(w.tasks) for w in self.active_workflows.values())
        running_tasks = sum(len(tasks) for tasks in self.running_tasks.values())
        completed_tasks = sum(len(tasks) for tasks in self.completed_tasks.values())

        return {
            'total_workflows': total_workflows,
            'running_workflows': running_workflows,
            'completed_workflows': completed_workflows,
            'failed_workflows': failed_workflows,
            'total_tasks': total_tasks,
            'running_tasks': running_tasks,
            'completed_tasks': completed_tasks,
            'active_barriers': len(self.barriers),
            'coordination_active': self.is_coordinating
        }

# Global coordinator instance
_coordinator: Optional[DistributedCoordinator] = None

def get_coordinator(orchestrator: Optional[MasterAgentOrchestrator] = None) -> DistributedCoordinator:
    """Get or create the global coordinator instance"""
    global _coordinator
    if _coordinator is None:
        _coordinator = DistributedCoordinator(orchestrator)
    return _coordinator

if __name__ == '__main__':
    # Test the distributed coordinator
    coordinator = DistributedCoordinator()

    try:
        coordinator.start_coordination()
        logger.info("Distributed coordinator started. Press Ctrl+C to stop.")

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        logger.info("Stopping distributed coordinator...")
