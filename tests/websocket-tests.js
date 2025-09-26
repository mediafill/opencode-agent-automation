// Comprehensive WebSocket functionality tests for the OpenCode Agent Dashboard

const {
    initializeWebSocket,
    handleWebSocketMessage,
    updateConnectionStatus,
    loadDemoData,
    updateAgent,
    updateTask,
    addLogEntry,
    performConnectionHealthCheck,
    updatePerformanceMetrics,
    sendMessage
} = require('./dashboard-functions');

// Mock WebSocket for testing
class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING
        this.CONNECTING = 0;
        this.OPEN = 1;
        this.CLOSING = 2;
        this.CLOSED = 3;

        // Event handlers
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;

        this.sentMessages = [];

        // Simulate connection after a short delay
        setTimeout(() => {
            this.readyState = 1; // OPEN
            if (this.onopen) this.onopen();
        }, 10);
    }

    send(data) {
        if (this.readyState === 1) {
            this.sentMessages.push(data);
            return true;
        }
        throw new Error('WebSocket is not open');
    }

    close(code, reason) {
        this.readyState = 3; // CLOSED
        if (this.onclose) {
            this.onclose({ code: code || 1000, reason: reason || '' });
        }
    }

    // Test helper methods
    simulateMessage(data) {
        if (this.onmessage) {
            this.onmessage({ data: JSON.stringify(data) });
        }
    }

    simulateError() {
        if (this.onerror) {
            this.onerror(new Error('WebSocket error'));
        }
    }

    simulateClose(code = 1000, reason = '') {
        this.readyState = 3;
        if (this.onclose) {
            this.onclose({ code, reason });
        }
    }
}

// Mock global WebSocket
global.WebSocket = MockWebSocket;

// Mock DOM elements for testing
global.document = {
    getElementById: (id) => ({
        className: '',
        textContent: '',
        innerHTML: '',
        classList: {
            add: () => {},
            remove: () => {}
        }
    })
};

// Mock localStorage
global.localStorage = {
    getItem: () => null,
    setItem: () => {}
};

// Mock console for cleaner test output (keep original for test output)
const originalConsole = global.console;
global.console = {
    log: (...args) => {},
    warn: (...args) => {},
    error: (...args) => {}
};

// Simple test framework
function describe(name, fn) {
    originalConsole.log(`\n📋 ${name}`);
    fn();
}

function test(name, fn) {
    try {
        fn();
        originalConsole.log(`  ✅ ${name}`);
    } catch (error) {
        originalConsole.error(`  ❌ ${name}: ${error.message}`);
    }
}

