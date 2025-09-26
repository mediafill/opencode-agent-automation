# OpenCode Agent Automation API Documentation

## Overview

The OpenCode Agent Automation system provides a WebSocket-based API for real-time monitoring, task management, and system control. The API enables clients to interact with the OpenCode agent dashboard server for comprehensive automation and monitoring capabilities.

## Connection

### WebSocket Connection

**URL:** `ws://localhost:8080/ws` (default port, configurable)

**Protocol:** WebSocket with JSON messages

**Connection Establishment:**
```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = function() {
    console.log('Connected to OpenCode API');
};

ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    handleMessage(data);
};
```

**Connection Response:**
```json
{
    "type": "connection_established",
    "server_version": "1.0.0",
    "timestamp": "2024-01-15T10:30:00Z"
}
```

## API Endpoints

### 1. Basic API

#### Ping/Pong Health Check

**Request:**
```json
{
    "type": "ping",
    "timestamp": 1642152600000
}
```

**Response:**
```json
{
    "type": "pong",
    "timestamp": 1642152600000,
    "server_time": "2024-01-15T10:30:00Z"
}
```

#### Request Full Status

**Request:**
```json
{
    "type": "request_status"
}
```

**Response:**
```json
{
    "type": "full_status",
    "data": {
        "agents": [
            {
                "id": "agent_123",
                "status": "running",
                "type": "opencode",
                "task": "Processing documentation",
                "progress": 65,
                "start_time": "2024-01-15T10:00:00Z",
                "memory_usage": 125829120,
                "cpu_percent": 12.5,
                "working_dir": "/path/to/project",
                "is_claude_desktop": false,
                "process_type": "opencode"
            }
        ],
        "tasks": [
            {
                "id": "task_456",
                "type": "documentation",
                "priority": "high",
                "description": "Generate API documentation",
                "status": "running",
                "progress": 65,
                "created_at": "2024-01-15T09:30:00Z"
            }
        ],
        "system_resources": {
            "cpu_usage": 45.2,
            "memory_usage": 67.8,
            "memory_used": 6871947673,
            "memory_total": 17179869184,
            "disk_usage": 23.4,
            "disk_used": 250000000000,
            "disk_total": 1000000000000,
            "active_processes": 5,
            "claude_processes": 2,
            "timestamp": "2024-01-15T10:30:00Z"
        },
        "claude_processes": [
            {
                "pid": 12345,
                "type": "opencode",
                "status": "running",
                "cmdline": "python opencode run --task task_456",
                "name": "python",
                "start_time": "2024-01-15T10:00:00Z",
                "memory_usage": 125829120,
                "memory_percent": 0.73,
                "cpu_percent": 12.5,
                "task_id": "task_456",
                "working_dir": "/path/to/project",
                "is_opencode": true,
                "is_claude_desktop": false,
                "activity": "executing_task",
                "discovered_at": "2024-01-15T10:00:00Z"
            }
        ]
    }
}
```

### 2. Task Management API

#### Start Task

**Request:**
```json
{
    "type": "start_task",
    "task": {
        "id": "new_task_123",
        "type": "testing",
        "priority": "high",
        "description": "Run integration tests",
        "files_pattern": "**/*.test.js",
        "dependencies": ["task_456"],
        "timeout": 3600000
    }
}
```

**Response (Success):**
```json
{
    "type": "task_started",
    "task_id": "new_task_123",
    "task": {
        "id": "new_task_123",
        "type": "testing",
        "priority": "high",
        "description": "Run integration tests",
        "status": "pending",
        "progress": 0,
        "created_at": "2024-01-15T10:30:00Z"
    }
}
```

**Response (Error):**
```json
{
    "type": "error",
    "code": "INVALID_TASK_DATA",
    "message": "Task data is missing required fields: id, type, description"
}
```

#### Cancel Task

**Request:**
```json
{
    "type": "cancel_task",
    "task_id": "task_456"
}
```

