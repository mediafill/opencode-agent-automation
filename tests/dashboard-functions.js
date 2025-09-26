// Dashboard JavaScript functions extracted from monitor-dashboard.html for testing

// Global variables
let websocket = null;
let reconnectInterval = null;
let heartbeatInterval = null;
let agents = [];
let tasks = [];
let logs = [];
let resourceData = [];
let currentTheme = 'light';
let autoScrollLogs = true;
let charts = {};

// Performance optimization: Add indexes for O(1) lookups
let agentsIndex = new Map(); // agent.id -> agent object
let tasksIndex = new Map(); // task.id -> task object
let agentsByStatus = new Map(); // status -> Set of agent IDs
let tasksByStatus = new Map(); // status -> Set of task IDs
let agentsByType = new Map(); // type -> Set of agent IDs
let tasksByType = new Map(); // type -> Set of task IDs

// Caching for computed values to avoid N+1 queries
let cachedAgentStats = null;
let cachedTaskStats = null;
let lastStatsUpdate = 0;
const STATS_CACHE_TTL = 5000; // 5 seconds

// Index maintenance functions
function rebuildIndexes() {
    // Clear existing indexes
    agentsIndex.clear();
    tasksIndex.clear();
    agentsByStatus.clear();
    tasksByStatus.clear();
    agentsByType.clear();
    tasksByType.clear();

    // Rebuild agent indexes
    agents.forEach(agent => {
        agentsIndex.set(agent.id, agent);

        // Status index
        if (!agentsByStatus.has(agent.status)) {
            agentsByStatus.set(agent.status, new Set());
        }
        agentsByStatus.get(agent.status).add(agent.id);

        // Type index
        if (!agentsByType.has(agent.type)) {
            agentsByType.set(agent.type, new Set());
        }
        agentsByType.get(agent.type).add(agent.id);
    });

    // Rebuild task indexes
    tasks.forEach(task => {
        tasksIndex.set(task.id, task);

        // Status index
        if (!tasksByStatus.has(task.status)) {
            tasksByStatus.set(task.status, new Set());
        }
        tasksByStatus.get(task.status).add(task.id);

        // Type index
        if (!tasksByType.has(task.type)) {
            tasksByType.set(task.type, new Set());
        }
        tasksByType.get(task.type).add(task.id);
    });

    // Invalidate cached stats
    cachedAgentStats = null;
    cachedTaskStats = null;
}

// Optimized query functions
function getAgentsByStatus(status) {
    return agentsByStatus.get(status) || new Set();
}

function getTasksByStatus(status) {
    return tasksByStatus.get(status) || new Set();
}

function getAgentsByType(type) {
    return agentsByType.get(type) || new Set();
}

function getTasksByType(type) {
    return tasksByType.get(type) || new Set();
}

function getAgentById(id) {
    return agentsIndex.get(id);
}

function getTaskById(id) {
    return tasksIndex.get(id);
}

// Cached statistics computation
function getAgentStats() {
    const now = Date.now();
    if (cachedAgentStats && (now - lastStatsUpdate) < STATS_CACHE_TTL) {
        return cachedAgentStats;
    }

    const stats = {
        total: agents.length,
        byStatus: {},
        byType: {},
        completionRate: 0
    };

    // Use indexes for O(1) lookups instead of O(n) iterations
    agentsByStatus.forEach((agentIds, status) => {
        stats.byStatus[status] = agentIds.size;
    });

    agentsByType.forEach((agentIds, type) => {
        stats.byType[type] = agentIds.size;
    });

    const completed = stats.byStatus.completed || 0;
    stats.completionRate = stats.total > 0 ? Math.round((completed / stats.total) * 100) : 0;

    cachedAgentStats = stats;
    lastStatsUpdate = now;
    return stats;
}

function getTaskStats() {
    const now = Date.now();
    if (cachedTaskStats && (now - lastStatsUpdate) < STATS_CACHE_TTL) {
        return cachedTaskStats;
    }

    const stats = {
        total: tasks.length,
        byStatus: {},
        byType: {}
    };

    // Use indexes for O(1) lookups
    tasksByStatus.forEach((taskIds, status) => {
        stats.byStatus[status] = taskIds.size;
    });

    tasksByType.forEach((taskIds, type) => {
        stats.byType[type] = taskIds.size;
    });

    cachedTaskStats = stats;
    lastStatsUpdate = now;
    return stats;
}

// WebSocket connection management
let connectionState = 'disconnected'; // disconnected, connecting, connected, error
let connectionAttempts = 0;
let maxReconnectAttempts = 10;
let baseReconnectDelay = 1000; // 1 second
let maxReconnectDelay = 30000; // 30 seconds
let heartbeatInterval_ms = 30000; // 30 seconds
let connectionMetrics = {
    connectTime: null,
    lastHeartbeat: null,
    messagesSent: 0,
    messagesReceived: 0,
    reconnectCount: 0,
    totalDowntime: 0
};

