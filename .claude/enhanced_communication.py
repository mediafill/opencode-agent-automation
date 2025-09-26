#!/usr/bin/env python3
"""
Enhanced Inter-Agent Communication System

This module provides reliable, routed communication between agents with:
- Message routing and delivery guarantees
- Acknowledgment and retry mechanisms
- Message persistence and recovery
- Quality of service levels
- Communication analytics and monitoring
"""

import asyncio
import threading
import time
import json
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Union, Tuple
from enum import Enum
from collections import defaultdict, deque
import logging

try:
    from logger import StructuredLogger
    logger = StructuredLogger(__name__)
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

class MessagePriority(Enum):
    """Message priority levels"""
    CRITICAL = 0
    HIGH = 1
    NORMAL = 2
    LOW = 3
    BACKGROUND = 4

class QoSLevel(Enum):
    """Quality of Service levels"""
    AT_MOST_ONCE = "at_most_once"  # Fire and forget
    AT_LEAST_ONCE = "at_least_once"  # Guaranteed delivery with possible duplicates
    EXACTLY_ONCE = "exactly_once"  # Guaranteed delivery exactly once

class MessageStatus(Enum):
    """Message delivery status"""
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    ACKNOWLEDGED = "acknowledged"
    FAILED = "failed"
    EXPIRED = "expired"
    RETRYING = "retrying"

class DeliveryMode(Enum):
    """Message delivery modes"""
    DIRECT = "direct"  # Direct agent-to-agent
    BROADCAST = "broadcast"  # Send to all agents
    MULTICAST = "multicast"  # Send to specific group
    ROUTED = "routed"  # Route through coordinator

