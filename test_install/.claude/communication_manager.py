"""
Simple Communication System
Handles agent communication
"""

import json
import time
from typing import Dict, Any, List
from pathlib import Path

class CommunicationManager:
    """Simple communication manager"""

    def __init__(self, agent_dir: Path):
        self.agent_dir = agent_dir
        self.messages_file = agent_dir / "messages.json"
        self.messages = self._load_messages()

    def _load_messages(self) -> List[Dict[str, Any]]:
        """Load messages"""
        if self.messages_file.exists():
            try:
                with open(self.messages_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        return []

    def _save_messages(self):
        """Save messages"""
        with open(self.messages_file, 'w') as f:
            json.dump(self.messages, f, indent=2)

    def send_message(self, from_agent: str, to_agent: str, message_type: str, payload: Dict[str, Any]):
        """Send message between agents"""
        message = {
            "id": f"{int(time.time())}_{from_agent}_{to_agent}",
            "from": from_agent,
            "to": to_agent,
            "type": message_type,
            "payload": payload,
            "timestamp": time.time(),
            "status": "sent"
        }

        self.messages.append(message)
        self._save_messages()
        return message["id"]

    def get_messages(self, agent_id: str) -> List[Dict[str, Any]]:
        """Get messages for an agent"""
        return [m for m in self.messages if m["to"] == agent_id and m["status"] == "sent"]

    def mark_message_read(self, message_id: str):
        """Mark message as read"""
        for message in self.messages:
            if message["id"] == message_id:
                message["status"] = "read"
                self._save_messages()
                break

    def broadcast(self, from_agent: str, message_type: str, payload: Dict[str, Any]):
        """Broadcast message to all agents"""
        # In simple version, just log the broadcast
        message = {
            "id": f"broadcast_{int(time.time())}_{from_agent}",
            "from": from_agent,
            "type": f"broadcast_{message_type}",
            "payload": payload,
            "timestamp": time.time(),
            "status": "broadcast"
        }

        self.messages.append(message)
        self._save_messages()
        return message["id"]