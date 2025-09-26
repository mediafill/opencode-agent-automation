// Dashboard JavaScript functions extracted from monitor-dashboard.html for testing

// Global variables
let websocket = null;
let reconnectInterval = null;
let agents = [];
let tasks = [];
let logs = [];
let resourceData = [];
let currentTheme = 'light';
let autoScrollLogs = true;
let charts = {};

// WebSocket connection with enhanced error handling
function initializeWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//localhost:8080/ws`;

    try {
        websocket = new WebSocket(wsUrl);

        websocket.onopen = function() {
            updateConnectionStatus('connected', 'Connected');
            console.log('WebSocket connected');
            websocket.send(JSON.stringify({ type: 'request_status' }));
        };

        websocket.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
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
            updateConnectionStatus('disconnected', 'Disconnected');
            console.log('WebSocket disconnected', event);

            if (event.code !== 1000 && !reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    updateConnectionStatus('connecting', 'Reconnecting...');
                    initializeWebSocket();
                }, 5000);
            }
        };

        websocket.onerror = function(error) {
            console.error('WebSocket error:', error);
            updateConnectionStatus('disconnected', 'Connection Error');
            addLogEntry({
                time: new Date(),
                level: 'error',
                message: 'WebSocket connection error',
                agent: 'dashboard'
            });
        };

    } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        updateConnectionStatus('disconnected', 'Failed to Connect');
        addLogEntry({
            time: new Date(),
            level: 'error',
            message: `Failed to initialize WebSocket: ${error.message}`,
            agent: 'dashboard'
        });
        loadDemoData();
    }
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'agent_update':
            updateAgent(data.agent);
            break;
        case 'task_update':
            updateTask(data.task);
            break;
        case 'log_entry':
            addLogEntry(data.log);
            break;
        case 'resource_update':
            updateResourceData(data.resources);
            break;
        case 'full_status':
            agents = data.agents || [];
            tasks = data.tasks || [];
            updateAllDisplays();
            break;
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
    agents = [
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
    ];

    tasks = [
        { id: '1', type: 'security', status: 'in_progress', priority: 'high', description: 'Security audit' },
        { id: '2', type: 'testing', status: 'completed', priority: 'medium', description: 'Unit tests' },
        { id: '3', type: 'performance', status: 'pending', priority: 'high', description: 'Performance optimization' },
        { id: '4', type: 'documentation', status: 'blocked', priority: 'low', description: 'Documentation update' }
    ];

    logs = [
        { time: new Date(), level: 'info', message: 'Security agent started', agent: 'security_agent' },
        { time: new Date(Date.now() - 30000), level: 'warn', message: 'Potential SQL injection vulnerability found', agent: 'security_agent' },
        { time: new Date(Date.now() - 60000), level: 'info', message: 'Testing agent completed successfully', agent: 'testing_agent' },
        { time: new Date(Date.now() - 90000), level: 'error', message: 'Documentation agent failed to parse OpenAPI spec', agent: 'docs_agent' },
        { time: new Date(Date.now() - 120000), level: 'info', message: 'Performance agent queued', agent: 'perf_agent' }
    ];

    updateAllDisplays();
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

// Agent status overview
function updateAgentStatusOverview() {
    const statusCounts = agents.reduce((acc, agent) => {
        acc[agent.status] = (acc[agent.status] || 0) + 1;
        return acc;
    }, {});

    const totalAgents = agents.length;
    const completedTasks = agents.filter(a => a.status === 'completed').length;
    const completionRate = totalAgents > 0 ? Math.round((completedTasks / totalAgents) * 100) : 0;

    const container = document.getElementById('agentStatusOverview');
    if (container) {
        container.innerHTML = `
            <div class="metric">
                <span class="metric-label">Total Agents</span>
                <span class="metric-value">${totalAgents}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Running</span>
                <span class="metric-value">${statusCounts.running || 0}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Completed</span>
                <span class="metric-value">${statusCounts.completed || 0}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Errors</span>
                <span class="metric-value">${statusCounts.error || 0}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Pending</span>
                <span class="metric-value">${statusCounts.pending || 0}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${completionRate}%"></div>
            </div>
            <div class="progress-text">${completionRate}% Complete</div>
        `;
    }
}

// Task queue display
function updateTaskQueue() {
    const tasksByStatus = tasks.reduce((acc, task) => {
        if (!acc[task.status]) acc[task.status] = [];
        acc[task.status].push(task);
        return acc;
    }, {});

    let html = '';
    ['pending', 'in_progress', 'completed', 'blocked'].forEach(status => {
        const statusTasks = tasksByStatus[status] || [];
        if (statusTasks.length > 0) {
            html += `<div class="metric">
                <span class="metric-label">${status.replace('_', ' ').toUpperCase()}</span>
                <span class="metric-value">${statusTasks.length}</span>
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
            <span class="log-level-${log.level}">[${log.level.toUpperCase()}]</span>
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
    const existingIndex = agents.findIndex(a => a.id === agentData.id);
    if (existingIndex >= 0) {
        agents[existingIndex] = { ...agents[existingIndex], ...agentData };
    } else {
        agents.push(agentData);
    }
    updateActiveAgents();
    updateAgentStatusOverview();
}

function updateTask(taskData) {
    const existingIndex = tasks.findIndex(t => t.id === taskData.id);
    if (existingIndex >= 0) {
        tasks[existingIndex] = { ...tasks[existingIndex], ...taskData };
    } else {
        tasks.push(taskData);
    }
    updateTaskQueue();
}

function addLogEntry(logData) {
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
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.className = currentTheme;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('theme', currentTheme);
    }
}

function refreshData() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ type: 'request_status' }));
    } else {
        loadDemoData();
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
    
    const typeCounts = agents.reduce((acc, agent) => {
        acc[agent.type] = (acc[agent.type] || 0) + 1;
        return acc;
    }, {});

    const data = [
        typeCounts.security || 0,
        typeCounts.testing || 0,
        typeCounts.performance || 0,
        typeCounts.documentation || 0,
        typeCounts.refactoring || 0
    ];

    charts.taskDistribution.data.datasets[0].data = data;
    charts.taskDistribution.update();
}

// Filter functions
function filterAgents() {
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const typeFilter = document.getElementById('typeFilter')?.value || '';
    const searchFilter = document.getElementById('searchFilter')?.value.toLowerCase() || '';

    const filteredAgents = agents.filter(agent => {
        const matchesStatus = !statusFilter || agent.status === statusFilter;
        const matchesType = !typeFilter || agent.type === typeFilter;
        const matchesSearch = !searchFilter ||
            agent.id.toLowerCase().includes(searchFilter) ||
            agent.task.toLowerCase().includes(searchFilter);

        return matchesStatus && matchesType && matchesSearch;
    });

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
    const agent = agents.find(a => a.id === agentId);
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
        agents,
        tasks,
        logs,
        resourceData,
        currentTheme,
        autoScrollLogs,
        charts
    };
}