**Response:**
```json
{
    "type": "task_cancelled",
    "task_id": "task_456",
    "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Retry Task

**Request:**
```json
{
    "type": "retry_task",
    "task_id": "failed_task_789"
}
```

**Response:**
```json
{
    "type": "task_retried",
    "task_id": "failed_task_789",
    "retry_count": 1,
    "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Get Task Status

**Request:**
```json
{
    "type": "get_task_status",
    "task_id": "task_456"
}
```

**Response:**
```json
{
    "type": "task_status",
    "task": {
        "id": "task_456",
        "type": "documentation",
        "priority": "high",
        "description": "Generate API documentation",
        "status": "running",
        "progress": 65,
        "created_at": "2024-01-15T09:30:00Z",
        "started_at": "2024-01-15T09:35:00Z",
        "runtime_status": "running",
        "dependencies": [],
        "files_pattern": "**/*.md"
    }
}
```

#### List Tasks

**Request:**
```json
{
    "type": "list_tasks",
    "filter": {
        "status": "running",
        "type": "testing",
        "priority": "high"
    },
    "limit": 50,
    "offset": 0
}
```

**Response:**
```json
{
    "type": "task_list",
    "tasks": [
        {
            "id": "task_456",
            "type": "testing",
            "priority": "high",
            "description": "Run unit tests",
            "status": "running",
            "progress": 45,
            "created_at": "2024-01-15T09:30:00Z"
        }
    ],
    "total_count": 1,
    "filtered_count": 1
}
```

### 3. System Monitoring API

#### Request System Resources

**Request:**
```json
{
    "type": "request_system_resources"
}
```

**Response:**
```json
{
    "type": "system_resources",
    "data": {
        "cpu_usage": 45.2,
        "memory_usage": 67.8,
        "memory_used": 6871947673,
        "memory_total": 17179869184,
        "disk_usage": 23.4,
        "disk_used": 250000000000,
        "disk_total": 1000000000000,
        "network_stats": {
            "bytes_sent": 1024000,
            "bytes_recv": 2048000,
            "packets_sent": 1500,
            "packets_recv": 2200
        },
        "active_processes": 5,
        "claude_processes": 2,
        "timestamp": "2024-01-15T10:30:00Z"
    }
}
```

#### Request Process List

**Request:**
```json
{
    "type": "request_process_list",
    "filter": {
        "type": "opencode",
        "status": "running"
    },
    "limit": 100
}
```

**Response:**
```json
{
    "type": "process_list",
    "data": {
        "processes": [
            {
                "pid": 12345,
                "name": "python",
                "cmdline": "python opencode run --task task_456",
                "status": "running",
                "cpu_percent": 12.5,
                "memory_percent": 0.73,
                "memory_rss": 125829120,
                "create_time": 1642152000.0,
                "type": "opencode",
                "task_id": "task_456"
            }
        ],
        "total_count": 1,
        "system_load": {
            "load1": 1.25,
            "load5": 1.45,
            "load15": 1.32
        },
        "timestamp": "2024-01-15T10:30:00Z"
    }
}
```

#### Request Log Entries

**Request:**
```json
{
    "type": "request_log_entries",
    "limit": 50,
    "filter": {
        "level": "error",
        "agent": "task_456",
        "time_range": {
            "start": "2024-01-15T09:00:00Z",
            "end": "2024-01-15T11:00:00Z"
        }
    }
}
```

**Response:**
```json
{
    "type": "log_entries",
    "data": {
        "entries": [
            {
                "time": "2024-01-15T10:25:00Z",
                "level": "error",
                "message": "Failed to parse configuration file",
                "agent": "task_456",
                "details": {
                    "error_code": "CONFIG_PARSE_ERROR",
                    "file_path": "/path/to/config.json"
                }
            }
        ],
        "total_count": 1,
        "filtered_count": 1,
        "timestamp": "2024-01-15T10:30:00Z"
    }
}
```

#### Request Performance Metrics

**Request:**
```json
{
    "type": "request_performance_metrics",
    "time_range": "1h"
}
```

**Response:**
```json
{
    "type": "performance_metrics",
    "data": {
        "response_times": {
            "average": 45.2,
            "min": 12.5,
            "max": 234.8,
            "p95": 89.3,
            "p99": 156.7
        },
        "throughput": {
            "requests_per_second": 23.4,
            "bytes_per_second": 125000
        },
        "error_rates": {
            "total_errors": 5,
            "error_rate_percent": 0.8,
            "errors_by_type": {
                "timeout": 3,
                "parse_error": 2
            }
        },
        "resource_usage": {
            "cpu_trend": [45.2, 47.8, 43.1, 48.9],
            "memory_trend": [67.8, 69.2, 65.4, 71.1],
            "timestamps": ["10:00", "10:05", "10:10", "10:15"]
        },
        "timestamp": "2024-01-15T10:30:00Z"
    }
}
```

### 4. Process Management API

#### Kill Process

**Request:**
```json
{
    "type": "kill_process",
    "pid": 12345,
    "signal": "SIGTERM"
}
```

**Response (Success):**
```json
{
    "type": "process_killed",
    "data": {
        "pid": 12345,
        "signal": "SIGTERM",
        "success": true,
        "termination_time": "2024-01-15T10:30:05Z"
    }
}
```

**Response (Error):**
```json
{
    "type": "error",
    "code": "PROCESS_KILL_FAILED",
    "message": "Failed to kill process 12345: Permission denied"
}
```

#### Request Claude Processes

**Request:**
```json
{
    "type": "request_claude_processes"
}
```

**Response:**
```json
{
    "type": "claude_processes",
    "processes": [
        {
            "pid": 12345,
            "type": "opencode",
            "status": "running",
            "cmdline": "python opencode run --task task_456",
            "name": "python",
            "start_time": "2024-01-15T10:00:00Z",
            "memory_usage": 125829120,
            "memory_percent": 0.73,
            "cpu_percent": 12.5,
            "task_id": "task_456",
            "working_dir": "/path/to/project",
            "is_opencode": true,
            "is_claude_desktop": false,
            "activity": "executing_task",
            "discovered_at": "2024-01-15T10:00:00Z"
        }
    ],
    "timestamp": "2024-01-15T10:30:00Z"
}
```

### 5. Real-time Subscription API

#### Subscribe to Updates

**Request:**
```json
{
    "type": "subscribe_to_updates",
    "channels": ["system_resources", "task_status", "log_entries"],
    "filters": {
        "task_status": {
            "task_ids": ["task_456", "task_789"]
        },
        "log_entries": {
            "levels": ["error", "warn"]
        }
    }
}
```

**Response:**
```json
{
    "type": "subscription_confirmed",
    "channels": ["system_resources", "task_status", "log_entries"],
    "subscription_id": "sub_123456",
    "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Unsubscribe from Updates

**Request:**
```json
{
    "type": "unsubscribe_from_updates",
    "channels": ["system_resources"],
    "subscription_id": "sub_123456"
}
```

**Response:**
```json
{
    "type": "unsubscription_confirmed",
    "channels": ["system_resources"],
    "subscription_id": "sub_123456",
    "timestamp": "2024-01-15T10:30:00Z"
}
```

### 6. Real-time Update Messages

#### System Resources Update

```json
{
    "type": "resource_update",
    "resources": {
        "cpu_usage": 45.2,
        "memory_usage": 67.8,
        "memory_used": 6871947673,
        "memory_total": 17179869184,
        "disk_usage": 23.4,
        "disk_used": 250000000000,
        "disk_total": 1000000000000,
        "active_processes": 5,
        "claude_processes": 2,
        "timestamp": "2024-01-15T10:30:00Z"
    }
}
```

#### Task Status Update

```json
{
    "type": "task_status_update",
    "task_id": "task_456",
    "old_status": "running",
    "new_status": "completed",
    "progress": 100,
    "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Agent Update

```json
{
    "type": "agent_update",
    "agent": {
        "id": "agent_123",
        "status": "running",
        "type": "opencode",
        "task": "Processing documentation",
        "progress": 75,
        "memory_usage": 150000000,
        "cpu_percent": 15.2,
        "timestamp": "2024-01-15T10:30:00Z"
    }
}
```

#### Log Entry

```json
{
    "type": "log_entry",
    "log": {
        "time": "2024-01-15T10:29:45Z",
        "level": "info",
        "message": "Task completed successfully",
        "agent": "task_456",
        "details": {
            "execution_time": 125000,
            "files_processed": 15
        }
    }
}
```

## Error Codes and Handling

### Standard Error Response Format

```json
{
    "type": "error",
    "code": "ERROR_CODE",
    "message": "Human-readable error description",
    "details": {
        "field": "specific_field_name",
        "value": "invalid_value",
        "expected": "expected_format"
    },
    "timestamp": "2024-01-15T10:30:00Z"
}
```

### Error Codes

| Code | Description | HTTP Equivalent |
|------|-------------|-----------------|
| `INVALID_JSON` | Malformed JSON in request | 400 Bad Request |
| `UNKNOWN_MESSAGE_TYPE` | Unknown message type | 400 Bad Request |
| `MISSING_REQUIRED_FIELD` | Required field missing | 400 Bad Request |
| `INVALID_FIELD_VALUE` | Invalid field value | 400 Bad Request |
| `TASK_NOT_FOUND` | Task ID not found | 404 Not Found |
| `PROCESS_NOT_FOUND` | Process ID not found | 404 Not Found |
| `TASK_ALREADY_EXISTS` | Task ID already exists | 409 Conflict |
| `PROCESS_KILL_FAILED` | Failed to kill process | 500 Internal Server Error |
| `DATABASE_ERROR` | Database operation failed | 500 Internal Server Error |
| `FILESYSTEM_ERROR` | File system operation failed | 500 Internal Server Error |
| `PERMISSION_DENIED` | Insufficient permissions | 403 Forbidden |
| `RATE_LIMIT_EXCEEDED` | Too many requests | 429 Too Many Requests |
| `SERVER_OVERLOAD` | Server temporarily overloaded | 503 Service Unavailable |
| `CONNECTION_LOST` | WebSocket connection lost | N/A |
| `HEARTBEAT_TIMEOUT` | Heartbeat response timeout | N/A |

### Error Handling Examples

#### Invalid Task Data
```json
{
    "type": "error",
    "code": "INVALID_FIELD_VALUE",
    "message": "Invalid priority value: 'urgent'. Valid values are: low, medium, high",
    "details": {
        "field": "priority",
        "value": "urgent",
        "expected": ["low", "medium", "high"]
    }
}
```

#### Task Not Found
```json
{
    "type": "error",
    "code": "TASK_NOT_FOUND",
    "message": "Task with ID 'nonexistent_task' not found",
    "details": {
        "task_id": "nonexistent_task"
    }
}
```

#### Rate Limiting
```json
{
    "type": "error",
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please wait before retrying.",
    "details": {
        "retry_after_seconds": 30,
        "current_limit": 100,
        "time_window_seconds": 60
    }
}
```

## Data Types and Validation

### Task Object

```typescript
interface Task {
    id: string;                    // Required: Unique task identifier
    type: TaskType;               // Required: Task type (testing, documentation, etc.)
    priority: Priority;           // Required: Priority level (low, medium, high)
    description: string;          // Required: Human-readable description
    status?: TaskStatus;          // Optional: Current status (auto-managed)
    progress?: number;            // Optional: Progress percentage (0-100)
    files_pattern?: string;       // Optional: File pattern for processing
    dependencies?: string[];      // Optional: Array of dependent task IDs
    timeout?: number;             // Optional: Timeout in milliseconds
    created_at?: string;          // Optional: ISO 8601 timestamp
    started_at?: string;          // Optional: ISO 8601 timestamp
    completed_at?: string;        // Optional: ISO 8601 timestamp
    error?: string;               // Optional: Error message if failed
}
```

### Process Object

```typescript
interface Process {
    pid: number;                  // Process ID
    name: string;                 // Process name
    cmdline: string;              // Full command line
    status: ProcessStatus;        // Process status
    cpu_percent: number;          // CPU usage percentage
    memory_percent: number;       // Memory usage percentage
    memory_rss: number;           // Resident Set Size in bytes
    create_time: number;          // Creation timestamp
    type?: ProcessType;           // Claude/OpenCode process type
    task_id?: string;             // Associated task ID
    working_dir?: string;         // Working directory
}
```

### System Resources Object

```typescript
interface SystemResources {
    cpu_usage: number;            // CPU usage percentage
    memory_usage: number;         // Memory usage percentage
    memory_used: number;          // Memory used in bytes
    memory_total: number;         // Total memory in bytes
    disk_usage: number;           // Disk usage percentage
    disk_used: number;            // Disk used in bytes
    disk_total: number;           // Total disk space in bytes
    active_processes: number;     // Total active processes
    claude_processes: number;     // Claude/OpenCode processes
    timestamp: string;            // ISO 8601 timestamp
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Connection Limit:** Maximum 100 concurrent WebSocket connections
- **Message Rate:** Maximum 100 messages per minute per connection
- **Task Creation:** Maximum 10 new tasks per minute
- **Process Operations:** Maximum 5 process kill operations per minute

Rate limit violations return a `RATE_LIMIT_EXCEEDED` error with retry information.

## Authentication and Security

Currently, the API does not implement authentication. All connections are assumed to be from trusted clients. Future versions may include:

- API key authentication
- JWT token validation
- IP whitelisting
- SSL/TLS encryption

## Best Practices

### Connection Management

1. **Implement reconnection logic** with exponential backoff
2. **Monitor connection health** using ping/pong
3. **Handle connection drops gracefully**
4. **Limit concurrent connections** per client

### Error Handling

1. **Always check response types** before processing
2. **Implement retry logic** for transient errors
3. **Log errors appropriately** for debugging
4. **Provide user feedback** for error conditions

### Performance Optimization

1. **Use subscriptions** for real-time updates instead of polling
2. **Batch requests** when possible
3. **Implement caching** for frequently accessed data
4. **Monitor API usage** and optimize bottlenecks

### Task Management

1. **Validate task data** before submission
2. **Monitor task progress** using subscriptions
3. **Handle task dependencies** appropriately
4. **Implement proper cleanup** for failed tasks

## Version History

- **v1.0.0**: Initial API release with core WebSocket functionality
- **v1.1.0**: Added real-time subscriptions and enhanced monitoring
- **v1.2.0**: Improved error handling and rate limiting
- **v1.3.0**: Added process management and advanced filtering

## Support

For API support and questions:

- **Documentation:** This document
- **Issues:** Report bugs at https://github.com/mediafill/opencode-agent-automation/issues
- **Discussions:** Use GitHub Discussions for questions

---

*Last updated: January 15, 2024*