class EnhancedMessage:
    """Enhanced message with reliability features"""

    def __init__(self,
                 message_type: str,
                 sender_id: str,
                 payload: Dict[str, Any],
                 recipient_ids: Optional[List[str]] = None,
                 priority: MessagePriority = MessagePriority.NORMAL,
                 qos: QoSLevel = QoSLevel.AT_LEAST_ONCE,
                 delivery_mode: DeliveryMode = DeliveryMode.DIRECT,
                 ttl: int = 300,
                 correlation_id: Optional[str] = None,
                 reply_to: Optional[str] = None):
        self.message_id = f"msg_{int(time.time() * 1000)}_{hashlib.md5(str(payload).encode()).hexdigest()[:8]}"
        self.message_type = message_type
        self.sender_id = sender_id
        self.recipient_ids = recipient_ids or []
        self.payload = payload
        self.priority = priority
        self.qos = qos
        self.delivery_mode = delivery_mode
        self.ttl = ttl
        self.correlation_id = correlation_id
        self.reply_to = reply_to

        # Metadata
        self.created_at = datetime.now()
        self.expires_at = self.created_at + timedelta(seconds=ttl)
        self.retry_count = 0
        self.max_retries = 3
        self.status = MessageStatus.PENDING

        # Delivery tracking
        self.delivery_attempts: List[datetime] = []
        self.acknowledgments: Set[str] = set()
        self.failures: List[Tuple[str, str]] = []  # [(agent_id, error)]

        # Routing information
        self.route_path: List[str] = []
        self.next_hop: Optional[str] = None

    def is_expired(self) -> bool:
        """Check if message has expired"""
        return datetime.now() > self.expires_at

    def can_retry(self) -> bool:
        """Check if message can be retried"""
        return self.retry_count < self.max_retries and not self.is_expired()

    def mark_sent(self, agent_id: str):
        """Mark message as sent to an agent"""
        self.delivery_attempts.append(datetime.now())
        if agent_id not in [attempt for attempt in self.delivery_attempts]:
            pass  # Could track per-agent attempts

    def mark_delivered(self, agent_id: str):
        """Mark message as delivered to an agent"""
        self.status = MessageStatus.DELIVERED

    def mark_acknowledged(self, agent_id: str):
        """Mark message as acknowledged by an agent"""
        self.acknowledgments.add(agent_id)
        if self.qos == QoSLevel.EXACTLY_ONCE and len(self.acknowledgments) >= len(self.recipient_ids):
            self.status = MessageStatus.ACKNOWLEDGED

    def mark_failed(self, agent_id: str, error: str):
        """Mark message delivery as failed for an agent"""
        self.failures.append((agent_id, error))
        if len(self.failures) >= len(self.recipient_ids):
            self.status = MessageStatus.FAILED

    def increment_retry(self):
        """Increment retry count"""
        self.retry_count += 1
        self.status = MessageStatus.RETRYING

    def to_dict(self) -> Dict[str, Any]:
        """Convert message to dictionary for serialization"""
        return {
            'message_id': self.message_id,
            'message_type': self.message_type,
            'sender_id': self.sender_id,
            'recipient_ids': self.recipient_ids,
            'payload': self.payload,
            'priority': self.priority.value,
            'qos': self.qos.value,
            'delivery_mode': self.delivery_mode.value,
            'ttl': self.ttl,
            'correlation_id': self.correlation_id,
            'reply_to': self.reply_to,
            'created_at': self.created_at.isoformat(),
            'expires_at': self.expires_at.isoformat(),
            'retry_count': self.retry_count,
            'max_retries': self.max_retries,
            'status': self.status.value,
            'delivery_attempts': [dt.isoformat() for dt in self.delivery_attempts],
            'acknowledgments': list(self.acknowledgments),
            'failures': self.failures,
            'route_path': self.route_path,
            'next_hop': self.next_hop
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EnhancedMessage':
        """Create message from dictionary"""
        message = cls(
            message_type=data['message_type'],
            sender_id=data['sender_id'],
            payload=data['payload'],
            recipient_ids=data.get('recipient_ids', []),
            priority=MessagePriority(data.get('priority', MessagePriority.NORMAL.value)),
            qos=QoSLevel(data.get('qos', QoSLevel.AT_LEAST_ONCE.value)),
            delivery_mode=DeliveryMode(data.get('delivery_mode', DeliveryMode.DIRECT.value)),
            ttl=data.get('ttl', 300),
            correlation_id=data.get('correlation_id'),
            reply_to=data.get('reply_to')
        )

        message.message_id = data.get('message_id', message.message_id)
        message.created_at = datetime.fromisoformat(data['created_at'])
        message.expires_at = datetime.fromisoformat(data['expires_at'])
        message.retry_count = data.get('retry_count', 0)
        message.max_retries = data.get('max_retries', 3)
        message.status = MessageStatus(data.get('status', MessageStatus.PENDING.value))
        message.delivery_attempts = [datetime.fromisoformat(dt) for dt in data.get('delivery_attempts', [])]
        message.acknowledgments = set(data.get('acknowledgments', []))
        message.failures = data.get('failures', [])
        message.route_path = data.get('route_path', [])
        message.next_hop = data.get('next_hop')

        return message

class MessageRouter:
    """Intelligent message routing system"""

    def __init__(self):
        self.routing_table: Dict[str, List[str]] = defaultdict(list)  # agent_id -> [possible_routes]
        self.agent_capabilities: Dict[str, Set[str]] = defaultdict(set)
        self.agent_load: Dict[str, float] = {}  # agent_id -> load_score
        self.network_topology: Dict[str, Set[str]] = defaultdict(set)  # agent_id -> connected_agents

    def register_agent(self, agent_id: str, capabilities: Optional[List[str]] = None,
                      connected_agents: Optional[List[str]] = None):
        """Register an agent with the router"""
        if capabilities:
            self.agent_capabilities[agent_id] = set(capabilities)

        if connected_agents:
            self.network_topology[agent_id] = set(connected_agents)
            # Update bidirectional connections
            for connected_agent in connected_agents:
                self.network_topology[connected_agent].add(agent_id)

    def update_agent_load(self, agent_id: str, load_score: float):
        """Update agent load for routing decisions"""
        self.agent_load[agent_id] = load_score

    def find_route(self, from_agent: str, to_agent: str, message: EnhancedMessage) -> Optional[List[str]]:
        """
        Find optimal route for message delivery

        Uses capability-based routing and load balancing
        """
        if to_agent in self.network_topology[from_agent]:
            # Direct connection available
            return [from_agent, to_agent]

        # Find agents that can handle this message type
        capable_agents = []
        for agent_id, capabilities in self.agent_capabilities.items():
            if self._agent_can_handle_message(agent_id, message):
                capable_agents.append(agent_id)

        if not capable_agents:
            return None

        # Find shortest path to capable agent
        route = self._find_shortest_path(from_agent, capable_agents)
        if route and to_agent in route:
            return route

        # Fallback: find any route to target
        return self._find_shortest_path(from_agent, [to_agent])

    def _agent_can_handle_message(self, agent_id: str, message: EnhancedMessage) -> bool:
        """Check if agent can handle the message"""
        # Check capabilities
        required_caps = self._get_required_capabilities(message)
        if required_caps and not required_caps.issubset(self.agent_capabilities[agent_id]):
            return False

        # Check load
        load = self.agent_load.get(agent_id, 0)
        if load > 0.9:  # Over 90% load
            return False

        return True

    def _get_required_capabilities(self, message: EnhancedMessage) -> Set[str]:
        """Get capabilities required to handle message"""
        # Based on message type and QoS requirements
        caps = set()

        if message.qos == QoSLevel.EXACTLY_ONCE:
            caps.add('reliable_delivery')
        elif message.qos == QoSLevel.AT_LEAST_ONCE:
            caps.add('acknowledgment')

        if message.priority == MessagePriority.CRITICAL:
            caps.add('high_priority_handling')

        # Message type specific capabilities
        if message.message_type.startswith('task_'):
            caps.add('task_processing')
        elif message.message_type.startswith('health_'):
            caps.add('health_monitoring')
        elif message.message_type.startswith('coordination_'):
            caps.add('coordination')

        return caps

    def _find_shortest_path(self, start: str, targets: List[str]) -> Optional[List[str]]:
        """Find shortest path to any of the targets using BFS"""
        if start in targets:
            return [start]

        visited = set()
        queue = deque([(start, [start])])
        visited.add(start)

        while queue:
            current, path = queue.popleft()

            for neighbor in self.network_topology[current]:
                if neighbor not in visited:
                    new_path = path + [neighbor]
                    if neighbor in targets:
                        return new_path

                    visited.add(neighbor)
                    queue.append((neighbor, new_path))

        return None

class ReliableMessenger:
    """
    Reliable message delivery system with acknowledgments and retries
    """

    def __init__(self, agent_id: str, router: Optional[MessageRouter] = None):
        self.agent_id = agent_id
        self.router = router or MessageRouter()

        # Message queues
        self.outbound_queue: deque = deque()
        self.inbound_queue: deque = deque()
        self.pending_ack: Dict[str, EnhancedMessage] = {}  # message_id -> message
        self.retry_queue: deque = deque()

        # Persistence
        self.message_store: Dict[str, EnhancedMessage] = {}
        self.acknowledgment_store: Set[str] = set()

        # Delivery guarantees
        self.delivery_timeout = 30  # seconds
        self.retry_delay = 5  # seconds
        self.max_retry_delay = 300  # 5 minutes

        # Statistics
        self.stats = {
            'messages_sent': 0,
            'messages_received': 0,
            'messages_delivered': 0,
            'messages_failed': 0,
            'acknowledgments_received': 0,
            'retries_attempted': 0,
            'avg_delivery_time': 0.0
        }

        # Threading
        self.is_running = False
        self.delivery_thread: Optional[threading.Thread] = None
        self.retry_thread: Optional[threading.Thread] = None
        self.cleanup_thread: Optional[threading.Thread] = None

        # Callbacks
        self.message_handlers: Dict[str, Callable] = {}
        self.delivery_callbacks: List[Callable] = []
        self.failure_callbacks: List[Callable] = []

    def start(self):
        """Start the reliable messenger"""
        if self.is_running:
            return

        self.is_running = True

        self.delivery_thread = threading.Thread(target=self._delivery_loop, daemon=True)
        self.retry_thread = threading.Thread(target=self._retry_loop, daemon=True)
        self.cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)

        self.delivery_thread.start()
        self.retry_thread.start()
        self.cleanup_thread.start()

        logger.info(f"Started reliable messenger for agent {self.agent_id}")

    def stop(self):
        """Stop the reliable messenger"""
        self.is_running = False

        threads = [self.delivery_thread, self.retry_thread, self.cleanup_thread]
        for thread in threads:
            if thread and thread.is_alive():
                thread.join(timeout=10)

        logger.info(f"Stopped reliable messenger for agent {self.agent_id}")

    def send_message(self, message: EnhancedMessage) -> str:
        """
        Send a message reliably

        Returns message ID
        """
        # Set sender if not set
        if not message.sender_id:
            message.sender_id = self.agent_id

        # Add to outbound queue
        self.outbound_queue.append(message)
        self.message_store[message.message_id] = message

        # Track for acknowledgment if required
        if message.qos in [QoSLevel.AT_LEAST_ONCE, QoSLevel.EXACTLY_ONCE]:
            self.pending_ack[message.message_id] = message

        self.stats['messages_sent'] += 1
        logger.debug(f"Queued message {message.message_id} for delivery")

        return message.message_id

    def receive_message(self, message: EnhancedMessage):
        """Receive a message"""
        self.inbound_queue.append(message)
        self.stats['messages_received'] += 1

        # Send acknowledgment if required
        if message.qos in [QoSLevel.AT_LEAST_ONCE, QoSLevel.EXACTLY_ONCE]:
            self._send_acknowledgment(message)

    def acknowledge_message(self, message_id: str, agent_id: str):
        """Acknowledge message delivery"""
        if message_id in self.pending_ack:
            message = self.pending_ack[message_id]
            message.mark_acknowledged(agent_id)

            # Check if all acknowledgments received
            if message.qos == QoSLevel.EXACTLY_ONCE:
                if len(message.acknowledgments) >= len(message.recipient_ids):
                    del self.pending_ack[message_id]
                    self.stats['acknowledgments_received'] += 1
                    logger.debug(f"Message {message_id} fully acknowledged")

            elif message.qos == QoSLevel.AT_LEAST_ONCE:
                # At least one acknowledgment is enough
                if message.acknowledgments:
                    del self.pending_ack[message_id]
                    self.stats['acknowledgments_received'] += 1
                    logger.debug(f"Message {message_id} acknowledged")

    def _send_acknowledgment(self, message: EnhancedMessage):
        """Send acknowledgment for received message"""
        ack_message = EnhancedMessage(
            message_type='acknowledgment',
            sender_id=self.agent_id,
            payload={
                'original_message_id': message.message_id,
                'acknowledgment_type': 'received',
                'timestamp': datetime.now().isoformat()
            },
            recipient_ids=[message.sender_id],
            qos=QoSLevel.AT_MOST_ONCE,  # Acknowledgments don't need reliability
            correlation_id=message.message_id
        )

        self.outbound_queue.append(ack_message)

    def _delivery_loop(self):
        """Main message delivery loop"""
        while self.is_running:
            try:
                # Process outbound messages
                while self.outbound_queue:
                    message = self.outbound_queue.popleft()

                    if message.is_expired():
                        message.status = MessageStatus.EXPIRED
                        self._handle_failed_delivery(message, "Message expired")
                        continue

                    success = self._deliver_message(message)
                    if not success and message.can_retry():
                        self.retry_queue.append(message)
                    elif not success:
                        self._handle_failed_delivery(message, "Delivery failed")

                time.sleep(0.1)  # Small delay to prevent busy waiting

            except Exception as e:
                logger.error(f"Error in delivery loop: {e}")
                time.sleep(1)

    def _deliver_message(self, message: EnhancedMessage) -> bool:
        """Deliver message to recipients"""
        try:
            if message.delivery_mode == DeliveryMode.DIRECT:
                return self._deliver_direct(message)
            elif message.delivery_mode == DeliveryMode.BROADCAST:
                return self._deliver_broadcast(message)
            elif message.delivery_mode == DeliveryMode.MULTICAST:
                return self._deliver_multicast(message)
            elif message.delivery_mode == DeliveryMode.ROUTED:
                return self._deliver_routed(message)
            else:
                logger.error(f"Unknown delivery mode: {message.delivery_mode}")
                return False

        except Exception as e:
            logger.error(f"Error delivering message {message.message_id}: {e}")
            return False

    def _deliver_direct(self, message: EnhancedMessage) -> bool:
        """Deliver message directly to recipients"""
        success = True
        for recipient_id in message.recipient_ids:
            try:
                # In a real implementation, this would send to the actual agent
                # For now, simulate delivery
                message.mark_sent(recipient_id)
                message.mark_delivered(recipient_id)

                # Notify delivery callback
                for callback in self.delivery_callbacks:
                    try:
                        callback(message.message_id, recipient_id, True)
                    except Exception as e:
                        logger.error(f"Error in delivery callback: {e}")

            except Exception as e:
                message.mark_failed(recipient_id, str(e))
                success = False
                logger.error(f"Failed to deliver message to {recipient_id}: {e}")

        return success

    def _deliver_broadcast(self, message: EnhancedMessage) -> bool:
        """Broadcast message to all known agents"""
        # This would need access to all agent IDs
        # For now, treat as direct delivery
        return self._deliver_direct(message)

    def _deliver_multicast(self, message: EnhancedMessage) -> bool:
        """Multicast message to specific group"""
        # For now, treat as direct delivery
        return self._deliver_direct(message)

    def _deliver_routed(self, message: EnhancedMessage) -> bool:
        """Deliver message using routing"""
        if not self.router:
            return self._deliver_direct(message)

        # Find routes for each recipient
        success = True
        for recipient_id in message.recipient_ids:
            route = self.router.find_route(self.agent_id, recipient_id, message)
            if route:
                # Send via route (simplified)
                message.route_path = route
                message.next_hop = route[1] if len(route) > 1 else recipient_id
                message.mark_sent(recipient_id)
                message.mark_delivered(recipient_id)
            else:
                message.mark_failed(recipient_id, "No route found")
                success = False

        return success

    def _retry_loop(self):
        """Message retry loop"""
        while self.is_running:
            try:
                current_time = time.time()

                # Process retry queue
                retry_messages = []
                while self.retry_queue:
                    message = self.retry_queue.popleft()

                    # Check if ready for retry
                    if hasattr(message, 'next_retry_time'):
                        if current_time < message.next_retry_time:
                            retry_messages.append(message)
                            continue

                    # Increment retry count
                    message.increment_retry()
                    self.stats['retries_attempted'] += 1

                    # Calculate next retry time with exponential backoff
                    delay = min(self.retry_delay * (2 ** message.retry_count), self.max_retry_delay)
                    message.next_retry_time = current_time + delay

                    # Re-queue for delivery
                    self.outbound_queue.append(message)
                    logger.debug(f"Retrying message {message.message_id} (attempt {message.retry_count})")

                # Put back messages not ready for retry
                for message in retry_messages:
                    self.retry_queue.append(message)

                time.sleep(1)

            except Exception as e:
                logger.error(f"Error in retry loop: {e}")
                time.sleep(5)

    def _cleanup_loop(self):
        """Cleanup expired messages and old data"""
        while self.is_running:
            try:
                current_time = datetime.now()

                # Clean up expired messages from stores
                expired_messages = []
                for message_id, message in self.message_store.items():
                    if message.is_expired():
                        expired_messages.append(message_id)

                for message_id in expired_messages:
                    if message_id in self.pending_ack:
                        del self.pending_ack[message_id]
                    del self.message_store[message_id]
                    logger.debug(f"Cleaned up expired message {message_id}")

                # Clean up old acknowledgments (keep last 24 hours)
                cutoff_time = current_time - timedelta(hours=24)
                # In a real implementation, we'd track acknowledgment timestamps

                time.sleep(300)  # Clean up every 5 minutes

            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")
                time.sleep(60)

    def _handle_failed_delivery(self, message: EnhancedMessage, reason: str):
        """Handle failed message delivery"""
        message.status = MessageStatus.FAILED
        self.stats['messages_failed'] += 1

        # Notify failure callbacks
        for callback in self.failure_callbacks:
            try:
                callback(message.message_id, reason)
            except Exception as e:
                logger.error(f"Error in failure callback: {e}")

        logger.warning(f"Message {message.message_id} delivery failed: {reason}")

    def process_inbound_messages(self):
        """Process received messages"""
        while self.inbound_queue:
            message = self.inbound_queue.popleft()

            # Handle acknowledgments
            if message.message_type == 'acknowledgment':
                original_message_id = message.payload.get('original_message_id')
                if original_message_id:
                    self.acknowledge_message(original_message_id, message.sender_id)
                continue

            # Route to message handlers
            handler = self.message_handlers.get(message.message_type)
            if handler:
                try:
                    asyncio.run(handler(message))
                except Exception as e:
                    logger.error(f"Error handling message {message.message_type}: {e}")
            else:
                logger.warning(f"No handler for message type: {message.message_type}")

    def register_message_handler(self, message_type: str, handler: Callable):
        """Register a message handler"""
        self.message_handlers[message_type] = handler

    def add_delivery_callback(self, callback: Callable):
        """Add delivery status callback"""
        self.delivery_callbacks.append(callback)

    def add_failure_callback(self, callback: Callable):
        """Add failure callback"""
        self.failure_callbacks.append(callback)

    def get_messenger_stats(self) -> Dict[str, Any]:
        """Get messenger statistics"""
        return {
            'agent_id': self.agent_id,
            'outbound_queue_size': len(self.outbound_queue),
            'inbound_queue_size': len(self.inbound_queue),
            'pending_ack_count': len(self.pending_ack),
            'retry_queue_size': len(self.retry_queue),
            'stored_messages': len(self.message_store),
            'stats': self.stats.copy()
        }

# Global messenger instances
_messengers: Dict[str, ReliableMessenger] = {}

def get_reliable_messenger(agent_id: str) -> ReliableMessenger:
    """Get or create a reliable messenger for an agent"""
    if agent_id not in _messengers:
        _messengers[agent_id] = ReliableMessenger(agent_id)
    return _messengers[agent_id]

def get_message_router() -> MessageRouter:
    """Get the global message router"""
    # In a real implementation, this would be shared across messengers
    return MessageRouter()