// Enhanced WebSocket connection with validation and health monitoring
function initializeWebSocket() {
    if (connectionState === 'connecting') return; // Prevent multiple connection attempts
    
    connectionState = 'connecting';
    updateConnectionStatus('connecting', 'Connecting...');
    
    const wsProtocol = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//localhost:8080/ws`;

    try {
        if (typeof WebSocket !== 'undefined') {
            websocket = new WebSocket(wsUrl);
        } else {
            throw new Error('WebSocket not available in this environment');
        }
        
        // Set connection timeout
        const connectionTimeout = setTimeout(() => {
            if (connectionState === 'connecting') {
                websocket.close();
                handleConnectionFailure('Connection timeout');
            }
        }, 10000); // 10 second timeout

        websocket.onopen = function() {
            clearTimeout(connectionTimeout);
            connectionState = 'connected';
            connectionAttempts = 0;
            connectionMetrics.connectTime = new Date();
            connectionMetrics.reconnectCount = connectionAttempts > 0 ? connectionMetrics.reconnectCount + 1 : 0;
            
            updateConnectionStatus('connected', 'Connected');
            console.log('WebSocket connected successfully');
            
            // Start heartbeat mechanism
            startHeartbeat();
            
            // Request initial data when connected
            sendMessage({ type: 'request_status' });
            
            addLogEntry({
                time: new Date(),
                level: 'info',
                message: 'WebSocket connection established',
                agent: 'dashboard'
            });
        };

        websocket.onmessage = function(event) {
            connectionMetrics.messagesReceived++;
            connectionMetrics.lastHeartbeat = new Date();
            
            try {
                const data = JSON.parse(event.data);
                
                // Handle heartbeat response
                if (data.type === 'pong') {
                    return; // Just update metrics, no further processing needed
                }
                
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                addLogEntry({
                    time: new Date(),
                    level: 'error',
                    message: `WebSocket message parse error: ${error.message}`,
                    agent: 'dashboard'
                });
            }
        };

        websocket.onclose = function(event) {
            clearTimeout(connectionTimeout);
            stopHeartbeat();
            
            const wasConnected = connectionState === 'connected';
            connectionState = 'disconnected';
            
            console.log('WebSocket disconnected', event.code, event.reason);
            
            if (event.code === 1000) {
                // Normal closure
                updateConnectionStatus('disconnected', 'Disconnected');
                addLogEntry({
                    time: new Date(),
                    level: 'info',
                    message: 'WebSocket connection closed normally',
                    agent: 'dashboard'
                });
            } else if (event.code === 1006 || event.code === 1001) {
                // Abnormal closure or going away - attempt reconnection
                handleConnectionFailure(`Connection lost (${event.code})`);
            } else {
                // Other closure codes
                handleConnectionFailure(`Connection closed with code ${event.code}: ${event.reason || 'Unknown'}`);
            }
        };

        websocket.onerror = function(error) {
            clearTimeout(connectionTimeout);
            console.error('WebSocket error:', error);
            handleConnectionFailure('WebSocket error occurred');
        };

    } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        handleConnectionFailure(`Failed to initialize WebSocket: ${error.message}`);
    }
}

// Enhanced connection failure handling with exponential backoff
function handleConnectionFailure(reason) {
    connectionState = 'error';
    updateConnectionStatus('disconnected', `Error: ${reason}`);
    
    addLogEntry({
        time: new Date(),
        level: 'error',
        message: reason,
        agent: 'dashboard'
    });
    
    // Stop any existing reconnection attempts
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
    
    // Attempt reconnection with exponential backoff
    if (connectionAttempts < maxReconnectAttempts) {
        connectionAttempts++;
        const delay = Math.min(baseReconnectDelay * Math.pow(2, connectionAttempts - 1), maxReconnectDelay);
        
        updateConnectionStatus('connecting', `Reconnecting in ${Math.round(delay/1000)}s... (${connectionAttempts}/${maxReconnectAttempts})`);
        
        reconnectInterval = setTimeout(() => {
            reconnectInterval = null;
            initializeWebSocket();
        }, delay);
    } else {
        updateConnectionStatus('disconnected', 'Max reconnection attempts reached');
        addLogEntry({
            time: new Date(),
            level: 'error',
            message: 'Maximum reconnection attempts reached. Please refresh the page.',
            agent: 'dashboard'
        });
        // Fall back to demo data
        loadDemoData();
    }
}

