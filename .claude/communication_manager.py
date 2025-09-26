#!/usr/bin/env python3
"""
Communication Manager - Integrates vector database for robust inter-agent communication

This module provides a unified communication layer that leverages the vector database
for reliable message queuing, persistence, and cross-agent coordination.
"""

import asyncio
import json
import time
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Set, Callable, Union
from enum import Enum
from dataclasses import dataclass, field

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
    logger.warning("Vector database not available")

try:
    from master_agent_orchestrator import (
        AgentMessage, MessageType, AgentRole, AgentStatus,
        MasterAgentOrchestrator, get_orchestrator
    )
    ORCHESTRATOR_AVAILABLE = True
except ImportError:
    ORCHESTRATOR_AVAILABLE = False
    logger.warning("Master orchestrator not available")

class CommunicationChannel(Enum):
    """Communication channels"""
    VECTOR_DB = "vector_db"
    DIRECT = "direct"
    HYBRID = "hybrid"

class MessagePriority(Enum):
    """Message priority levels"""
    LOW = 0
    NORMAL = 1
    HIGH = 2
    CRITICAL = 3

class DeliveryStatus(Enum):
    """Message delivery status"""
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    EXPIRED = "expired"

@dataclass
class EnhancedMessage:
    """Enhanced message with delivery tracking and metadata"""
    message: AgentMessage
    priority: MessagePriority = MessagePriority.NORMAL
    delivery_channel: CommunicationChannel = CommunicationChannel.VECTOR_DB
    delivery_status: DeliveryStatus = DeliveryStatus.PENDING
    retry_count: int = 0
    max_retries: int = 3
    created_at: datetime = field(default_factory=datetime.now)
    sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    delivery_receipt: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

class MessageQueue:
    """Priority message queue with persistence"""

    def __init__(self, agent_id: str, vector_db: Optional[VectorDatabase] = None):
        self.agent_id = agent_id
        self.vector_db = vector_db
        self.queues: Dict[MessagePriority, List[EnhancedMessage]] = {
            priority: [] for priority in MessagePriority
        }
        self.pending_deliveries: Dict[str, EnhancedMessage] = {}
        self.delivery_callbacks: List[Callable] = []

    def enqueue(self, message: EnhancedMessage) -> str:
        """Enqueue a message for delivery"""
        # Set expiration if not set
        if not message.expires_at:
            message.expires_at = datetime.now() + timedelta(hours=1)  # Default 1 hour

        # Add to appropriate priority queue
        self.queues[message.priority].append(message)

        # Persist if vector DB available
        if self.vector_db:
            asyncio.create_task(self._persist_message(message))

        logger.debug(f"Enqueued message {message.message.message_id} with priority {message.priority.name}")
        return message.message.message_id

    async def _persist_message(self, message: EnhancedMessage):
        """Persist message to vector database"""
        if not self.vector_db:
            return

        try:
            document_text = f"Message {message.message.message_type.value} from {message.message.sender_id}"
            metadata = {
                'message_id': message.message.message_id,
                'priority': message.priority.value,
                'status': message.delivery_status.value,
                'sender': message.message.sender_id,
                'recipient': message.message.recipient_id,
                'type': message.message.message_type.value,
                'created_at': message.created_at.isoformat(),
                'expires_at': message.expires_at.isoformat() if message.expires_at else None,
                'payload': json.dumps(message.message.to_dict()),
                'metadata': json.dumps(message.metadata)
            }

            await self.vector_db.store_task_history({
                'taskId': f"msg_{message.message.message_id}",
                'type': 'message',
                'description': document_text,
                'status': 'queued',
                'startTime': message.created_at.isoformat(),
                'data': message.message.to_dict()
            })

        except Exception as e:
            logger.error(f"Failed to persist message {message.message.message_id}: {e}")

    def dequeue(self) -> Optional[EnhancedMessage]:
        """Dequeue next message by priority"""
        for priority in reversed(list(MessagePriority)):  # Highest priority first
            if self.queues[priority]:
                message = self.queues[priority].pop(0)

                # Check expiration
                if message.expires_at and datetime.now() > message.expires_at:
                    message.delivery_status = DeliveryStatus.EXPIRED
                    continue

                return message
        return None

    def get_pending_count(self) -> int:
        """Get total pending messages count"""
        return sum(len(queue) for queue in self.queues.values())

    def cleanup_expired(self):
        """Clean up expired messages"""
        current_time = datetime.now()
        for priority_queue in self.queues.values():
            # Remove expired messages
            priority_queue[:] = [
                msg for msg in priority_queue
                if not msg.expires_at or current_time <= msg.expires_at
            ]

