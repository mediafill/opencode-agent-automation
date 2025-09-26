# OpenCode Agent Automation API Documentation

## Overview

The OpenCode Agent Automation system provides a WebSocket-based API for real-time monitoring, task management, and system control. The API enables clients to interact with the OpenCode agent dashboard server for comprehensive automation and monitoring capabilities.

## Connection

### WebSocket Connection

**URL:** `ws://localhost:8080/ws` (default port, configurable)

**Protocol:** WebSocket with JSON messages

**Connection Establishment:**

```javascript
const ws = new WebSocket("ws://localhost:8080/ws");

ws.onopen = function () {
  console.log("Connected to OpenCode API");
};

ws.onmessage = function (event) {
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

**Request (Simple):**

```json
{
  "type": "list_tasks"
}
```

**Request (Advanced Filtering):**

```json
{
  "type": "list_tasks",
  "filter": {
    "status": ["running", "pending"],
    "type": ["testing", "documentation"],
    "priority": "high",
    "created_after": "2024-01-15T00:00:00Z",
    "created_before": "2024-01-16T00:00:00Z",
    "has_dependencies": false,
    "progress_range": {
      "min": 0,
      "max": 50
    }
  },
  "sort": {
    "field": "created_at",
    "order": "desc"
  },
  "limit": 50,
  "offset": 0
}
```

**Request (Search by Pattern):**

```json
{
  "type": "list_tasks",
  "filter": {
    "description_contains": "test",
    "files_pattern": "**/*.test.js"
  },
  "limit": 20
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
      "created_at": "2024-01-15T09:30:00Z",
      "started_at": "2024-01-15T09:35:00Z",
      "files_pattern": "**/*.test.js",
      "dependencies": [],
      "timeout": 3600000,
      "metadata": {
        "estimated_duration": 1800,
        "complexity": "medium",
        "test_framework": "jest"
      }
    }
  ],
  "total_count": 25,
  "filtered_count": 5,
  "pagination": {
    "limit": 50,
    "offset": 0,
    "has_more": true,
    "next_offset": 50
  }
}
```

#### Schedule Task

**Request:**

```json
{
  "type": "schedule_task",
  "task": {
    "id": "scheduled_maintenance_001",
    "type": "maintenance",
    "priority": "low",
    "description": "Scheduled system maintenance",
    "files_pattern": "**/*.log",
    "scheduled_time": "2024-01-15T14:00:00Z",
    "recurring": {
      "interval": "daily",
      "end_time": "2024-02-15T14:00:00Z"
    },
    "timeout": 1800000
  }
}
```

**Response (Success):**

```json
{
  "type": "task_scheduled",
  "task_id": "scheduled_maintenance_001",
  "scheduled_time": "2024-01-15T14:00:00Z",
  "next_run": "2024-01-15T14:00:00Z",
  "recurring": {
    "interval": "daily",
    "end_time": "2024-02-15T14:00:00Z"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Response (Error):**

```json
{
  "type": "error",
  "code": "INVALID_SCHEDULE_TIME",
  "message": "Scheduled time must be in the future",
  "details": {
    "field": "scheduled_time",
    "value": "2024-01-14T10:00:00Z",
    "current_time": "2024-01-15T10:30:00Z"
  }
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

**Request (Simple):**

```json
{
  "type": "request_process_list"
}
```

**Request (Advanced Filtering):**

```json
{
  "type": "request_process_list",
  "filter": {
    "type": ["opencode", "claude"],
    "status": ["running", "sleeping"],
    "cpu_percent_min": 1.0,
    "memory_percent_max": 50.0,
    "name_contains": "python",
    "cmdline_contains": "opencode run",
    "working_dir": "/path/to/project",
    "created_after": "2024-01-15T00:00:00Z"
  },
  "sort": {
    "field": "cpu_percent",
    "order": "desc"
  },
  "limit": 100
}
```

**Request (Resource Usage Monitoring):**

```json
{
  "type": "request_process_list",
  "filter": {
    "memory_percent_min": 10.0,
    "cpu_percent_min": 5.0
  },
  "include_system_processes": false
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
        "task_id": "task_456",
        "working_dir": "/path/to/project",
        "activity": "executing_task",
        "is_opencode": true,
        "is_claude_desktop": false,
        "start_time": "2024-01-15T10:00:00Z",
        "runtime_seconds": 1800,
        "threads": 4,
        "open_files": 12
      }
    ],
    "total_count": 1,
    "filtered_count": 1,
    "system_load": {
      "load1": 1.25,
      "load5": 1.45,
      "load15": 1.32
    },
    "resource_summary": {
      "total_cpu_percent": 45.2,
      "total_memory_percent": 67.8,
      "claude_cpu_percent": 25.1,
      "claude_memory_percent": 12.3
    },
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### Request Log Entries

**Request (Simple):**

```json
{
  "type": "request_log_entries",
  "limit": 50
}
```

**Request (Advanced Filtering):**

```json
{
  "type": "request_log_entries",
  "limit": 100,
  "filter": {
    "level": ["error", "warn", "info"],
    "agent": ["task_456", "task_789"],
    "time_range": {
      "start": "2024-01-15T09:00:00Z",
      "end": "2024-01-15T11:00:00Z"
    },
    "message_contains": "failed",
    "details_contains": "timeout",
    "source_file": "dashboard_server.py"
  },
  "sort": {
    "field": "time",
    "order": "desc"
  }
}
```

**Request (Real-time Log Streaming):**

```json
{
  "type": "request_log_entries",
  "limit": 10,
  "filter": {
    "level": ["error"],
    "follow": true,
    "since": "2024-01-15T10:00:00Z"
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
        "source": "config_parser.py:45",
        "details": {
          "error_code": "CONFIG_PARSE_ERROR",
          "file_path": "/path/to/config.json",
          "error_type": "JSONDecodeError",
          "line_number": 25,
          "column_number": 12
        },
        "stack_trace": "...",
        "context": {
          "task_id": "task_456",
          "working_dir": "/path/to/project",
          "environment": "production"
        }
      }
    ],
    "total_count": 150,
    "filtered_count": 5,
    "pagination": {
      "has_more": true,
      "next_cursor": "2024-01-15T10:24:00Z"
    },
    "summary": {
      "error_count": 3,
      "warn_count": 12,
      "info_count": 135,
      "oldest_entry": "2024-01-15T09:00:00Z",
      "newest_entry": "2024-01-15T10:30:00Z"
    },
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### Request System Health

**Request:**

```json
{
  "type": "request_system_health"
}
```

**Response:**

```json
{
  "type": "system_health",
  "data": {
    "overall_status": "healthy",
    "components": {
      "websocket_server": "healthy",
      "task_manager": "healthy",
      "file_monitoring": "healthy",
      "database": "healthy"
    },
    "uptime_seconds": 3600,
    "last_health_check": "2024-01-15T10:30:00Z",
    "issues": []
  }
}
```

#### Request API Metrics

**Request:**

```json
{
  "type": "request_metrics",
  "time_range": "1h"
}
```

**Response:**

```json
{
  "type": "api_metrics",
  "data": {
    "requests_total": 1250,
    "requests_per_second": 0.35,
    "average_response_time_ms": 45.2,
    "error_rate_percent": 0.8,
    "endpoint_usage": {
      "request_status": 450,
      "ping": 320,
      "start_task": 180,
      "kill_process": 25
    },
    "client_connections": {
      "current": 3,
      "peak_today": 12,
      "total_today": 45
    },
    "time_range": "1h",
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
    "source": "task_executor.py:123",
    "details": {
      "execution_time": 125000,
      "files_processed": 15,
      "lines_of_code": 1250
    },
    "context": {
      "task_id": "task_456",
      "working_dir": "/path/to/project",
      "user": "opencode_user"
    }
  }
}
```

#### Task Manager Status Update

```json
{
  "type": "task_manager_status",
  "summary": {
    "total": 25,
    "pending": 5,
    "running": 8,
    "completed": 10,
    "failed": 2,
    "cancelled": 0,
    "queued": 3,
    "active_workers": 4,
    "queue_depth": 12,
    "average_completion_time": 450000,
    "success_rate_percent": 83.3
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Detailed Process Scan Update

```json
{
  "type": "detailed_process_scan",
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
      "task_id": "task_456",
      "activity": "executing_task",
      "is_opencode": true,
      "is_claude_desktop": false
    }
  ],
  "system_load": {
    "load1": 1.25,
    "load5": 1.45,
    "load15": 1.32
  },
  "scan_duration_ms": 250,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Claude Processes Update

```json
{
  "type": "claude_processes_update",
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
  "process_count": 3,
  "opencode_processes": 2,
  "claude_desktop_processes": 1,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### System Resources Update (Detailed)

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
    "network_stats": {
      "bytes_sent": 1024000,
      "bytes_recv": 2048000,
      "packets_sent": 1500,
      "packets_recv": 2200,
      "errors_sent": 0,
      "errors_recv": 2
    },
    "active_processes": 5,
    "claude_processes": 2,
    "load_average": [1.25, 1.45, 1.32],
    "uptime_seconds": 86400,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### Task Progress Update

```json
{
  "type": "task_progress_update",
  "task_id": "task_456",
  "old_progress": 45,
  "new_progress": 67,
  "progress_details": {
    "current_step": "Running tests",
    "total_steps": 5,
    "completed_steps": 3,
    "estimated_time_remaining": 180000
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### Connection Status Update

```json
{
  "type": "connection_status",
  "status": "healthy",
  "client_count": 5,
  "uptime_seconds": 3600,
  "last_ping": "2024-01-15T10:29:30Z",
  "message_queue_size": 0,
  "timestamp": "2024-01-15T10:30:00Z"
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

| Code                        | Description                                | HTTP Equivalent           |
| --------------------------- | ------------------------------------------ | ------------------------- |
| `INVALID_JSON`              | Malformed JSON in request                  | 400 Bad Request           |
| `UNKNOWN_MESSAGE_TYPE`      | Unknown message type                       | 400 Bad Request           |
| `MISSING_REQUIRED_FIELD`    | Required field missing                     | 400 Bad Request           |
| `INVALID_FIELD_VALUE`       | Invalid field value                        | 400 Bad Request           |
| `INVALID_FIELD_TYPE`        | Field has wrong data type                  | 400 Bad Request           |
| `INVALID_FIELD_FORMAT`      | Field value has invalid format             | 400 Bad Request           |
| `TASK_NOT_FOUND`            | Task ID not found                          | 404 Not Found             |
| `PROCESS_NOT_FOUND`         | Process ID not found                       | 404 Not Found             |
| `TASK_ALREADY_EXISTS`       | Task ID already exists                     | 409 Conflict              |
| `PROCESS_ALREADY_EXISTS`    | Process ID already exists                  | 409 Conflict              |
| `TASK_DEPENDENCY_ERROR`     | Task dependency validation failed          | 400 Bad Request           |
| `TASK_TIMEOUT_EXCEEDED`     | Task execution exceeded timeout            | 408 Request Timeout       |
| `INVALID_SCHEDULE_TIME`     | Scheduled time is invalid or in the past   | 400 Bad Request           |
| `INVALID_RECURRING_CONFIG`  | Invalid recurring task configuration       | 400 Bad Request           |
| `PROCESS_KILL_FAILED`       | Failed to kill process                     | 500 Internal Server Error |
| `PROCESS_PERMISSION_DENIED` | Insufficient permissions to manage process | 403 Forbidden             |
| `DATABASE_ERROR`            | Database operation failed                  | 500 Internal Server Error |
| `DATABASE_CONNECTION_ERROR` | Cannot connect to database                 | 503 Service Unavailable   |
| `FILESYSTEM_ERROR`          | File system operation failed               | 500 Internal Server Error |
| `FILE_NOT_FOUND`            | Requested file not found                   | 404 Not Found             |
| `FILE_PERMISSION_DENIED`    | Insufficient permissions to access file    | 403 Forbidden             |
| `LOG_FILE_ERROR`            | Error reading or writing log files         | 500 Internal Server Error |
| `CONFIGURATION_ERROR`       | Invalid configuration                      | 500 Internal Server Error |
| `SERVICE_UNAVAILABLE`       | Required service is unavailable            | 503 Service Unavailable   |
| `PERMISSION_DENIED`         | Insufficient permissions                   | 403 Forbidden             |
| `AUTHENTICATION_REQUIRED`   | Authentication is required                 | 401 Unauthorized          |
| `INVALID_AUTH_TOKEN`        | Authentication token is invalid            | 401 Unauthorized          |
| `RATE_LIMIT_EXCEEDED`       | Too many requests                          | 429 Too Many Requests     |
| `CONNECTION_LIMIT_EXCEEDED` | Too many concurrent connections            | 429 Too Many Requests     |
| `SERVER_OVERLOAD`           | Server temporarily overloaded              | 503 Service Unavailable   |
| `MEMORY_LIMIT_EXCEEDED`     | Memory usage limit exceeded                | 507 Insufficient Storage  |
| `DISK_SPACE_EXCEEDED`       | Disk space limit exceeded                  | 507 Insufficient Storage  |
| `CONNECTION_LOST`           | WebSocket connection lost                  | N/A                       |
| `HEARTBEAT_TIMEOUT`         | Heartbeat response timeout                 | N/A                       |
| `SUBSCRIPTION_ERROR`        | Error with real-time subscription          | 400 Bad Request           |
| `FILTER_VALIDATION_ERROR`   | Invalid filter parameters                  | 400 Bad Request           |
| `METRICS_UNAVAILABLE`       | Performance metrics unavailable            | 503 Service Unavailable   |
| `HEALTH_CHECK_FAILED`       | System health check failed                 | 503 Service Unavailable   |

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

#### Task Dependency Error

```json
{
  "type": "error",
  "code": "TASK_DEPENDENCY_ERROR",
  "message": "Task dependency 'task_123' does not exist",
  "details": {
    "task_id": "dependent_task",
    "dependency_id": "task_123",
    "available_tasks": ["task_456", "task_789"]
  }
}
```

#### Invalid Schedule Time

```json
{
  "type": "error",
  "code": "INVALID_SCHEDULE_TIME",
  "message": "Scheduled time must be in the future",
  "details": {
    "field": "scheduled_time",
    "value": "2024-01-14T10:00:00Z",
    "current_time": "2024-01-15T10:30:00Z",
    "minimum_delay_seconds": 60
  }
}
```

#### Database Connection Error

```json
{
  "type": "error",
  "code": "DATABASE_CONNECTION_ERROR",
  "message": "Cannot connect to database server",
  "details": {
    "database_host": "localhost",
    "database_port": 5432,
    "connection_timeout_ms": 5000,
    "retry_count": 3
  }
}
```

#### File Permission Denied

```json
{
  "type": "error",
  "code": "FILE_PERMISSION_DENIED",
  "message": "Insufficient permissions to access file",
  "details": {
    "file_path": "/path/to/restricted/file.log",
    "operation": "read",
    "required_permissions": "read",
    "current_user": "opencode_user"
  }
}
```

## Data Types and Validation

### Core Data Types

#### TaskType

Valid values: `"testing"`, `"documentation"`, `"analysis"`, `"deployment"`, `"maintenance"`, `"security"`, `"refactoring"`, `"feature"`, `"bugfix"`, `"research"`

#### Priority

Valid values: `"low"`, `"medium"`, `"high"`, `"critical"`

#### TaskStatus

Valid values: `"pending"`, `"running"`, `"completed"`, `"failed"`, `"cancelled"`, `"paused"`, `"queued"`

#### ProcessStatus

Valid values: `"running"`, `"sleeping"`, `"stopped"`, `"zombie"`, `"dead"`

#### ProcessType

Valid values: `"opencode"`, `"claude"`, `"claude_desktop"`, `"anthropic_claude"`, `"cursor_claude"`, `"unknown"`

#### LogLevel

Valid values: `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`

### Task Object

```typescript
interface Task {
  // Required fields
  id: string; // 1-100 characters, alphanumeric + underscores/hyphens
  type: TaskType; // Must be valid TaskType
  priority: Priority; // Must be valid Priority
  description: string; // 1-1000 characters

  // Optional fields
  status?: TaskStatus; // Auto-managed, read-only for clients
  progress?: number; // 0-100, integer
  files_pattern?: string; // Valid glob pattern, max 500 characters
  dependencies?: string[]; // Array of valid task IDs, max 20 dependencies
  timeout?: number; // 1000-86400000 ms (1 second to 24 hours)
  created_at?: string; // ISO 8601 timestamp, read-only
  started_at?: string; // ISO 8601 timestamp, read-only
  completed_at?: string; // ISO 8601 timestamp, read-only
  error?: string; // Error message, max 1000 characters

  // Advanced scheduling (optional)
  scheduled_time?: string; // ISO 8601 timestamp, must be in future
  recurring?: RecurringConfig; // Recurring task configuration

  // Metadata (optional)
  metadata?: TaskMetadata; // Additional task information
}
```

### RecurringConfig Object

```typescript
interface RecurringConfig {
  interval: "daily" | "weekly" | "monthly"; // Recurring interval
  end_time?: string; // ISO 8601 timestamp, optional end date
  max_runs?: number; // Maximum number of runs, 1-1000
  timezone?: string; // IANA timezone identifier
}
```

### TaskMetadata Object

```typescript
interface TaskMetadata {
  estimated_duration?: number; // Estimated duration in milliseconds
  complexity?: "low" | "medium" | "high";
  tags?: string[]; // Array of tags, max 10 tags, 50 chars each
  owner?: string; // Owner identifier, max 100 characters
  project?: string; // Project identifier, max 100 characters
  environment?: string; // Environment (dev, staging, prod)
  [key: string]: any; // Additional custom metadata
}
```

### Process Object

```typescript
interface Process {
  // System fields (read-only)
  pid: number; // Process ID, positive integer
  name: string; // Process name, max 256 characters
  cmdline: string; // Full command line, max 4096 characters
  status: ProcessStatus; // Current process status
  cpu_percent: number; // CPU usage percentage, 0-100
  memory_percent: number; // Memory usage percentage, 0-100
  memory_rss: number; // Resident Set Size in bytes
  create_time: number; // Creation timestamp (Unix epoch)

  // Claude/OpenCode specific fields
  type?: ProcessType; // Process type classification
  task_id?: string; // Associated task ID if applicable
  working_dir?: string; // Working directory path
  activity?: string; // Current activity description

  // Extended information
  threads?: number; // Number of threads
  open_files?: number; // Number of open files
  connections?: number; // Number of network connections
  start_time?: string; // ISO 8601 start timestamp
  runtime_seconds?: number; // Runtime in seconds
}
```

### System Resources Object

```typescript
interface SystemResources {
  // CPU information
  cpu_usage: number; // Overall CPU usage percentage, 0-100
  cpu_cores?: number; // Number of CPU cores
  cpu_frequency?: number; // CPU frequency in MHz

  // Memory information
  memory_usage: number; // Memory usage percentage, 0-100
  memory_used: number; // Memory used in bytes
  memory_total: number; // Total memory in bytes
  memory_available?: number; // Available memory in bytes

  // Disk information
  disk_usage: number; // Disk usage percentage, 0-100
  disk_used: number; // Disk used in bytes
  disk_total: number; // Total disk space in bytes
  disk_free?: number; // Free disk space in bytes

  // Network statistics
  network_stats?: NetworkStats;

  // Process information
  active_processes: number; // Total active processes
  claude_processes: number; // Claude/OpenCode processes

  // System load
  load_average?: [number, number, number]; // 1, 5, 15 minute load averages
  uptime_seconds?: number; // System uptime in seconds

  // Timestamp
  timestamp: string; // ISO 8601 timestamp
}
```

### NetworkStats Object

```typescript
interface NetworkStats {
  bytes_sent: number; // Total bytes sent
  bytes_recv: number; // Total bytes received
  packets_sent: number; // Total packets sent
  packets_recv: number; // Total packets received
  errors_sent?: number; // Send errors
  errors_recv?: number; // Receive errors
  drop_sent?: number; // Dropped packets sent
  drop_recv?: number; // Dropped packets received
}
```

### Validation Rules

#### Task ID Validation

- **Format**: Must match regex `^[a-zA-Z0-9_-]{1,100}$`
- **Uniqueness**: Must be unique across all tasks
- **Reserved prefixes**: Cannot start with `system_` or `internal_`

#### File Pattern Validation

- **Format**: Must be valid glob pattern
- **Security**: Cannot contain `..` or start with `/`
- **Length**: Maximum 500 characters

#### Time Validation

- **Format**: Must be valid ISO 8601 timestamp
- **Future times**: Scheduled times must be at least 60 seconds in the future
- **Reasonable range**: Cannot be more than 1 year in the future

#### String Length Limits

- Task description: 1000 characters
- Error messages: 1000 characters
- File paths: 4096 characters
- Command lines: 4096 characters

#### Numeric Limits

- Progress: 0-100 (integer)
- CPU percentage: 0-100 (float)
- Memory percentage: 0-100 (float)
- Timeout: 1000-86400000 ms
- Array sizes: Dependencies (20), Tags (10)

#### Array Validation

- No duplicate values allowed
- All elements must be valid according to their type
- Maximum sizes enforced

## Rate Limiting

The API implements comprehensive rate limiting to prevent abuse and ensure fair resource allocation:

### Rate Limit Categories

#### Connection Limits

- **Concurrent connections**: Maximum 100 simultaneous WebSocket connections per server instance
- **Connection rate**: Maximum 10 new connections per second
- **Reconnection rate**: Maximum 5 reconnections per minute per client IP

#### Message Rate Limits

- **Global message rate**: Maximum 1000 messages per minute across all connections
- **Per-connection rate**: Maximum 100 messages per minute per connection
- **Burst allowance**: Maximum 20 messages per second burst capacity

#### Operation-Specific Limits

- **Task creation**: Maximum 10 new tasks per minute
- **Task operations**: Maximum 50 task status checks per minute
- **Process operations**: Maximum 5 process kill operations per minute
- **File operations**: Maximum 100 file access operations per minute
- **Log queries**: Maximum 20 log queries per minute

### Rate Limit Headers

When rate limits are approached or exceeded, the server includes rate limit information in responses:

```json
{
  "type": "rate_limit_info",
  "limits": {
    "messages_per_minute": {
      "current": 85,
      "limit": 100,
      "reset_time": "2024-01-15T10:31:00Z"
    },
    "tasks_per_minute": {
      "current": 7,
      "limit": 10,
      "reset_time": "2024-01-15T10:31:00Z"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Rate Limit Algorithms

#### Token Bucket Algorithm

- **Bucket capacity**: Defines burst allowance
- **Refill rate**: Defines sustained rate
- **Thread-safe**: Atomic operations for concurrent access

#### Sliding Window Algorithm

- **Window size**: 1 minute for most operations
- **Granularity**: Per-second tracking for precise control
- **Memory efficient**: Circular buffer implementation

### Handling Rate Limits

#### Client-Side Strategies

1. **Exponential backoff** - Double delay between retries
2. **Jitter** - Add random delay to prevent thundering herd
3. **Request batching** - Combine multiple operations into single requests
4. **Caching** - Cache frequently accessed data locally

#### Error Recovery

```javascript
function handleRateLimit(error) {
  const retryAfter = error.details.retry_after_seconds;
  const jitter = Math.random() * 1000; // Up to 1 second jitter

  setTimeout(
    () => {
      retryRequest();
    },
    retryAfter * 1000 + jitter,
  );
}
```

### Rate Limit Monitoring

#### Metrics Available

- Current usage rates for all limit categories
- Historical usage patterns
- Top clients by usage
- Rate limit violations over time

#### Administrative Controls

- Dynamic rate limit adjustment
- Per-client limit overrides
- Emergency rate limit suspension
- Automated scaling based on server load

## Authentication and Security

### Current Implementation

Currently, the API does not implement authentication. All connections are assumed to be from trusted clients running on the same system or trusted network.

### Planned Security Features

Future versions will include comprehensive security measures:

#### API Key Authentication

**Authentication Request:**

```json
{
  "type": "authenticate",
  "api_key": "sk-1234567890abcdef",
  "client_info": {
    "name": "OpenCode Dashboard",
    "version": "1.0.0",
    "user_agent": "Mozilla/5.0..."
  }
}
```

**Authentication Response:**

```json
{
  "type": "authentication_success",
  "session_token": "sess_abcdef123456",
  "expires_at": "2024-01-15T11:30:00Z",
  "permissions": ["read", "write", "admin"],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

#### JWT Token Validation

**Header-based Authentication:**

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Token Payload:**

```json
{
  "sub": "client_123",
  "name": "OpenCode Dashboard",
  "permissions": ["read", "write"],
  "exp": 1642152600,
  "iat": 1642149000,
  "iss": "opencode-server"
}
```

#### IP Whitelisting

**Configuration:**

```json
{
  "security": {
    "ip_whitelist": ["127.0.0.1", "192.168.1.0/24", "::1"],
    "ip_blacklist": ["10.0.0.0/8"]
  }
}
```

#### SSL/TLS Encryption

**Connection Establishment:**

```javascript
const ws = new WebSocket("wss://localhost:8080/ws", {
  rejectUnauthorized: true,
  ca: [certificateAuthority],
});
```

### Security Best Practices

#### Connection Security

1. **Use WSS in production** - Always use WebSocket Secure (WSS) for encrypted connections
2. **Certificate validation** - Validate server certificates in production environments
3. **Client certificate authentication** - Require client certificates for high-security deployments

#### Data Protection

1. **Encrypt sensitive data** - Never transmit passwords, API keys, or sensitive configuration in plain text
2. **Input validation** - Validate all input data on both client and server sides
3. **Output encoding** - Properly encode output to prevent injection attacks

#### Access Control

1. **Principle of least privilege** - Grant only necessary permissions to clients
2. **Session management** - Implement proper session timeouts and invalidation
3. **Audit logging** - Log all authentication and authorization events

### Security Monitoring

#### Security Event Types

- `authentication_failure` - Failed authentication attempts
- `authorization_denied` - Permission denied for operation
- `rate_limit_exceeded` - Rate limiting triggered
- `suspicious_activity` - Potentially malicious behavior detected
- `certificate_error` - SSL/TLS certificate issues

#### Security Alerts

```json
{
  "type": "security_alert",
  "alert_type": "brute_force_attempt",
  "severity": "high",
  "details": {
    "client_ip": "192.168.1.100",
    "attempts": 25,
    "time_window": 300,
    "blocked_until": "2024-01-15T11:00:00Z"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

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

### v1.4.0 (Current)

**Release Date:** January 15, 2024

**New Features:**

- Added `request_system_health` endpoint for comprehensive health monitoring
- Added `request_metrics` endpoint for API usage statistics
- Added `schedule_task` endpoint with recurring task support
- Enhanced real-time updates with detailed process scanning
- Added task dependency validation and management
- Implemented advanced filtering for all list endpoints
- Added comprehensive error codes and detailed error responses

**Improvements:**

- Enhanced request/response examples with complex filtering scenarios
- Added detailed data type definitions and validation rules
- Improved rate limiting with per-operation limits and burst handling
- Enhanced security documentation with authentication planning
- Added comprehensive real-time message type documentation

**Breaking Changes:**

- None

### v1.3.0

**Release Date:** December 20, 2023

**New Features:**

- Added process management and advanced filtering
- Enhanced real-time subscriptions with channel-based filtering
- Added detailed process information and resource monitoring
- Implemented task progress tracking with detailed updates

**Improvements:**

- Improved error handling with structured error responses
- Enhanced WebSocket connection stability
- Added comprehensive logging and monitoring capabilities

### v1.2.0

**Release Date:** November 15, 2023

**New Features:**

- Improved error handling and rate limiting
- Added detailed error codes with HTTP equivalents
- Enhanced validation with comprehensive input checking
- Added connection health monitoring and heartbeat

**Improvements:**

- Better error messages with actionable details
- Enhanced rate limiting with retry information
- Improved connection resilience with automatic reconnection

### v1.1.0

**Release Date:** October 10, 2023

**New Features:**

- Added real-time subscriptions for live updates
- Enhanced monitoring with system resource tracking
- Added task progress updates and status notifications
- Implemented WebSocket-based real-time communication

**Improvements:**

- Better performance with optimized message handling
- Enhanced scalability with connection pooling
- Improved reliability with error recovery mechanisms

### v1.0.0

**Release Date:** September 1, 2023

**Initial Release:**

- Core WebSocket API for real-time communication
- Basic task management (create, cancel, status)
- System monitoring and process listing
- Basic error handling and logging
- Ping/pong health checks

## API Stability and Deprecation Policy

### Versioning Strategy

- **Major version** (X.y.z): Breaking changes, requires client updates
- **Minor version** (x.Y.z): New features, backward compatible
- **Patch version** (x.y.Z): Bug fixes and improvements, backward compatible

### Deprecation Process

1. **Announcement**: Deprecated features announced in release notes with migration guide
2. **Grace period**: Minimum 3 months for major features, 1 month for minor features
3. **Removal**: Deprecated features removed in next major version
4. **Support**: Critical security fixes provided for deprecated features during grace period

### Migration Guides

#### Migrating from v1.3.x to v1.4.0

- No breaking changes required
- New endpoints available for enhanced functionality
- Improved error responses provide more detailed information

#### Future Breaking Changes (v2.0.0)

- Authentication will become mandatory
- WebSocket subprotocol version requirement
- Enhanced security requirements for production deployments

## Roadmap

### v1.5.0 (Q2 2024)

- Plugin system for custom task types
- Advanced analytics and reporting
- Enhanced dashboard integrations

### v2.0.0 (Q3 2024)

- Mandatory authentication and authorization
- Enhanced security with TLS 1.3 requirement
- Multi-tenant support for enterprise deployments
- Advanced audit logging and compliance features

### v2.1.0 (Q4 2024)

- GraphQL API alongside WebSocket API
- Advanced workflow orchestration
- Machine learning-based task optimization
- Enhanced scalability with clustering support

## Support

For API support and questions:

- **Documentation:** This document
- **Issues:** Report bugs at https://github.com/mediafill/opencode-agent-automation/issues
- **Discussions:** Use GitHub Discussions for questions

---

_Last updated: January 15, 2024_