// Heartbeat mechanism for connection health monitoring
function startHeartbeat() {
    stopHeartbeat(); // Clear any existing heartbeat
    
    if (typeof setInterval === 'undefined') return; // Skip in test environments
    
    heartbeatInterval = setInterval(() => {
        if (websocket && websocket.readyState === 1) { // WebSocket.OPEN
            sendMessage({ type: 'ping', timestamp: new Date().getTime() });
            
            // Check if we haven't received a heartbeat response in a while
            const timeSinceLastHeartbeat = connectionMetrics.lastHeartbeat ? 
                Date.now() - connectionMetrics.lastHeartbeat.getTime() : Infinity;
            
            if (timeSinceLastHeartbeat > heartbeatInterval_ms * 2) {
                console.warn('Heartbeat timeout detected, forcing reconnection');
                websocket.close(1006, 'Heartbeat timeout');
            }
        } else {
            stopHeartbeat();
        }
    }, heartbeatInterval_ms);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// Enhanced message sending with validation
function sendMessage(message) {
    if (websocket && websocket.readyState === 1) { // WebSocket.OPEN
        try {
            const messageStr = JSON.stringify(message);
            websocket.send(messageStr);
            connectionMetrics.messagesSent++;
            return true;
        } catch (error) {
            console.error('Error sending WebSocket message:', error);
            addLogEntry({
                time: new Date(),
                level: 'error',
                message: `Failed to send message: ${error.message}`,
                agent: 'dashboard'
            });
            return false;
        }
    } else {
        console.warn('Cannot send message: WebSocket not connected');
        return false;
    }
}

function handleWebSocketMessage(data) {
    // Validate message structure
    if (!data || typeof data !== 'object') {
        console.warn('Invalid WebSocket message received:', data);
        return;
    }
    
    switch (data.type) {
        case 'agent_update':
            if (data.agent && data.agent.id) {
                updateAgent(data.agent);
                logAgentStatusChange(data.agent);
            }
            break;
        case 'task_update':
            if (data.task && data.task.id) {
                updateTask(data.task);
            }
            break;
        case 'log_entry':
            if (data.log) {
                addLogEntry(data.log);
            }
            break;
        case 'resource_update':
            if (data.resources) {
                updateResourceData(data.resources);
            }
            break;
        case 'full_status':
            // Clear existing arrays and populate with new data
            agents.length = 0;
            tasks.length = 0;
            if (Array.isArray(data.agents)) {
                agents.push(...data.agents);
            }
            if (Array.isArray(data.tasks)) {
                tasks.push(...data.tasks);
            }
            rebuildIndexes(); // Rebuild indexes after bulk update
            updateAllDisplays();
            addLogEntry({
                time: new Date(),
                level: 'info',
                message: `Status update received: ${agents.length} agents, ${tasks.length} tasks`,
                agent: 'dashboard'
            });
            break;
        case 'agent_metrics':
            if (data.metrics) {
                updateAgentMetrics(data.metrics);
            }
            break;
        case 'system_alert':
            if (data.alert) {
                handleSystemAlert(data.alert);
            }
            break;
        default:
            console.log('Unknown message type received:', data.type);
    }
}

// Log significant agent status changes
function logAgentStatusChange(agent) {
    const existingAgent = agents.find(a => a.id === agent.id);
    if (existingAgent && existingAgent.status !== agent.status) {
        addLogEntry({
            time: new Date(),
            level: agent.status === 'error' ? 'error' : 'info',
            message: `Agent ${agent.id} status changed from ${existingAgent.status} to ${agent.status}`,
            agent: agent.id
        });
    }
}

// Handle system alerts
function handleSystemAlert(alert) {
    addLogEntry({
        time: new Date(),
        level: alert.severity || 'warn',
        message: alert.message || 'System alert received',
        agent: 'system'
    });
}

// Update agent metrics
function updateAgentMetrics(metrics) {
    // Update performance metrics display
    if (metrics.performance) {
        updatePerformanceMetrics(metrics.performance);
    }
    
    // Update resource usage
    if (metrics.resources) {
        updateResourceData(metrics.resources);
    }
}

function updateConnectionStatus(status, text) {
    const dot = document.getElementById('connectionStatus');
    const textEl = document.getElementById('connectionText');

    if (dot) dot.className = `connection-dot ${status}`;
    if (textEl) textEl.textContent = text;

    if (status === 'connected' && reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
}

// Demo data for fallback
function loadDemoData() {
    // Clear existing arrays and populate with demo data
    agents.length = 0;
    agents.push(
        {
            id: 'security_' + Date.now(),
            type: 'security',
            status: 'running',
            task: 'Performing security audit on authentication module',
            progress: 65,
            startTime: new Date(Date.now() - 300000),
            priority: 'high'
        },
        {
            id: 'testing_' + (Date.now() + 1),
            type: 'testing',
            status: 'completed',
            task: 'Added unit tests for user service',
            progress: 100,
            startTime: new Date(Date.now() - 600000),
            endTime: new Date(Date.now() - 60000),
            priority: 'medium'
        },
        {
            id: 'perf_' + (Date.now() + 2),
            type: 'performance',
            status: 'pending',
            task: 'Database query optimization',
            progress: 0,
            priority: 'high'
        },
        {
            id: 'docs_' + (Date.now() + 3),
            type: 'documentation',
            status: 'error',
            task: 'API documentation generation',
            progress: 25,
            startTime: new Date(Date.now() - 180000),
            error: 'Failed to parse OpenAPI specification',
            priority: 'low'
        }
    );

    tasks.length = 0;
    tasks.push(
        { id: '1', type: 'security', status: 'in_progress', priority: 'high', description: 'Security audit' },
        { id: '2', type: 'testing', status: 'completed', priority: 'medium', description: 'Unit tests' },
        { id: '3', type: 'performance', status: 'pending', priority: 'high', description: 'Performance optimization' },
        { id: '4', type: 'documentation', status: 'blocked', priority: 'low', description: 'Documentation update' }
    );

    logs.length = 0;
    logs.push(
        { time: new Date(), level: 'info', message: 'Security agent started', agent: 'security_agent' },
        { time: new Date(Date.now() - 30000), level: 'warn', message: 'Potential SQL injection vulnerability found', agent: 'security_agent' },
        { time: new Date(Date.now() - 60000), level: 'info', message: 'Testing agent completed successfully', agent: 'testing_agent' },
        { time: new Date(Date.now() - 90000), level: 'error', message: 'Documentation agent failed to parse OpenAPI spec', agent: 'docs_agent' },
        { time: new Date(Date.now() - 120000), level: 'info', message: 'Performance agent queued', agent: 'perf_agent' }
    );

    updateAllDisplays();
    rebuildIndexes(); // Rebuild indexes after loading demo data
}

// Update all display components
function updateAllDisplays() {
    updateAgentStatusOverview();
    updateTaskQueue();
    updateSystemResources();
    updateActiveAgents();
    updateTimeline();
    updateLogs();
    updateTaskDistributionChart();
}

// Agent status overview - optimized with cached stats
function updateAgentStatusOverview() {
    const stats = getAgentStats();

    const container = document.getElementById('agentStatusOverview');
    if (container) {
        container.innerHTML = `
            <div class="metric">
                <span class="metric-label">Total Agents</span>
                <span class="metric-value">${stats.total}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Running</span>
                <span class="metric-value">${stats.byStatus.running || 0}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Completed</span>
                <span class="metric-value">${stats.byStatus.completed || 0}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Errors</span>
                <span class="metric-value">${stats.byStatus.error || 0}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Pending</span>
                <span class="metric-value">${stats.byStatus.pending || 0}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${stats.completionRate}%"></div>
            </div>
            <div class="progress-text">${stats.completionRate}% Complete</div>
        `;
    }
}

// Task queue display - optimized with cached stats
function updateTaskQueue() {
    const stats = getTaskStats();

    let html = '';
    // Only show statuses that have tasks
    Object.entries(stats.byStatus).forEach(([status, count]) => {
        if (count > 0) {
            html += `<div class="metric">
                <span class="metric-label">${status.replace('_', ' ').toUpperCase()}</span>
                <span class="metric-value">${count}</span>
            </div>`;
        }
    });

    const container = document.getElementById('taskQueue');
    if (container) {
        container.innerHTML = html || '<p>No tasks in queue</p>';
    }
}

// System resources
function updateSystemResources() {
    const cpuUsage = Math.floor(Math.random() * 40) + 20;
    const memoryUsage = Math.floor(Math.random() * 30) + 40;
    const diskUsage = Math.floor(Math.random() * 20) + 15;

    const container = document.getElementById('systemResources');
    if (container) {
        container.innerHTML = `
            <div class="metric">
                <span class="metric-label">CPU Usage</span>
                <span class="metric-value">${cpuUsage}%</span>
            </div>
            <div class="metric">
                <span class="metric-label">Memory Usage</span>
                <span class="metric-value">${memoryUsage}%</span>
            </div>
            <div class="metric">
                <span class="metric-label">Disk Usage</span>
                <span class="metric-value">${diskUsage}%</span>
            </div>
            <div class="metric">
                <span class="metric-label">Active Processes</span>
                <span class="metric-value">${agents.filter(a => a.status === 'running').length}</span>
            </div>
        `;
    }

    // Update resource chart data
    resourceData.push({
        time: new Date(),
        cpu: cpuUsage,
        memory: memoryUsage,
        disk: diskUsage
    });

    // Keep only last 20 data points
    if (resourceData.length > 20) {
        resourceData.shift();
    }
}

// Active agents display
function updateActiveAgents() {
    const container = document.getElementById('activeAgents');
    if (!container) return;

    if (agents.length === 0) {
        container.innerHTML = '<p>No active agents</p>';
        return;
    }

    const agentCards = agents.map(agent => `
        <div class="card agent-card" onclick="showAgentDetails('${agent.id}')">
            <div class="agent-header">
                <div class="agent-id">${agent.id}</div>
                <div class="agent-status status-${agent.status}">${agent.status}</div>
            </div>
            <div class="agent-task">${agent.task}</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${agent.progress}%"></div>
            </div>
            <div class="progress-text">${agent.progress}% Complete</div>
            ${agent.error ? `<div class="error-message">${agent.error}</div>` : ''}
            <div class="metric">
                <span class="metric-label">Priority</span>
                <span class="metric-value">${agent.priority}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Type</span>
                <span class="metric-value">${agent.type}</span>
            </div>
        </div>
    `).join('');

    container.innerHTML = agentCards;
}

// Timeline display
function updateTimeline() {
    const timelineEvents = agents
        .filter(agent => agent.startTime)
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
        .slice(0, 10);

    const timelineHtml = timelineEvents.map(agent => `
        <div class="timeline-item">
            <div class="timeline-time">${formatTime(agent.startTime)}</div>
            <div class="timeline-content">
                <strong>${agent.id}</strong> ${agent.status === 'completed' ? 'completed' : 'started'}: ${agent.task}
            </div>
        </div>
    `).join('');

    const container = document.getElementById('timeline');
    if (container) {
        container.innerHTML = timelineHtml || '<p>No recent activity</p>';
    }
}

// Logs display
function updateLogs() {
    const container = document.getElementById('logsContainer');
    if (!container) return;

    const logsHtml = logs.slice(-50).reverse().map(log => `
        <div class="log-entry">
            <span class="log-time">${formatTime(log.time)}</span>
            <span class="log-level-${log.level || 'info'}">[${(log.level || 'info').toUpperCase()}]</span>
            <span class="log-message">${log.message}</span>
            ${log.agent ? `<span class="log-agent">(${log.agent})</span>` : ''}
        </div>
    `).join('');

    container.innerHTML = logsHtml || '<p>No logs available</p>';

    if (autoScrollLogs) {
        container.scrollTop = container.scrollHeight;
    }
}

// Update functions called by WebSocket
function updateAgent(agentData) {
    // Handle null or undefined agentData gracefully
    if (!agentData || !agentData.id) {
        console.warn('Invalid agent data:', agentData);
        return;
    }

    const existingAgent = agentsIndex.get(agentData.id);
    const oldStatus = existingAgent ? existingAgent.status : null;
    const oldType = existingAgent ? existingAgent.type : null;

    const existingIndex = agents.findIndex(a => a.id === agentData.id);
    if (existingIndex >= 0) {
        agents[existingIndex] = { ...agents[existingIndex], ...agentData };
    } else {
        agents.push(agentData);
    }

    // Update indexes incrementally
    agentsIndex.set(agentData.id, agents[existingIndex >= 0 ? existingIndex : agents.length - 1]);

    // Update status index
    if (oldStatus && oldStatus !== agentData.status) {
        const oldStatusSet = agentsByStatus.get(oldStatus);
        if (oldStatusSet) {
            oldStatusSet.delete(agentData.id);
            if (oldStatusSet.size === 0) {
                agentsByStatus.delete(oldStatus);
            }
        }
    }

    if (!agentsByStatus.has(agentData.status)) {
        agentsByStatus.set(agentData.status, new Set());
    }
    agentsByStatus.get(agentData.status).add(agentData.id);

    // Update type index
    if (oldType && oldType !== agentData.type) {
        const oldTypeSet = agentsByType.get(oldType);
        if (oldTypeSet) {
            oldTypeSet.delete(agentData.id);
            if (oldTypeSet.size === 0) {
                agentsByType.delete(oldType);
            }
        }
    }

    if (!agentsByType.has(agentData.type)) {
        agentsByType.set(agentData.type, new Set());
    }
    agentsByType.get(agentData.type).add(agentData.id);

    // Invalidate cached stats
    cachedAgentStats = null;

    updateActiveAgents();
    updateAgentStatusOverview();
}

function updateTask(taskData) {
    // Handle null or undefined taskData gracefully
    if (!taskData || !taskData.id) {
        console.warn('Invalid task data:', taskData);
        return;
    }

    const existingTask = tasksIndex.get(taskData.id);
    const oldStatus = existingTask ? existingTask.status : null;
    const oldType = existingTask ? existingTask.type : null;

    const existingIndex = tasks.findIndex(t => t.id === taskData.id);
    if (existingIndex >= 0) {
        tasks[existingIndex] = { ...tasks[existingIndex], ...taskData };
    } else {
        tasks.push(taskData);
    }

    // Update indexes incrementally
    tasksIndex.set(taskData.id, tasks[existingIndex >= 0 ? existingIndex : tasks.length - 1]);

    // Update status index
    if (oldStatus && oldStatus !== taskData.status) {
        const oldStatusSet = tasksByStatus.get(oldStatus);
        if (oldStatusSet) {
            oldStatusSet.delete(taskData.id);
            if (oldStatusSet.size === 0) {
                tasksByStatus.delete(oldStatus);
            }
        }
    }

    if (!tasksByStatus.has(taskData.status)) {
        tasksByStatus.set(taskData.status, new Set());
    }
    tasksByStatus.get(taskData.status).add(taskData.id);

    // Update type index
    if (oldType && oldType !== taskData.type) {
        const oldTypeSet = tasksByType.get(oldType);
        if (oldTypeSet) {
            oldTypeSet.delete(taskData.id);
            if (oldTypeSet.size === 0) {
                tasksByType.delete(oldType);
            }
        }
    }

    if (!tasksByType.has(taskData.type)) {
        tasksByType.set(taskData.type, new Set());
    }
    tasksByType.get(taskData.type).add(taskData.id);

    // Invalidate cached stats
    cachedTaskStats = null;

    updateTaskQueue();
}

function addLogEntry(logData) {
    // Handle null or undefined logData gracefully
    if (!logData) {
        console.warn('Invalid log data:', logData);
        return;
    }

    logs.push(logData);
    if (logs.length > 1000) {
        logs.shift();
    }
    updateLogs();
}

function updateResourceData(resourceData) {
    updateSystemResources();
}

// Utility functions
function formatTime(date) {
    if (!date) return 'N/A';
    if (typeof date === 'string') date = new Date(date);
    return date.toLocaleTimeString();
}

// Event handlers
function toggleTheme() {
    // Sync with current DOM state in case they're out of sync
    if (document.body.className === 'dark' || document.body.className === 'light') {
        currentTheme = document.body.className;
    }
    
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.className = currentTheme;
    
    // Use global localStorage reference for tests
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem('theme', currentTheme);
        } else if (global.localStorage) {
            global.localStorage.setItem('theme', currentTheme);
        } else if (localStorage) {
            localStorage.setItem('theme', currentTheme);
        }
    } catch (e) {
        // localStorage not available or disabled
    }
}

