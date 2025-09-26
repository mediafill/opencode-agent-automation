/**
 * Enhanced Filtering Functionality Tests
 * Tests all the new filtering features added to the dashboard
 */

const {
  resetGlobalState,
  fuzzyMatch,
  fuzzyMatchScore,
  checkDateRange,
  sortAgents,
  updateFilterSummary,
  clearAllFilters,
  exportFilteredAgents,
  agents,
  tasks,
  logs
} = require('../dashboard-functions');

// Mock DOM environment
const { JSDOM } = require('jsdom');
const fs = require('fs');

let dom;
let document;
let window;

beforeEach(() => {
  // Create a minimal DOM environment for testing
  dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
    <body>
      <select id="statusFilter"></select>
      <select id="typeFilter"></select>
      <select id="priorityFilter"></select>
      <input id="searchFilter" />
      <input id="dateFromFilter" type="date" />
      <input id="dateToFilter" type="date" />
      <select id="sortFilter"></select>
      <div id="filterSummary">
        <span id="filterCount">0</span> of <span id="totalCount">0</span> agents
      </div>
      <div id="activeAgents"></div>
    </body>
    </html>
  `);
  
  document = dom.window.document;
  window = dom.window;
  global.document = document;
  global.window = window;
  global.Blob = window.Blob;
  global.URL = window.URL;
  
  // Reset state before each test
  resetGlobalState();
});

afterEach(() => {
  resetGlobalState();
});

describe('Enhanced Filtering Functionality Tests', () => {
  
  describe('Fuzzy Matching Algorithm', () => {
    test('fuzzyMatchScore calculates correct scores for identical strings', () => {
      expect(fuzzyMatchScore('test', 'test')).toBe(1.0);
      expect(fuzzyMatchScore('security', 'security')).toBe(1.0);
    });

    test('fuzzyMatchScore handles partial matches', () => {
      expect(fuzzyMatchScore('sec', 'security')).toBe(1.0);
      expect(fuzzyMatchScore('test', 'testing')).toBe(1.0);
      expect(fuzzyMatchScore('perf', 'performance')).toBeGreaterThan(0.5);
    });

    test('fuzzyMatchScore handles mismatches', () => {
      expect(fuzzyMatchScore('xyz', 'security')).toBe(0);
      expect(fuzzyMatchScore('test', 'performance')).toBeLessThan(0.5);
    });

    test('fuzzyMatch works with multiple search fields', () => {
      const searchFields = ['security_agent', 'security audit task', 'high', 'running'];
      
      expect(fuzzyMatch('security', searchFields)).toBe(true);
      expect(fuzzyMatch('audit', searchFields)).toBe(true);
      expect(fuzzyMatch('high', searchFields)).toBe(true);
      expect(fuzzyMatch('xyz', searchFields)).toBe(false);
    });

    test('fuzzyMatch is case insensitive', () => {
      const searchFields = ['Security_Agent', 'HIGH_PRIORITY'];
      
      expect(fuzzyMatch('security', searchFields)).toBe(true);
      expect(fuzzyMatch('HIGH', searchFields)).toBe(true);
      expect(fuzzyMatch('agent', searchFields)).toBe(true);
    });
  });

  describe('Date Range Filtering', () => {
    test('checkDateRange returns true when no filters applied', () => {
      const agentDate = new Date('2023-01-15');
      expect(checkDateRange(agentDate, null, null)).toBe(true);
      expect(checkDateRange(agentDate, '', '')).toBe(true);
    });

    test('checkDateRange filters by from date only', () => {
      const fromDate = '2023-01-10';
      
      expect(checkDateRange(new Date('2023-01-15'), fromDate, null)).toBe(true);
      expect(checkDateRange(new Date('2023-01-05'), fromDate, null)).toBe(false);
      expect(checkDateRange(new Date('2023-01-10'), fromDate, null)).toBe(true);
    });

    test('checkDateRange filters by to date only', () => {
      const toDate = '2023-01-20';
      
      expect(checkDateRange(new Date('2023-01-15'), null, toDate)).toBe(true);
      expect(checkDateRange(new Date('2023-01-25'), null, toDate)).toBe(false);
      expect(checkDateRange(new Date('2023-01-20'), null, toDate)).toBe(true);
    });

    test('checkDateRange filters by date range', () => {
      const fromDate = '2023-01-10';
      const toDate = '2023-01-20';
      
      expect(checkDateRange(new Date('2023-01-15'), fromDate, toDate)).toBe(true);
      expect(checkDateRange(new Date('2023-01-05'), fromDate, toDate)).toBe(false);
      expect(checkDateRange(new Date('2023-01-25'), fromDate, toDate)).toBe(false);
      expect(checkDateRange(new Date('2023-01-10'), fromDate, toDate)).toBe(true);
      expect(checkDateRange(new Date('2023-01-20'), fromDate, toDate)).toBe(true);
    });

    test('checkDateRange handles null agent date', () => {
      expect(checkDateRange(null, '2023-01-10', '2023-01-20')).toBe(false);
      expect(checkDateRange(null, null, null)).toBe(true);
    });
  });

  describe('Sorting Functionality', () => {
    let testAgents;

    beforeEach(() => {
      testAgents = [
        {
          id: 'agent1',
          startTime: new Date('2023-01-10'),
          priority: 'high',
          status: 'running',
          progress: 75
        },
        {
          id: 'agent2',
          startTime: new Date('2023-01-15'),
          priority: 'low',
          status: 'completed',
          progress: 100
        },
        {
          id: 'agent3',
          startTime: new Date('2023-01-05'),
          priority: 'medium',
          status: 'error',
          progress: 25
        }
      ];
    });

    test('sortAgents by newest (default)', () => {
      const sorted = sortAgents(testAgents, 'newest');
      expect(sorted[0].id).toBe('agent2'); // 2023-01-15
      expect(sorted[1].id).toBe('agent1'); // 2023-01-10
      expect(sorted[2].id).toBe('agent3'); // 2023-01-05
    });

    test('sortAgents by oldest', () => {
      const sorted = sortAgents(testAgents, 'oldest');
      expect(sorted[0].id).toBe('agent3'); // 2023-01-05
      expect(sorted[1].id).toBe('agent1'); // 2023-01-10
      expect(sorted[2].id).toBe('agent2'); // 2023-01-15
    });

    test('sortAgents by priority high to low', () => {
      const sorted = sortAgents(testAgents, 'priority-high');
      expect(sorted[0].priority).toBe('high');
      expect(sorted[1].priority).toBe('medium');
      expect(sorted[2].priority).toBe('low');
    });

    test('sortAgents by priority low to high', () => {
      const sorted = sortAgents(testAgents, 'priority-low');
      expect(sorted[0].priority).toBe('low');
      expect(sorted[1].priority).toBe('medium');
      expect(sorted[2].priority).toBe('high');
    });

    test('sortAgents by status priority', () => {
      const sorted = sortAgents(testAgents, 'status');
      expect(sorted[0].status).toBe('running'); // Highest priority
      expect(sorted[1].status).toBe('error');
      expect(sorted[2].status).toBe('completed'); // Lowest priority
    });

    test('sortAgents by progress', () => {
      const sorted = sortAgents(testAgents, 'progress');
      expect(sorted[0].progress).toBe(100);
      expect(sorted[1].progress).toBe(75);
      expect(sorted[2].progress).toBe(25);
    });
  });

  describe('Filter Summary Updates', () => {
    test('updateFilterSummary updates DOM elements correctly', () => {
      updateFilterSummary(5, 10);
      
      const filterCount = document.getElementById('filterCount');
      const totalCount = document.getElementById('totalCount');
      
      expect(filterCount.textContent).toBe('5');
      expect(totalCount.textContent).toBe('10');
    });

    test('updateFilterSummary handles equal counts', () => {
      updateFilterSummary(10, 10);
      
      const filterCount = document.getElementById('filterCount');
      const totalCount = document.getElementById('totalCount');
      const summary = document.getElementById('filterSummary');
      
      expect(filterCount.textContent).toBe('10');
      expect(totalCount.textContent).toBe('10');
      expect(summary.style.opacity).toBe('0.8'); // No filters active
    });

    test('updateFilterSummary highlights when filters are active', () => {
      updateFilterSummary(3, 10);
      
      const summary = document.getElementById('filterSummary');
      expect(summary.style.opacity).toBe('1'); // Filters are active
    });
  });

  describe('Clear All Filters', () => {
    test('clearAllFilters resets all filter elements', () => {
      // Set some values
      document.getElementById('statusFilter').value = 'running';
      document.getElementById('typeFilter').value = 'security';
      document.getElementById('priorityFilter').value = 'high';
      document.getElementById('searchFilter').value = 'test';
      document.getElementById('dateFromFilter').value = '2023-01-01';
      document.getElementById('dateToFilter').value = '2023-01-31';
      document.getElementById('sortFilter').value = 'oldest';

      clearAllFilters();

      expect(document.getElementById('statusFilter').value).toBe('');
      expect(document.getElementById('typeFilter').value).toBe('');
      expect(document.getElementById('priorityFilter').value).toBe('');
      expect(document.getElementById('searchFilter').value).toBe('');
      expect(document.getElementById('dateFromFilter').value).toBe('');
      expect(document.getElementById('dateToFilter').value).toBe('');
      expect(document.getElementById('sortFilter').value).toBe('newest');
    });

    test('clearAllFilters handles missing elements gracefully', () => {
      // Remove some elements
      document.getElementById('statusFilter').remove();
      document.getElementById('typeFilter').remove();

      expect(() => clearAllFilters()).not.toThrow();
    });
  });

  describe('CSV Export Functionality', () => {
    beforeEach(() => {
      // Add test agents
      agents.push(
        {
          id: 'security_agent_1',
          type: 'security',
          status: 'running',
          priority: 'high',
          progress: 75,
          task: 'Security audit',
          startTime: new Date('2023-01-15'),
          error: null
        },
        {
          id: 'testing_agent_1',
          type: 'testing',
          status: 'completed',
          priority: 'medium',
          progress: 100,
          task: 'Unit testing',
          startTime: new Date('2023-01-10'),
          error: null
        },
        {
          id: 'error_agent_1',
          type: 'performance',
          status: 'error',
          priority: 'low',
          progress: 25,
          task: 'Performance optimization',
          startTime: new Date('2023-01-12'),
          error: 'Connection timeout'
        }
      );
    });

    test('exportFilteredAgents returns CSV data', () => {
      const csvData = exportFilteredAgents();
      
      expect(csvData).toContain('ID,Type,Status,Priority,Progress,Task,Start Time,Error');
      expect(csvData).toContain('security_agent_1,security,running,high,75%');
      expect(csvData).toContain('testing_agent_1,testing,completed,medium,100%');
      expect(csvData).toContain('error_agent_1,performance,error,low,25%');
    });

    test('exportFilteredAgents respects status filter', () => {
      document.getElementById('statusFilter').value = 'completed';
      
      const csvData = exportFilteredAgents();
      
      expect(csvData).toContain('testing_agent_1');
      expect(csvData).not.toContain('security_agent_1');
      expect(csvData).not.toContain('error_agent_1');
    });

    test('exportFilteredAgents respects type filter', () => {
      document.getElementById('typeFilter').value = 'security';
      
      const csvData = exportFilteredAgents();
      
      expect(csvData).toContain('security_agent_1');
      expect(csvData).not.toContain('testing_agent_1');
      expect(csvData).not.toContain('error_agent_1');
    });

    test('exportFilteredAgents respects search filter', () => {
      document.getElementById('searchFilter').value = 'audit';
      
      const csvData = exportFilteredAgents();
      
      expect(csvData).toContain('security_agent_1'); // Has "Security audit" task
      expect(csvData).not.toContain('testing_agent_1');
      expect(csvData).not.toContain('error_agent_1');
    });

    test('exportFilteredAgents handles empty filter results', () => {
      document.getElementById('statusFilter').value = 'nonexistent';
      
      const csvData = exportFilteredAgents();
      
      // Should only contain header row
      const lines = csvData.split('\n').filter(line => line.trim());
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('ID,Type,Status,Priority,Progress,Task,Start Time,Error');
    });

    test('exportFilteredAgents includes error messages', () => {
      document.getElementById('statusFilter').value = 'error';
      
      const csvData = exportFilteredAgents();
      
      expect(csvData).toContain('Connection timeout');
    });
  });

  describe('Multi-Criteria Filtering Integration', () => {
    beforeEach(() => {
      agents.push(
        {
          id: 'security_high_running',
          type: 'security',
          status: 'running',
          priority: 'high',
          progress: 75,
          task: 'Security audit for payment system',
          startTime: new Date('2023-01-15'),
          error: null
        },
        {
          id: 'security_high_completed',
          type: 'security',
          status: 'completed',
          priority: 'high',
          progress: 100,
          task: 'Security review completed',
          startTime: new Date('2023-01-10'),
          error: null
        },
        {
          id: 'testing_medium_running',
          type: 'testing',
          status: 'running',
          priority: 'medium',
          progress: 50,
          task: 'Unit test coverage analysis',
          startTime: new Date('2023-01-12'),
          error: null
        }
      );
    });

    test('multi-criteria filtering works with status + priority', () => {
      document.getElementById('statusFilter').value = 'running';
      document.getElementById('priorityFilter').value = 'high';
      
      const csvData = exportFilteredAgents();
      
      expect(csvData).toContain('security_high_running');
      expect(csvData).not.toContain('security_high_completed'); // Wrong status
      expect(csvData).not.toContain('testing_medium_running'); // Wrong priority
    });

    test('multi-criteria filtering works with type + search', () => {
      document.getElementById('typeFilter').value = 'security';
      document.getElementById('searchFilter').value = 'audit';
      
      const csvData = exportFilteredAgents();
      
      expect(csvData).toContain('security_high_running'); // Matches type + has "audit" in task
      expect(csvData).not.toContain('security_high_completed'); // No "audit" in task
      expect(csvData).not.toContain('testing_medium_running'); // Wrong type
    });

    test('multi-criteria filtering with all filters', () => {
      document.getElementById('statusFilter').value = 'running';
      document.getElementById('typeFilter').value = 'security';
      document.getElementById('priorityFilter').value = 'high';
      document.getElementById('searchFilter').value = 'payment';
      
      const csvData = exportFilteredAgents();
      
      expect(csvData).toContain('security_high_running'); // Matches all criteria
      expect(csvData).not.toContain('security_high_completed'); // Wrong status
      expect(csvData).not.toContain('testing_medium_running'); // Wrong type and priority
    });
  });

  describe('Performance and Edge Cases', () => {
    test('fuzzyMatch handles empty search terms', () => {
      expect(fuzzyMatch('', ['test', 'security'])).toBe(true);
      expect(fuzzyMatch(' ', ['test', 'security'])).toBe(true);
    });

    test('fuzzyMatch handles empty search fields', () => {
      expect(fuzzyMatch('test', [])).toBe(false);
      expect(fuzzyMatch('test', ['', null, undefined])).toBe(false);
    });

    test('sortAgents handles missing properties', () => {
      const agentsWithMissingProps = [
        { id: 'agent1' }, // Missing all sort properties
        { id: 'agent2', priority: 'high', startTime: new Date() },
        { id: 'agent3', status: 'running', progress: 50 }
      ];

      expect(() => sortAgents(agentsWithMissingProps, 'priority-high')).not.toThrow();
      expect(() => sortAgents(agentsWithMissingProps, 'newest')).not.toThrow();
      expect(() => sortAgents(agentsWithMissingProps, 'status')).not.toThrow();
      expect(() => sortAgents(agentsWithMissingProps, 'progress')).not.toThrow();
    });

    test('checkDateRange handles invalid date formats', () => {
      expect(checkDateRange('invalid date', '2023-01-10', '2023-01-20')).toBe(false);
      expect(checkDateRange(new Date('2023-01-15'), 'invalid', '2023-01-20')).toBe(true);
      expect(checkDateRange(new Date('2023-01-15'), '2023-01-10', 'invalid')).toBe(true);
    });

    test('exportFilteredAgents handles large datasets efficiently', () => {
      // Add 1000 agents
      for (let i = 0; i < 1000; i++) {
        agents.push({
          id: `agent_${i}`,
          type: i % 2 === 0 ? 'security' : 'testing',
          status: i % 3 === 0 ? 'completed' : 'running',
          priority: i % 4 === 0 ? 'high' : 'medium',
          progress: Math.floor(Math.random() * 100),
          task: `Task ${i}`,
          startTime: new Date(),
          error: null
        });
      }

      const start = performance.now();
      const csvData = exportFilteredAgents();
      const end = performance.now();

      expect(end - start).toBeLessThan(100); // Should complete in under 100ms
      expect(csvData.split('\n')).toHaveLength(1004); // Header + 1000 agents + 3 original + empty line
    });
  });
});
