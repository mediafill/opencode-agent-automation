// Test setup configuration
require('@testing-library/jest-dom');

// Add TextEncoder/TextDecoder polyfills for jsdom
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock Chart.js
global.Chart = jest.fn(() => ({
  data: { labels: [], datasets: [] },
  update: jest.fn(),
  destroy: jest.fn()
}));

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    this.send = jest.fn();
    this.close = jest.fn();

    // Simulate connection after a tick
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 0);
  }

  close(code, reason) {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }
}

global.WebSocket = jest.fn().mockImplementation((url) => new MockWebSocket(url));
global.WebSocket.CONNECTING = 0;
global.WebSocket.OPEN = 1;
global.WebSocket.CLOSING = 2;
global.WebSocket.CLOSED = 3;

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'mocked-blob-url');
global.URL.revokeObjectURL = jest.fn();

// Mock canvas getContext for charts
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
  fillRect: jest.fn(),
  clearRect: jest.fn(),
  getImageData: jest.fn(() => ({ data: new Array(4) })),
  putImageData: jest.fn(),
  createImageData: jest.fn(() => []),
  setTransform: jest.fn(),
  drawImage: jest.fn(),
  save: jest.fn(),
  fillText: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  closePath: jest.fn(),
  stroke: jest.fn(),
  translate: jest.fn(),
  scale: jest.fn(),
  rotate: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  measureText: jest.fn(() => ({ width: 0 })),
  transform: jest.fn(),
  rect: jest.fn(),
  clip: jest.fn(),
}));

// Global test setup and teardown
beforeEach(() => {
  // Reset all mocks
  jest.clearAllMocks();

  // Reset console spies if they exist
  if (global.console.error && global.console.error.mockRestore) {
    global.console.error.mockRestore();
  }
  if (global.console.log && global.console.log.mockRestore) {
    global.console.log.mockRestore();
  }
  if (global.console.warn && global.console.warn.mockRestore) {
    global.console.warn.mockRestore();
  }

  // Mock console methods for each test
  global.console.error = jest.fn();
  global.console.log = jest.fn();
  global.console.warn = jest.fn();

  // Clear DOM
  document.body.innerHTML = '';

  // Reset localStorage mock
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
});

afterEach(() => {
  // Restore console methods
  if (global.console.error && global.console.error.mockRestore) {
    global.console.error.mockRestore();
  }
  if (global.console.log && global.console.log.mockRestore) {
    global.console.log.mockRestore();
  }
  if (global.console.warn && global.console.warn.mockRestore) {
    global.console.warn.mockRestore();
  }
});