class CommunicationManager:
    """
    Unified communication manager for inter-agent messaging
    """

    def __init__(self, agent_id: str, orchestrator: Optional[MasterAgentOrchestrator] = None):
        self.agent_id = agent_id
        self.orchestrator = orchestrator or (get_orchestrator() if ORCHESTRATOR_AVAILABLE else None)

        # Communication components
        self.vector_db: Optional[VectorDatabase] = None
        self.message_queue = MessageQueue(agent_id)
        self.subscriptions: Dict[str, Set[str]] = {}  # topic -> set of subscriber agent_ids
        self.topic_handlers: Dict[str, Callable] = {}

        # Delivery tracking
        self.sent_messages: Dict[str, EnhancedMessage] = {}
        self.delivery_confirmations: Dict[str, threading.Event] = {}

        # Threading
        self.is_running = False
        self.sender_thread: Optional[threading.Thread] = None
        self.receiver_thread: Optional[threading.Thread] = None
        self.cleanup_thread: Optional[threading.Thread] = None

        # Configuration
        self.delivery_timeout = 30  # seconds
        self.retry_delay = 5  # seconds
        self.max_batch_size = 10

        # Callbacks
        self.message_callbacks: List[Callable] = []
        self.delivery_callbacks: List[Callable] = []

        # Initialize vector database
        self._initialize_vector_db()

    def _initialize_vector_db(self):
        """Initialize vector database for communication"""
        if VECTOR_DB_AVAILABLE and VectorDatabase is not None:
            try:
                config = {
                    'projectDir': '.',  # Would get from orchestrator
                    'collectionName': f'agent_communication_{self.agent_id}',
                    'maxRetries': 3,
                    'retryDelay': 1000
                }
                self.vector_db = VectorDatabase(config)
                self.message_queue.vector_db = self.vector_db
                logger.info("Vector database initialized for communication")
            except Exception as e:
                logger.warning(f"Failed to initialize vector database: {e}")

    def start(self):
        """Start the communication manager"""
        if self.is_running:
            return

        logger.info(f"Starting communication manager for agent {self.agent_id}")
        self.is_running = True

        # Start communication threads
        self.sender_thread = threading.Thread(target=self._sender_loop, daemon=True)
        self.sender_thread.start()

        self.receiver_thread = threading.Thread(target=self._receiver_loop, daemon=True)
        self.receiver_thread.start()

        self.cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self.cleanup_thread.start()

    def stop(self):
        """Stop the communication manager"""
        if not self.is_running:
            return

        logger.info(f"Stopping communication manager for agent {self.agent_id}")
        self.is_running = False

        # Wait for threads
        threads = [self.sender_thread, self.receiver_thread, self.cleanup_thread]
        for thread in threads:
            if thread and thread.is_alive():
                thread.join(timeout=10)

    def send_message(self, recipient_id: str, message_type: MessageType,
                    payload: Dict[str, Any], priority: MessagePriority = MessagePriority.NORMAL,
                    delivery_receipt: bool = False, expires_in: Optional[int] = None) -> str:
        """Send a message to another agent"""
        message = AgentMessage(
            message_type=message_type,
            sender_id=self.agent_id,
            recipient_id=recipient_id,
            payload=payload
        )

        enhanced_message = EnhancedMessage(
            message=message,
            priority=priority,
            delivery_receipt=delivery_receipt
        )

        if expires_in:
            enhanced_message.expires_at = datetime.now() + timedelta(seconds=expires_in)

        # Enqueue for sending
        message_id = self.message_queue.enqueue(enhanced_message)
        self.sent_messages[message_id] = enhanced_message

        # Set up delivery confirmation if requested
        if delivery_receipt:
            self.delivery_confirmations[message_id] = threading.Event()

        return message_id

    def broadcast_message(self, message_type: MessageType, payload: Dict[str, Any],
                         target_role: Optional[AgentRole] = None,
                         priority: MessagePriority = MessagePriority.NORMAL) -> List[str]:
        """Broadcast message to multiple agents"""
        if not self.orchestrator:
            return []

        recipients = []
        if target_role:
            # Get agents by role
            agents = self.orchestrator.get_agents_by_role(target_role)
            recipients = [agent.agent_id for agent in agents]
        else:
            # Broadcast to all agents
            recipients = list(self.orchestrator.slave_agents.keys())

        message_ids = []
        for recipient_id in recipients:
            if recipient_id != self.agent_id:  # Don't send to self
                message_id = self.send_message(
                    recipient_id=recipient_id,
                    message_type=message_type,
                    payload=payload,
                    priority=priority
                )
                message_ids.append(message_id)

        logger.info(f"Broadcasted message to {len(message_ids)} agents")
        return message_ids

    def publish_to_topic(self, topic: str, message_type: MessageType,
                        payload: Dict[str, Any], priority: MessagePriority = MessagePriority.NORMAL) -> int:
        """Publish message to a topic"""
        if topic not in self.subscriptions:
            self.subscriptions[topic] = set()

        subscribers = self.subscriptions[topic]
        if not subscribers:
            return 0

        sent_count = 0
        for subscriber_id in subscribers:
            try:
                self.send_message(
                    recipient_id=subscriber_id,
                    message_type=message_type,
                    payload={**payload, 'topic': topic},
                    priority=priority
                )
                sent_count += 1
            except Exception as e:
                logger.error(f"Failed to send to subscriber {subscriber_id}: {e}")

        return sent_count

    def subscribe_to_topic(self, topic: str, handler: Optional[Callable] = None):
        """Subscribe to a topic"""
        if topic not in self.subscriptions:
            self.subscriptions[topic] = set()

        self.subscriptions[topic].add(self.agent_id)

        if handler:
            self.topic_handlers[topic] = handler

        logger.info(f"Subscribed to topic: {topic}")

    def unsubscribe_from_topic(self, topic: str):
        """Unsubscribe from a topic"""
        if topic in self.subscriptions:
            self.subscriptions[topic].discard(self.agent_id)
            if not self.subscriptions[topic]:
                del self.subscriptions[topic]

        if topic in self.topic_handlers:
            del self.topic_handlers[topic]

        logger.info(f"Unsubscribed from topic: {topic}")

    def wait_for_delivery(self, message_id: str, timeout: Optional[int] = None) -> bool:
        """Wait for delivery confirmation"""
        if message_id not in self.delivery_confirmations:
            return False

        timeout = timeout or self.delivery_timeout
        return self.delivery_confirmations[message_id].wait(timeout)

    def _sender_loop(self):
        """Main message sending loop"""
        while self.is_running:
            try:
                # Send batched messages
                messages_to_send = []
                for _ in range(self.max_batch_size):
                    message = self.message_queue.dequeue()
                    if message:
                        messages_to_send.append(message)
                    else:
                        break

                if messages_to_send:
                    asyncio.run(self._send_batch(messages_to_send))

                time.sleep(1)  # Send every second

            except Exception as e:
                logger.error(f"Error in sender loop: {e}")
                time.sleep(5)

    async def _send_batch(self, messages: List[EnhancedMessage]):
        """Send a batch of messages"""
        for message in messages:
            try:
                await self._send_single_message(message)
            except Exception as e:
                logger.error(f"Failed to send message {message.message.message_id}: {e}")
                message.retry_count += 1
                if message.retry_count < message.max_retries:
                    # Re-enqueue for retry
                    self.message_queue.enqueue(message)
                else:
                    message.delivery_status = DeliveryStatus.FAILED

    async def _send_single_message(self, message: EnhancedMessage):
        """Send a single message via appropriate channel"""
        message.sent_at = datetime.now()
        message.delivery_status = DeliveryStatus.SENT

        if message.delivery_channel == CommunicationChannel.VECTOR_DB and self.vector_db:
            # Send via vector database
            await self._send_via_vector_db(message)
        else:
            # Send via direct communication (fallback)
            self._send_via_direct(message)

    async def _send_via_vector_db(self, message: EnhancedMessage):
        """Send message via vector database"""
        if not self.vector_db:
            raise Exception("Vector database not available")

        try:
            document_text = f"Message delivery: {message.message.message_type.value}"
            metadata = {
                'message_id': message.message.message_id,
                'sender_id': message.message.sender_id,
                'recipient_id': message.message.recipient_id,
                'message_type': message.message.message_type.value,
                'priority': message.priority.value,
                'sent_at': message.sent_at.isoformat(),
                'expires_at': message.expires_at.isoformat() if message.expires_at else None,
                'payload': json.dumps(message.message.payload),
                'delivery_receipt': message.delivery_receipt
            }

            await self.vector_db.store_task_history({
                'taskId': f"delivery_{message.message.message_id}",
                'type': 'message_delivery',
                'description': document_text,
                'status': 'sent',
                'startTime': message.sent_at.isoformat(),
                'data': message.message.to_dict()
            })

        except Exception as e:
            logger.error(f"Failed to send via vector DB: {e}")
            raise

    def _send_via_direct(self, message: EnhancedMessage):
        """Send message via direct communication"""
        # This would implement direct agent-to-agent communication
        # For now, just mark as sent
        logger.debug(f"Sent message {message.message.message_id} via direct communication")

    def _receiver_loop(self):
        """Main message receiving loop"""
        while self.is_running:
            try:
                if self.vector_db:
                    asyncio.run(self._check_for_messages())

                time.sleep(2)  # Check every 2 seconds

            except Exception as e:
                logger.error(f"Error in receiver loop: {e}")
                time.sleep(5)

    async def _check_for_messages(self):
        """Check for new messages in vector database"""
        if not self.vector_db:
            return

        try:
            # Query for messages addressed to this agent
            messages = await self.vector_db.query_similar_solutions(
                f"recipient_id:{self.agent_id}",
                limit=20
            )

            for msg_data in messages:
                try:
                    message_data = json.loads(msg_data['metadata']['payload'])
                    message = AgentMessage.from_dict(message_data)

                    # Check if we've already processed this message
                    if message.message_id in self.sent_messages:
                        continue

                    # Process the message
                    await self._process_received_message(message)

                except Exception as e:
                    logger.error(f"Error processing received message: {e}")

        except Exception as e:
            logger.error(f"Error checking for messages: {e}")

    async def _process_received_message(self, message: AgentMessage):
        """Process a received message"""
        # Check if it's a topic message
        topic = message.payload.get('topic')
        if topic and topic in self.topic_handlers:
            # Handle via topic handler
            handler = self.topic_handlers[topic]
            try:
                handler(message)
            except Exception as e:
                logger.error(f"Error in topic handler for {topic}: {e}")
        else:
            # Handle via general message callbacks
            for callback in self.message_callbacks:
                try:
                    callback(message)
                except Exception as e:
                    logger.error(f"Error in message callback: {e}")

        # Send delivery receipt if requested
        if message.payload.get('delivery_receipt'):
            await self._send_delivery_receipt(message)

    async def _send_delivery_receipt(self, original_message: AgentMessage):
        """Send delivery receipt for a message"""
        receipt_payload = {
            'original_message_id': original_message.message_id,
            'delivered_at': datetime.now().isoformat(),
            'recipient_id': self.agent_id
        }

        receipt_message = AgentMessage(
            message_type=MessageType.COORDINATION_SIGNAL,
            sender_id=self.agent_id,
            recipient_id=original_message.sender_id,
            payload=receipt_payload
        )

        enhanced_receipt = EnhancedMessage(
            message=receipt_message,
            priority=MessagePriority.HIGH,
            delivery_receipt=False  # Don't request receipt for receipts
        )

        self.message_queue.enqueue(enhanced_receipt)

    def _cleanup_loop(self):
        """Main cleanup loop"""
        while self.is_running:
            try:
                # Clean up expired messages
                self.message_queue.cleanup_expired()

                # Clean up old delivery confirmations
                current_time = datetime.now()
                expired_confirmations = [
                    msg_id for msg_id, event in self.delivery_confirmations.items()
                    if current_time > self.sent_messages.get(msg_id, EnhancedMessage(AgentMessage(
                        MessageType.TASK_ASSIGNMENT, '', '', {}
                    ))).created_at + timedelta(minutes=5)
                ]

                for msg_id in expired_confirmations:
                    del self.delivery_confirmations[msg_id]

                time.sleep(60)  # Cleanup every minute

            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")
                time.sleep(30)

    def add_message_callback(self, callback: Callable):
        """Add message received callback"""
        self.message_callbacks.append(callback)

    def add_delivery_callback(self, callback: Callable):
        """Add delivery status callback"""
        self.delivery_callbacks.append(callback)

    def get_communication_status(self) -> Dict[str, Any]:
        """Get communication status"""
        return {
            'agent_id': self.agent_id,
            'vector_db_available': self.vector_db is not None,
            'pending_messages': self.message_queue.get_pending_count(),
            'active_subscriptions': len(self.subscriptions),
            'sent_messages': len(self.sent_messages),
            'pending_deliveries': len(self.delivery_confirmations),
            'communication_active': self.is_running
        }

# Global communication manager instances
_communication_managers: Dict[str, CommunicationManager] = {}

def get_communication_manager(agent_id: str, orchestrator: Optional[MasterAgentOrchestrator] = None) -> CommunicationManager:
    """Get or create a communication manager for an agent"""
    if agent_id not in _communication_managers:
        _communication_managers[agent_id] = CommunicationManager(agent_id, orchestrator)
    return _communication_managers[agent_id]

if __name__ == '__main__':
    # Test the communication manager
    manager = CommunicationManager("test_agent")

    try:
        manager.start()
        logger.info("Communication manager started. Press Ctrl+C to stop.")

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        logger.info("Stopping communication manager...")
