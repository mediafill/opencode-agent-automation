const {
  updateTimeline,
  formatTime,
  resetGlobalState,
  agents,
  logs
} = require('../dashboard-functions');

describe('Timeline and UI Interaction Tests', () => {
  beforeEach(() => {
    // Reset all global state
    resetGlobalState();

    document.body.innerHTML = `
      <div id="timeline"></div>
      <div id="agentStatusOverview"></div>
      <div id="logsContainer"></div>
    `;
  });

  describe('updateTimeline', () => {
    test('displays agents with start times in reverse chronological order', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);
      const twoHoursAgo = new Date(now.getTime() - 7200000);

      agents.push(
        {
          id: 'agent_1',
          startTime: twoHoursAgo,
          status: 'completed',
          task: 'First task'
        },
        {
          id: 'agent_2',
          startTime: oneHourAgo,
          status: 'running',
          task: 'Second task'
        },
        {
          id: 'agent_3',
          startTime: now,
          status: 'completed',
          task: 'Third task'
        }
      );

      updateTimeline();

      const container = document.getElementById('timeline');
      const timelineItems = container.querySelectorAll('.timeline-item');

      expect(timelineItems).toHaveLength(3);
      expect(timelineItems[0].innerHTML).toContain('agent_3');
      expect(timelineItems[1].innerHTML).toContain('agent_2');
      expect(timelineItems[2].innerHTML).toContain('agent_1');
    });

    test('shows correct status text for completed vs running agents', () => {
      agents.push(
        {
          id: 'completed_agent',
          startTime: new Date(),
          status: 'completed',
          task: 'Completed task'
        },
        {
          id: 'running_agent',
          startTime: new Date(),
          status: 'running',
          task: 'Running task'
        }
      );

      updateTimeline();

      const container = document.getElementById('timeline');
      expect(container.innerHTML).toContain('completed_agent completed:');
      expect(container.innerHTML).toContain('running_agent started:');
    });

    test('limits timeline to 10 most recent items', () => {
      const now = new Date();

      // Add 15 agents with different start times
      for (let i = 0; i < 15; i++) {
        agents.push({
          id: `agent_${i}`,
          startTime: new Date(now.getTime() - (i * 60000)), // Each 1 minute apart
          status: 'running',
          task: `Task ${i}`
        });
      }

      updateTimeline();

      const container = document.getElementById('timeline');
      const timelineItems = container.querySelectorAll('.timeline-item');

      expect(timelineItems).toHaveLength(10);
    });

    test('filters out agents without start times', () => {
      agents.push(
        {
          id: 'agent_with_time',
          startTime: new Date(),
          status: 'running',
          task: 'Has start time'
        },
        {
          id: 'agent_without_time',
          status: 'pending',
          task: 'No start time'
        },
        {
          id: 'agent_null_time',
          startTime: null,
          status: 'pending',
          task: 'Null start time'
        }
      );

      updateTimeline();

      const container = document.getElementById('timeline');
      expect(container.innerHTML).toContain('agent_with_time');
      expect(container.innerHTML).not.toContain('agent_without_time');
      expect(container.innerHTML).not.toContain('agent_null_time');
    });

    test('displays no activity message when no agents have start times', () => {
      agents.push({
        id: 'agent_1',
        status: 'pending',
        task: 'No start time'
      });

      updateTimeline();

      const container = document.getElementById('timeline');
      expect(container.innerHTML).toContain('No recent activity');
    });

    test('formats timeline times correctly', () => {
      const testDate = new Date('2023-01-01T15:30:00Z');
      agents.push({
        id: 'time_test_agent',
        startTime: testDate,
        status: 'running',
        task: 'Time formatting test'
      });

      updateTimeline();

      const container = document.getElementById('timeline');
      const timeElement = container.querySelector('.timeline-time');

      expect(timeElement).toBeTruthy();
      expect(timeElement.textContent).toBe(formatTime(testDate));
    });
  });

  describe('Timeline Integration with Real-time Updates', () => {
    test('timeline updates when agents are added', () => {
      updateTimeline();

      let container = document.getElementById('timeline');
      expect(container.innerHTML).toContain('No recent activity');

      // Add an agent
      agents.push({
        id: 'new_agent',
        startTime: new Date(),
        status: 'running',
        task: 'New task'
      });

      updateTimeline();

      container = document.getElementById('timeline');
      expect(container.innerHTML).toContain('new_agent');
      expect(container.innerHTML).not.toContain('No recent activity');
    });

    test('timeline reflects agent status changes', () => {
      agents.push({
        id: 'status_change_agent',
        startTime: new Date(),
        status: 'running',
        task: 'Status change test'
      });

      updateTimeline();

      let container = document.getElementById('timeline');
      expect(container.innerHTML).toContain('started:');

      // Change status to completed
      agents[0].status = 'completed';

      updateTimeline();

      container = document.getElementById('timeline');
      expect(container.innerHTML).toContain('completed:');
    });
  });

  describe('Timeline Performance Tests', () => {
    test('handles large numbers of agents efficiently', () => {
      const now = new Date();

      // Add 100 agents
      for (let i = 0; i < 100; i++) {
        agents.push({
          id: `perf_agent_${i}`,
          startTime: new Date(now.getTime() - (i * 1000)),
          status: i % 2 === 0 ? 'completed' : 'running',
          task: `Performance test task ${i}`
        });
      }

      const startTime = Date.now();
      updateTimeline();
      const endTime = Date.now();

      // Should complete quickly even with many agents
      expect(endTime - startTime).toBeLessThan(50);

      // Should still only show 10 items
      const container = document.getElementById('timeline');
      const timelineItems = container.querySelectorAll('.timeline-item');
      expect(timelineItems).toHaveLength(10);
    });

    test('memory usage remains stable with frequent updates', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Simulate many timeline updates
      for (let i = 0; i < 1000; i++) {
        agents.push({
          id: `memory_test_${i}`,
          startTime: new Date(),
          status: 'running',
          task: `Memory test ${i}`
        });

        updateTimeline();

        // Clear agents to simulate real usage pattern
        if (i % 100 === 0) {
          agents.length = 0;
        }
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Memory growth should be reasonable (less than 10MB)
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe('Timeline Error Handling', () => {
    test('handles invalid start time formats gracefully', () => {
      agents.push(
        {
          id: 'invalid_time_1',
          startTime: 'invalid-date-string',
          status: 'running',
          task: 'Invalid time test 1'
        },
        {
          id: 'invalid_time_2',
          startTime: NaN,
          status: 'running',
          task: 'Invalid time test 2'
        },
        {
          id: 'valid_time',
          startTime: new Date(),
          status: 'running',
          task: 'Valid time test'
        }
      );

      expect(() => {
        updateTimeline();
      }).not.toThrow();

      const container = document.getElementById('timeline');
      // Should only show the agent with valid time
      expect(container.innerHTML).toContain('valid_time');
      expect(container.innerHTML).not.toContain('invalid_time_1');
      expect(container.innerHTML).not.toContain('invalid_time_2');
    });

    test('handles missing DOM elements gracefully', () => {
      document.getElementById('timeline').remove();

      expect(() => {
        updateTimeline();
      }).not.toThrow();
    });

    test('handles agents with missing required fields', () => {
      agents.push(
        {
          id: 'incomplete_agent_1',
          startTime: new Date()
          // Missing status and task
        },
        {
          startTime: new Date(),
          status: 'running',
          task: 'Missing ID'
          // Missing id
        },
        {
          id: 'complete_agent',
          startTime: new Date(),
          status: 'running',
          task: 'Complete agent'
        }
      );

      expect(() => {
        updateTimeline();
      }).not.toThrow();

      const container = document.getElementById('timeline');
      // Should handle incomplete data gracefully
      expect(container.innerHTML).toContain('complete_agent');
    });
  });

  describe('Timeline Accessibility', () => {
    test('timeline items contain proper semantic structure', () => {
      agents.push({
        id: 'accessibility_test',
        startTime: new Date(),
        status: 'completed',
        task: 'Accessibility test task'
      });

      updateTimeline();

      const container = document.getElementById('timeline');
      const timelineItem = container.querySelector('.timeline-item');

      expect(timelineItem).toBeTruthy();
      expect(timelineItem.querySelector('.timeline-time')).toBeTruthy();
      expect(timelineItem.querySelector('.timeline-content')).toBeTruthy();
    });

    test('timeline content includes proper text hierarchy', () => {
      agents.push({
        id: 'hierarchy_test_agent',
        startTime: new Date(),
        status: 'running',
        task: 'Text hierarchy test'
      });

      updateTimeline();

      const container = document.getElementById('timeline');
      const timelineContent = container.querySelector('.timeline-content');
      const strongElement = timelineContent.querySelector('strong');

      expect(strongElement).toBeTruthy();
      expect(strongElement.textContent).toContain('hierarchy_test_agent');
    });
  });
});