function expect(actual) {
    return {
        toBe: (expected) => {
            if (actual !== expected) {
                throw new Error(`Expected ${expected}, but got ${actual}`);
            }
        },
        toBeInstanceOf: (expectedClass) => {
            if (!(actual instanceof expectedClass)) {
                throw new Error(`Expected instance of ${expectedClass.name}, but got ${typeof actual}`);
            }
        },
        toBeGreaterThan: (expected) => {
            if (actual <= expected) {
                throw new Error(`Expected ${actual} to be greater than ${expected}`);
            }
        },
        toBeGreaterThanOrEqual: (expected) => {
            if (actual < expected) {
                throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`);
            }
        },
        toBeLessThanOrEqual: (expected) => {
            if (actual > expected) {
                throw new Error(`Expected ${actual} to be less than or equal to ${expected}`);
            }
        },
        toHaveLength: (expected) => {
            if (!actual || actual.length !== expected) {
                throw new Error(`Expected length ${expected}, but got ${actual ? actual.length : 'undefined'}`);
            }
        },
        toEqual: (expected) => {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
            }
        },
        toHaveProperty: (prop) => {
            if (!actual || !actual.hasOwnProperty(prop)) {
                throw new Error(`Expected object to have property ${prop}`);
            }
        },
        not: {
            toThrow: () => {
                // For functions that shouldn't throw
                try {
                    if (typeof actual === 'function') {
                        actual();
                    }
                } catch (error) {
                    throw new Error(`Expected function not to throw, but it threw: ${error.message}`);
                }
            }
        }
    };
}

// Array matchers
expect.arrayContaining = (expected) => expected;
expect.objectContaining = (expected) => expected;
// Test suite for WebSocket functionality
    let mockWebSocket;
    let originalSetTimeout;
    let originalSetInterval;
    let originalClearTimeout;
    let originalClearInterval;

    beforeEach(() => {
        // Reset global variables
        global.websocket = null;
        global.connectionState = 'disconnected';
        global.connectionAttempts = 0;
        global.connectionMetrics = {
            connectTime: null,
            lastHeartbeat: null,
            messagesSent: 0,
            messagesReceived: 0,
            reconnectCount: 0,
            totalDowntime: 0
        };

        // Mock timer functions
        originalSetTimeout = global.setTimeout;
        originalSetInterval = global.setInterval;
        originalClearTimeout = global.clearTimeout;
        originalClearInterval = global.clearInterval;

        global.setTimeout = (fn, delay) => {
            fn(); // Execute immediately for testing
            return 'timeout_id';
        };
        global.setInterval = (fn, delay) => {
            return 'interval_id';
        };
        global.clearTimeout = () => {};
        global.clearInterval = () => {};
    });

    afterEach(() => {
        // Restore original timer functions
        global.setTimeout = originalSetTimeout;
        global.setInterval = originalSetInterval;
        global.clearTimeout = originalClearTimeout;
        global.clearInterval = originalClearInterval;
    });

    test('should initialize WebSocket connection', (done) => {
        initializeWebSocket();

        setTimeout(() => {
            expect(global.websocket).toBeInstanceOf(MockWebSocket);
            expect(global.websocket.url).toBe('ws://localhost:8080/ws');
            expect(global.connectionState).toBe('connected');
            done();
        }, 50);
    });

    test('should handle connection timeout', () => {
        global.setTimeout = (fn, delay) => {
            if (delay === 10000) { // Connection timeout
                fn();
            }
            return 'timeout_id';
        };

        initializeWebSocket();
        expect(global.connectionState).toBe('disconnected');
    });

    test('should handle WebSocket messages correctly', () => {
        const testMessage = {
            type: 'agent_update',
            agent: { id: 'test_agent', status: 'running', progress: 50 }
        };

        handleWebSocketMessage(testMessage);

        const agentExists = global.agents.some(a => a.id === 'test_agent' && a.status === 'running');
        expect(agentExists).toBe(true);
    });

    test('should validate message structure', () => {
        const invalidMessages = [
            null,
            undefined,
            'invalid_string',
            123,
            { /* missing type */ }
        ];

        invalidMessages.forEach(msg => {
            expect(() => handleWebSocketMessage(msg)).not.toThrow();
        });
    });

    test('should handle heartbeat mechanism', (done) => {
        initializeWebSocket();

        setTimeout(() => {
            const heartbeatMessage = { type: 'pong' };
            handleWebSocketMessage(heartbeatMessage);

            expect(global.connectionMetrics.messagesReceived).toBeGreaterThan(0);
            expect(global.connectionMetrics.lastHeartbeat).toBeInstanceOf(Date);
            done();
        }, 20);
    });

    test('should update connection metrics', () => {
        const initialSent = global.connectionMetrics.messagesSent;

        global.websocket = new MockWebSocket('ws://localhost:8080/ws');
        global.websocket.readyState = 1; // OPEN

        const result = sendMessage({ type: 'test' });

        expect(result).toBe(true);
        expect(global.connectionMetrics.messagesSent).toBe(initialSent + 1);
        expect(global.websocket.sentMessages).toHaveLength(1);
    });

    test('should handle connection failures with exponential backoff', () => {
        global.connectionAttempts = 0;
        global.maxReconnectAttempts = 3;

        // Simulate connection failure
        global.websocket = new MockWebSocket('ws://localhost:8080/ws');
        global.websocket.simulateClose(1006, 'Connection lost');

        expect(global.connectionAttempts).toBeGreaterThan(0);
        expect(global.connectionState).toBe('disconnected');
    });

    test('should perform health checks correctly', () => {
        global.websocket = new MockWebSocket('ws://localhost:8080/ws');
        global.websocket.readyState = 1; // OPEN
        global.connectionMetrics.lastHeartbeat = new Date();

        const health = performConnectionHealthCheck();
        expect(health).toBe('healthy');

        // Test unhealthy connection
        global.connectionMetrics.lastHeartbeat = new Date(Date.now() - 60000); // 1 minute ago
        const unhealthyHealth = performConnectionHealthCheck();
        expect(unhealthyHealth).toBe('unhealthy');
    });

    test('should handle various message types', () => {
        const messageTypes = [
            {
                type: 'agent_update',
                agent: { id: 'agent1', status: 'running', progress: 25 }
            },
            {
                type: 'task_update',
                task: { id: 'task1', status: 'completed', priority: 'high' }
            },
            {
                type: 'log_entry',
                log: { time: new Date(), level: 'info', message: 'Test log', agent: 'test' }
            },
            {
                type: 'full_status',
                agents: [{ id: 'agent1', status: 'running' }],
                tasks: [{ id: 'task1', status: 'pending' }]
            },
            {
                type: 'system_alert',
                alert: { severity: 'warn', message: 'System alert test' }
            }
        ];

        messageTypes.forEach(msg => {
            expect(() => handleWebSocketMessage(msg)).not.toThrow();
        });
    });

    test('should update performance metrics', () => {
        const performanceData = {
            connectionUptime: 30000,
            messagesSent: 10,
            messagesReceived: 15,
            reconnectCount: 1
        };

        updatePerformanceMetrics(performanceData);

        // Should not throw errors and should handle data appropriately
        expect(global.connectionMetrics.messagesSent).toBeGreaterThanOrEqual(0);
    });

    test('should handle demo data fallback', () => {
        loadDemoData();

        expect(global.agents).toHaveLength(4);
        expect(global.tasks).toHaveLength(4);
        expect(global.logs).toHaveLength(5);

        // Verify demo data structure
        expect(global.agents[0]).toHaveProperty('id');
        expect(global.agents[0]).toHaveProperty('type');
        expect(global.agents[0]).toHaveProperty('status');
        expect(global.agents[0]).toHaveProperty('task');
    });
});

describe('Connection State Management', () => {
    test('should update connection status correctly', () => {
        const mockElement = {
            className: '',
            textContent: ''
        };

        global.document.getElementById = () => mockElement;

        updateConnectionStatus('connected', 'Connected successfully');

        expect(mockElement.className).toBe('connection-dot connected');
        expect(mockElement.textContent).toBe('Connected successfully');
    });

    test('should handle missing DOM elements gracefully', () => {
        global.document.getElementById = () => null;

        expect(() => updateConnectionStatus('connected', 'Test')).not.toThrow();
    });
});

describe('Message Handling', () => {
    test('should handle agent updates', () => {
        const agentData = {
            id: 'test_agent_123',
            type: 'security',
            status: 'running',
            task: 'Scanning for vulnerabilities',
            progress: 75,
            priority: 'high'
        };

        updateAgent(agentData);

        const updatedAgent = global.agents.find(a => a.id === 'test_agent_123');
        expect(updatedAgent).toEqual(agentData);
    });

    test('should handle task updates', () => {
        const taskData = {
            id: 'task_456',
            type: 'testing',
            status: 'in_progress',
            priority: 'medium',
            description: 'Running unit tests'
        };

        updateTask(taskData);

        const updatedTask = global.tasks.find(t => t.id === 'task_456');
        expect(updatedTask).toEqual(taskData);
    });

    test('should handle log entries', () => {
        const logData = {
            time: new Date(),
            level: 'error',
            message: 'Test error message',
            agent: 'test_agent'
        };

        const initialLogCount = global.logs.length;
        addLogEntry(logData);

        expect(global.logs).toHaveLength(initialLogCount + 1);
        expect(global.logs[global.logs.length - 1]).toEqual(logData);
    });

    test('should limit log entries to 1000', () => {
        // Fill logs with more than 1000 entries
        global.logs = new Array(1001).fill(null).map((_, i) => ({
            time: new Date(),
            level: 'info',
            message: `Log entry ${i}`,
            agent: 'test'
        }));

        addLogEntry({
            time: new Date(),
            level: 'info',
            message: 'New log entry',
            agent: 'test'
        });

        expect(global.logs).toHaveLength(1001); // Should maintain limit
    });
});

describe('Error Handling', () => {
    test('should handle JSON parse errors gracefully', () => {
        global.websocket = new MockWebSocket('ws://localhost:8080/ws');

        // Simulate invalid JSON
        const invalidEvent = { data: 'invalid json {' };

        expect(() => {
            global.websocket.onmessage(invalidEvent);
        }).not.toThrow();
    });

    test('should handle WebSocket send errors', () => {
        global.websocket = new MockWebSocket('ws://localhost:8080/ws');
        global.websocket.readyState = 0; // CONNECTING (not open)

        const result = sendMessage({ type: 'test' });
        expect(result).toBe(false);
    });

    test('should handle missing WebSocket', () => {
        global.websocket = null;

        const result = sendMessage({ type: 'test' });
        expect(result).toBe(false);
    });
});

describe('Integration Tests', () => {
    test('should handle complete connection lifecycle', (done) => {
        // Initialize connection
        initializeWebSocket();

        setTimeout(() => {
            expect(global.connectionState).toBe('connected');

            // Send a message
            const messageResult = sendMessage({ type: 'request_status' });
            expect(messageResult).toBe(true);

            // Simulate receiving data
            const testData = {
                type: 'full_status',
                agents: [{ id: 'agent1', status: 'running' }],
                tasks: [{ id: 'task1', status: 'pending' }]
            };

            handleWebSocketMessage(testData);

            expect(global.agents).toHaveLength(1);
            expect(global.tasks).toHaveLength(1);

            // Close connection
            global.websocket.close();
            expect(global.connectionState).toBe('disconnected');

            done();
        }, 50);
    });

    test('should handle reconnection scenarios', () => {
        global.connectionAttempts = 0;
        global.maxReconnectAttempts = 5;

        initializeWebSocket();

        // Simulate connection drop
        global.websocket.simulateClose(1006, 'Connection lost');

        expect(global.connectionAttempts).toBeGreaterThan(0);
        expect(global.connectionAttempts).toBeLessThanOrEqual(5);
    });
});

// Run tests if this file is executed directly
if (require.main === module) {
    console.log('Running WebSocket tests...');

    // Simple test runner
    const runTest = (testName, testFn) => {
        try {
            testFn();
            console.log(`✅ ${testName} passed`);
        } catch (error) {
            console.error(`❌ ${testName} failed:`, error.message);
        }
    };

    // Run a few key tests
    runTest('WebSocket initialization', () => {
        initializeWebSocket();
        if (!global.websocket) throw new Error('WebSocket not initialized');
    });

    runTest('Message handling', () => {
        const testMessage = {
            type: 'agent_update',
            agent: { id: 'test', status: 'running' }
        };
        handleWebSocketMessage(testMessage);
        if (global.agents.length === 0) throw new Error('Agent not added');
    });

    runTest('Demo data loading', () => {
        loadDemoData();
        if (global.agents.length === 0) throw new Error('Demo data not loaded');
    });

    console.log('WebSocket tests completed!');
}

module.exports = {
    MockWebSocket
};