function refreshData() {
    if (websocket && websocket.readyState === 1) { // WebSocket.OPEN
        sendMessage({ type: 'request_status' });
        sendMessage({ type: 'request_metrics' });
        addLogEntry({
            time: new Date(),
            level: 'info',
            message: 'Manual refresh requested',
            agent: 'dashboard'
        });
    } else {
        console.warn('Cannot refresh: WebSocket not connected');
        loadDemoData();
    }
}

// Format duration in seconds to human readable format
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ${seconds%60}s`;
    return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
}

// Connection health check
function performConnectionHealthCheck() {
    if (!websocket) return false;
    
    switch (websocket.readyState) {
        case 0: // WebSocket.CONNECTING
            return 'connecting';
        case 1: // WebSocket.OPEN
            // Check if we've received a heartbeat recently
            const timeSinceHeartbeat = connectionMetrics.lastHeartbeat ? 
                Date.now() - connectionMetrics.lastHeartbeat.getTime() : Infinity;
            
            if (timeSinceHeartbeat > heartbeatInterval_ms * 1.5) {
                return 'unhealthy';
            }
            return 'healthy';
        case 2: // WebSocket.CLOSING
            return 'closing';
        case 3: // WebSocket.CLOSED
            return 'closed';
        default:
            return 'unknown';
    }
}

// Performance monitoring
function updatePerformanceMetrics(performanceData) {
    if (!performanceData) {
        performanceData = {
            connectionUptime: connectionMetrics.connectTime ? 
                Date.now() - connectionMetrics.connectTime.getTime() : 0,
            messagesSent: connectionMetrics.messagesSent,
            messagesReceived: connectionMetrics.messagesReceived,
            reconnectCount: connectionMetrics.reconnectCount,
            lastHeartbeat: connectionMetrics.lastHeartbeat
        };
    }
    
    // Send performance data if connected
    if (websocket && websocket.readyState === 1) {
        sendMessage({
            type: 'performance_metrics',
            data: performanceData,
            timestamp: Date.now()
        });
    }
}

function exportLogs() {
    const logData = logs.map(log =>
        `${formatTime(log.time)} [${log.level.toUpperCase()}] ${log.message} ${log.agent ? `(${log.agent})` : ''}`
    ).join('\n');

    const blob = new Blob([logData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opencode-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Chart initialization
function initializeCharts() {
    const resourceCtx = document.getElementById('resourceChart');
    const taskCtx = document.getElementById('taskDistributionChart');
    
    if (resourceCtx && typeof Chart !== 'undefined') {
        charts.resource = new Chart(resourceCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'CPU %',
                        data: [],
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102,126,234,0.1)',
                        tension: 0.4
                    },
                    {
                        label: 'Memory %',
                        data: [],
                        borderColor: '#764ba2',
                        backgroundColor: 'rgba(118,75,162,0.1)',
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    }
                }
            }
        });
    }

    if (taskCtx && typeof Chart !== 'undefined') {
        charts.taskDistribution = new Chart(taskCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Security', 'Testing', 'Performance', 'Documentation', 'Refactoring'],
                datasets: [{
                    data: [0, 0, 0, 0, 0],
                    backgroundColor: [
                        '#f44336',
                        '#4CAF50',
                        '#2196F3',
                        '#FFC107',
                        '#9c27b0'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }
}

function updateTaskDistributionChart() {
    if (!charts.taskDistribution) return;
    
    const stats = getAgentStats(); // Use cached stats instead of recomputing
    
    const data = [
        stats.byType.security || 0,
        stats.byType.testing || 0,
        stats.byType.performance || 0,
        stats.byType.documentation || 0,
        stats.byType.refactoring || 0
    ];

    charts.taskDistribution.data.datasets[0].data = data;
    charts.taskDistribution.update();
}

// Filter functions - optimized with indexes
function filterAgents() {
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const typeFilter = document.getElementById('typeFilter')?.value || '';
    const searchFilter = document.getElementById('searchFilter')?.value.toLowerCase() || '';

    let filteredAgentIds = new Set();

    // Start with all agents or filtered by status/type using indexes
    if (statusFilter && typeFilter) {
        // Intersection of status and type filters
        const statusAgents = getAgentsByStatus(statusFilter);
        const typeAgents = getAgentsByType(typeFilter);
        filteredAgentIds = new Set([...statusAgents].filter(id => typeAgents.has(id)));
    } else if (statusFilter) {
        filteredAgentIds = new Set(getAgentsByStatus(statusFilter));
    } else if (typeFilter) {
        filteredAgentIds = new Set(getAgentsByType(typeFilter));
    } else {
        // No status/type filter, include all agents
        agents.forEach(agent => filteredAgentIds.add(agent.id));
    }

    // Apply search filter if present
    if (searchFilter) {
        const searchFiltered = new Set();
        filteredAgentIds.forEach(agentId => {
            const agent = getAgentById(agentId);
            if (agent && fuzzyMatch(searchFilter, [
                agent.id, agent.task, agent.error || '', agent.type, agent.priority, agent.status
            ])) {
                searchFiltered.add(agentId);
            }
        });
        filteredAgentIds = searchFiltered;
    }

    // Get actual agent objects for rendering
    const filteredAgents = Array.from(filteredAgentIds).map(id => getAgentById(id)).filter(Boolean);

    const container = document.getElementById('activeAgents');
    if (!container) return;

    if (filteredAgents.length === 0) {
        container.innerHTML = '<p>No agents match the current filters</p>';
        return;
    }

    const agentCards = filteredAgents.map(agent => `
        <div class="card agent-card" onclick="showAgentDetails('${agent.id}')">
            <div class="agent-header">
                <div class="agent-id">${agent.id}</div>
                <div class="agent-status status-${agent.status}">${agent.status}</div>
            </div>
            <div class="agent-task">${agent.task}</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${agent.progress}%"></div>
            </div>
            <div class="progress-text">${agent.progress}% Complete</div>
            ${agent.error ? `<div class="error-message">${agent.error}</div>` : ''}
            <div class="metric">
                <span class="metric-label">Priority</span>
                <span class="metric-value">${agent.priority}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Type</span>
                <span class="metric-value">${agent.type}</span>
            </div>
        </div>
    `).join('');

    container.innerHTML = agentCards;
}

// Modal functions
function showAgentDetails(agentId) {
    const agent = getAgentById(agentId); // O(1) lookup instead of O(n)
    if (!agent) return;

    const agentLogs = logs.filter(log => log.agent === agentId).slice(-20);
    const logHtml = agentLogs.map(log => `
        <div class="log-entry">
            <span class="log-time">${formatTime(log.time)}</span>
            <span class="log-level-${log.level}">[${log.level.toUpperCase()}]</span>
            <span class="log-message">${log.message}</span>
        </div>
    `).join('');

    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const detailModal = document.getElementById('detailModal');
    
    if (modalTitle) modalTitle.textContent = `Agent Details: ${agentId}`;
    if (modalBody) {
        modalBody.innerHTML = `
            <div class="metric">
                <span class="metric-label">Status</span>
                <span class="metric-value status-${agent.status}">${agent.status}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Type</span>
                <span class="metric-value">${agent.type}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Priority</span>
                <span class="metric-value">${agent.priority}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Progress</span>
                <span class="metric-value">${agent.progress}%</span>
            </div>
            <div class="metric">
                <span class="metric-label">Task</span>
                <span class="metric-value">${agent.task}</span>
            </div>
            ${agent.error ? `<div class="error-message">${agent.error}</div>` : ''}
            <h3 style="margin: 20px 0 10px 0;">Recent Logs</h3>
            <div class="logs-container" style="max-height: 300px;">
                ${logHtml || '<p>No logs available for this agent</p>'}
            </div>
        `;
    }

    if (detailModal) detailModal.classList.add('active');
}

function closeModal() {
    const detailModal = document.getElementById('detailModal');
    if (detailModal) detailModal.classList.remove('active');
}

// Enhanced search with fuzzy matching
function fuzzyMatch(searchTerm, searchFields) {
    const lowerSearchTerm = searchTerm.toLowerCase();
    
    for (const field of searchFields) {
        const fieldValue = (field || '').toString().toLowerCase();
        
        // Exact match
        if (fieldValue.includes(lowerSearchTerm)) {
            return true;
        }
        
        // Fuzzy matching with tolerance
        if (fuzzyMatchScore(lowerSearchTerm, fieldValue) > 0.6) {
            return true;
        }
    }
    
    return false;
}

// Simple fuzzy matching algorithm
function fuzzyMatchScore(search, target) {
    if (search === target) return 1.0;
    if (search.length === 0) return 1.0;
    if (target.length === 0) return 0.0;

    let score = 0;
    let searchIndex = 0;
    
    for (let i = 0; i < target.length && searchIndex < search.length; i++) {
        if (target[i] === search[searchIndex]) {
            score++;
            searchIndex++;
        }
    }
    
    return score / search.length;
}

// Date range checking
function checkDateRange(agentDate, fromDate, toDate) {
    if (!fromDate && !toDate) return true;
    if (!agentDate) return !fromDate && !toDate;
    
    const agentDateObj = new Date(agentDate);
    const fromDateObj = fromDate ? new Date(fromDate) : null;
    const toDateObj = toDate ? new Date(toDate) : null;
    
    if (fromDateObj && agentDateObj < fromDateObj) return false;
    if (toDateObj && agentDateObj > new Date(toDateObj.getTime() + 86400000)) return false; // Add one day for inclusive range
    
    return true;
}

// Sorting functionality
function sortAgents(agents, sortType) {
    const sortedAgents = [...agents];
    
    switch (sortType) {
        case 'oldest':
            return sortedAgents.sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0));
        case 'priority-high':
            return sortedAgents.sort((a, b) => {
                const priorityOrder = { high: 3, medium: 2, low: 1 };
                return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
            });
        case 'priority-low':
            return sortedAgents.sort((a, b) => {
                const priorityOrder = { high: 3, medium: 2, low: 1 };
                return (priorityOrder[a.priority] || 0) - (priorityOrder[b.priority] || 0);
            });
        case 'status':
            return sortedAgents.sort((a, b) => {
                const statusOrder = { running: 4, pending: 3, error: 2, blocked: 1, completed: 0 };
                return (statusOrder[b.status] || 0) - (statusOrder[a.status] || 0);
            });
        case 'progress':
            return sortedAgents.sort((a, b) => (b.progress || 0) - (a.progress || 0));
        case 'newest':
        default:
            return sortedAgents.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
    }
}

// Update filter summary
function updateFilterSummary(filteredCount, totalCount) {
    const summaryElement = document.getElementById('filterSummary');
    const filterCountElement = document.getElementById('filterCount');
    const totalCountElement = document.getElementById('totalCount');
    
    if (filterCountElement) filterCountElement.textContent = filteredCount;
    if (totalCountElement) totalCountElement.textContent = totalCount;
    
    // Highlight when filters are active
    if (summaryElement) {
        summaryElement.style.opacity = filteredCount < totalCount ? '1' : '0.8';
    }
}

// Clear all filters
function clearAllFilters() {
    const elements = [
        'statusFilter', 'typeFilter', 'priorityFilter', 'searchFilter', 
        'dateFromFilter', 'dateToFilter'
    ];
    
    elements.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = '';
    });
    
    const sortElement = document.getElementById('sortFilter');
    if (sortElement) sortElement.value = 'newest';
    
    filterAgents();
}

// Export filtered agents to CSV
function exportFilteredAgents() {
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const typeFilter = document.getElementById('typeFilter')?.value || '';
    const priorityFilter = document.getElementById('priorityFilter')?.value || '';
    const searchFilter = document.getElementById('searchFilter')?.value || '';
    
    let filteredAgentIds = new Set();

    // Use optimized filtering logic
    if (statusFilter && typeFilter) {
        const statusAgents = getAgentsByStatus(statusFilter);
        const typeAgents = getAgentsByType(typeFilter);
        filteredAgentIds = new Set([...statusAgents].filter(id => typeAgents.has(id)));
    } else if (statusFilter) {
        filteredAgentIds = new Set(getAgentsByStatus(statusFilter));
    } else if (typeFilter) {
        filteredAgentIds = new Set(getAgentsByType(typeFilter));
    } else {
        agents.forEach(agent => filteredAgentIds.add(agent.id));
    }

    // Apply additional filters
    if (priorityFilter || searchFilter) {
        const finalFiltered = new Set();
        filteredAgentIds.forEach(agentId => {
            const agent = getAgentById(agentId);
            if (agent) {
                const matchesPriority = !priorityFilter || agent.priority === priorityFilter;
                const matchesSearch = !searchFilter || fuzzyMatch(searchFilter.toLowerCase(), [
                    agent.id, agent.task, agent.error || '', agent.type, agent.priority, agent.status
                ]);
                
                if (matchesPriority && matchesSearch) {
                    finalFiltered.add(agentId);
                }
            }
        });
        filteredAgentIds = finalFiltered;
    }
    
    const filteredAgents = Array.from(filteredAgentIds).map(id => getAgentById(id)).filter(Boolean);
    
    const csvData = [
        ['ID', 'Type', 'Status', 'Priority', 'Progress', 'Task', 'Start Time', 'Error'],
        ...filteredAgents.map(agent => [
            agent.id,
            agent.type,
            agent.status,
            agent.priority,
            agent.progress + '%',
            agent.task,
            agent.startTime ? formatTime(agent.startTime) : '',
            agent.error || ''
        ])
    ].map(row => row.join(',')).join('\n');
    
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
        const blob = new Blob([csvData], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `filtered-agents-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    return csvData;
}

// Reset function for test isolation
function resetGlobalState() {
    agents.length = 0;
    tasks.length = 0;
    logs.length = 0;
    resourceData.length = 0;
    currentTheme = 'light';
    autoScrollLogs = true;
    Object.keys(charts).forEach(key => delete charts[key]);
    
    // Clear indexes and caches
    agentsIndex.clear();
    tasksIndex.clear();
    agentsByStatus.clear();
    tasksByStatus.clear();
    agentsByType.clear();
    tasksByType.clear();
    cachedAgentStats = null;
    cachedTaskStats = null;
    lastStatsUpdate = 0;
    
    websocket = null;
    reconnectInterval = null;
    heartbeatInterval = null;
    connectionState = 'disconnected';
    connectionAttempts = 0;
    connectionMetrics = {
        connectTime: null,
        lastHeartbeat: null,
        messagesSent: 0,
        messagesReceived: 0,
        reconnectCount: 0,
        totalDowntime: 0
    };
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initializeWebSocket,
        handleWebSocketMessage,
        updateConnectionStatus,
        loadDemoData,
        updateAllDisplays,
        updateAgentStatusOverview,
        updateTaskQueue,
        updateSystemResources,
        updateActiveAgents,
        updateTimeline,
        updateLogs,
        updateAgent,
        updateTask,
        addLogEntry,
        updateResourceData,
        formatTime,
        toggleTheme,
        refreshData,
        exportLogs,
        initializeCharts,
        updateTaskDistributionChart,
        filterAgents,
        showAgentDetails,
        closeModal,
        fuzzyMatch,
        fuzzyMatchScore,
        checkDateRange,
        sortAgents,
        updateFilterSummary,
        clearAllFilters,
        exportFilteredAgents,
        resetGlobalState,
        rebuildIndexes, // Add rebuildIndexes to exports
        agents,
        tasks,
        logs,
        resourceData,
        currentTheme,
        autoScrollLogs,
        charts
    };
}