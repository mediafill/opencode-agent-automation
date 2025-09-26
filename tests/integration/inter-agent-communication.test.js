const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");

describe("Inter-Agent Communication via Vector Database", () => {
  let testProjectDir;
  let claudeDir;
  let vectorDbDir;
  let vectorDbProcess;
  let agent1Process;
  let agent2Process;

  beforeAll(async () => {
    testProjectDir = path.join(
      __dirname,
      "..",
      "fixtures",
      "inter-agent-comm-test",
    );
    claudeDir = path.join(testProjectDir, ".claude");
    vectorDbDir = path.join(claudeDir, "vector_db");

    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(vectorDbDir, { recursive: true });
  });

  beforeEach(async () => {
    // Clean up any existing vector database files
    try {
      const files = await fs.readdir(vectorDbDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          await fs.unlink(path.join(vectorDbDir, file));
        }
      }
    } catch (e) {
      // Ignore if directory doesn't exist yet
    }
  });

  afterEach(async () => {
    // Clean up processes
    [vectorDbProcess, agent1Process, agent2Process].forEach((proc) => {
      if (proc && !proc.killed) {
        proc.kill("SIGTERM");
      }
    });

    // Wait for processes to terminate
    await Promise.all(
      [vectorDbProcess, agent1Process, agent2Process].map((proc) => {
        if (proc) {
          return new Promise((resolve) => {
            if (proc.killed) {
              resolve();
            } else {
              proc.on("close", resolve);
            }
          });
        }
        return Promise.resolve();
      }),
    );
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Vector Database Task History Storage", () => {
    test("stores and retrieves task execution history", async () => {
      const vectorDbScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "vector_database.py",
      );

      // Create a test task history
      const taskHistory = {
        taskId: "comm_test_task_1",
        type: "testing",
        description: "Test inter-agent communication",
        status: "completed",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 5000,
        outcome: "success",
        decisions: [
          {
            decision: "Use unit test framework",
            outcome: "Jest selected for testing",
          },
        ],
        learnings: [
          "Jest provides good async testing support",
          "Mocking external dependencies improves test reliability",
        ],
        error: null,
      };

      // Test storing task history
      vectorDbProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.append('${path.dirname(vectorDbScript)}')
from vector_database import VectorDatabase
import asyncio
import json

async def test_store():
    config = {
        'projectDir': '${testProjectDir}',
        'collectionName': 'test_agent_memory',
        'maxRetries': 1
    }

    db = VectorDatabase(config)
    await db.initialize()

    doc_id = await db.store_task_history(${JSON.stringify(taskHistory)})
    print(f"Stored document: {doc_id}")

    # Retrieve and verify
    retrieved = await db.get_task_history('${taskHistory.taskId}')
    if retrieved:
        print("Successfully retrieved task history")
        print(f"Task ID: {retrieved['taskId']}")
        print(f"Status: {retrieved['status']}")
    else:
        print("Failed to retrieve task history")

    await db.close()

asyncio.run(test_store())
        `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      let stderr = "";

      vectorDbProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      vectorDbProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      await new Promise((resolve) => {
        vectorDbProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      expect(stdout).toContain("Stored document");
      expect(stdout).toContain("Successfully retrieved task history");
      expect(stdout).toContain(`Task ID: ${taskHistory.taskId}`);
      expect(stdout).toContain("Status: completed");
    });

    test("stores and retrieves agent learnings", async () => {
      const vectorDbScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "vector_database.py",
      );

      const learning = {
        content:
          "When testing async functions, always use done() callback or return the promise",
        context: "Jest testing framework best practices",
        category: "testing",
        importance: "high",
        tags: ["jest", "async", "testing", "best-practices"],
      };

      vectorDbProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.append('${path.dirname(vectorDbScript)}')
from vector_database import VectorDatabase
import asyncio
import json

async def test_learning():
    config = {
        'projectDir': '${testProjectDir}',
        'collectionName': 'test_agent_memory',
        'maxRetries': 1
    }

    db = VectorDatabase(config)
    await db.initialize()

    doc_id = await db.store_learning(${JSON.stringify(learning)})
    print(f"Stored learning: {doc_id}")

    # Retrieve learnings
    learnings = await db.get_learnings()
    if learnings and len(learnings) > 0:
        print(f"Retrieved {len(learnings)} learnings")
        print(f"First learning content: {learnings[0]['content'][:50]}...")
    else:
        print("No learnings retrieved")

    await db.close()

asyncio.run(test_learning())
        `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      vectorDbProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        vectorDbProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      expect(stdout).toContain("Stored learning");
      expect(stdout).toContain("Retrieved");
      expect(stdout).toContain("learnings");
    });
  });

  describe("Agent Knowledge Sharing", () => {
    test("agents can query similar solutions from shared knowledge base", async () => {
      const vectorDbScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "vector_database.py",
      );

      // Store multiple task histories with similar patterns
      const taskHistories = [
        {
          taskId: "similar_task_1",
          type: "testing",
          description: "Fix failing unit tests for user authentication",
          status: "completed",
          outcome: "success",
          decisions: [
            {
              decision: "Use Jest for testing",
              outcome: "Good choice for async testing",
            },
          ],
          learnings: ["Mock external services for reliable tests"],
        },
        {
          taskId: "similar_task_2",
          type: "testing",
          description: "Implement integration tests for API endpoints",
          status: "completed",
          outcome: "success",
          decisions: [
            {
              decision: "Use Supertest for API testing",
              outcome: "Excellent for HTTP endpoint testing",
            },
          ],
          learnings: ["Test error responses as well as success cases"],
        },
      ];

      vectorDbProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.append('${path.dirname(vectorDbScript)}')
from vector_database import VectorDatabase
import asyncio
import json

async def test_similarity():
    config = {
        'projectDir': '${testProjectDir}',
        'collectionName': 'test_agent_memory',
        'maxRetries': 1
    }

    db = VectorDatabase(config)
    await db.initialize()

    # Store task histories
    for task in ${JSON.stringify(taskHistories)}:
        await db.store_task_history(task)
        print(f"Stored task: {task['taskId']}")

    # Query for similar solutions
    query = "How to test API endpoints properly"
    results = await db.query_similar_solutions(query, limit=2)

    print(f"Query: {query}")
    print(f"Found {len(results)} similar solutions")

    for i, result in enumerate(results):
        print(f"Result {i+1}: {result['metadata']['taskId']} - Distance: {result['distance']:.3f}")

    await db.close()

asyncio.run(test_similarity())
        `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      vectorDbProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        vectorDbProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      expect(stdout).toContain("Stored task: similar_task_1");
      expect(stdout).toContain("Stored task: similar_task_2");
      expect(stdout).toContain("Found");
      expect(stdout).toContain("similar solutions");
    });

    test("agents can learn from other agents mistakes and successes", async () => {
      const vectorDbScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "vector_database.py",
      );

      // Store learnings from different agents
      const learnings = [
        {
          content: "Never use setTimeout in tests without proper cleanup",
          context: "Learned from test suite hanging indefinitely",
          category: "testing",
          importance: "high",
          tags: ["testing", "async", "cleanup", "mistake"],
        },
        {
          content: "Use beforeEach/afterEach for test setup and teardown",
          context: "Prevents test interference and improves reliability",
          category: "testing",
          importance: "medium",
          tags: ["testing", "setup", "best-practice"],
        },
      ];

      vectorDbProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.append('${path.dirname(vectorDbScript)}')
from vector_database import VectorDatabase
import asyncio
import json

async def test_learning_sharing():
    config = {
        'projectDir': '${testProjectDir}',
        'collectionName': 'test_agent_memory',
        'maxRetries': 1
    }

    db = VectorDatabase(config)
    await db.initialize()

    # Store learnings
    for learning in ${JSON.stringify(learnings)}:
        await db.store_learning(learning)

    print("Stored agent learnings")

    # Query learnings by category
    test_learnings = await db.get_learnings(filters={'category': 'testing'})
    print(f"Found {len(test_learnings)} testing learnings")

    for learning in test_learnings:
        print(f"Learning: {learning['content'][:50]}...")
        print(f"Importance: {learning['importance']}")

    await db.close()

asyncio.run(test_learning_sharing())
        `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      vectorDbProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        vectorDbProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      expect(stdout).toContain("Stored agent learnings");
      expect(stdout).toContain("testing learnings");
      expect(stdout).toContain("Importance:");
    });
  });

  describe("Distributed Task Coordination", () => {
    test("multiple agents can coordinate through shared task status", async () => {
      const vectorDbScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "vector_database.py",
      );

      // Simulate multiple agents working on related tasks
      const agentTasks = [
        {
          taskId: "agent_A_task_1",
          type: "testing",
          description: "Agent A: Test authentication module",
          status: "running",
          agentId: "agent_A",
          dependencies: [],
        },
        {
          taskId: "agent_B_task_1",
          type: "testing",
          description: "Agent B: Test user management module",
          status: "pending",
          agentId: "agent_B",
          dependencies: ["agent_A_task_1"], // Depends on Agent A's task
        },
      ];

      vectorDbProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.append('${path.dirname(vectorDbScript)}')
from vector_database import VectorDatabase
import asyncio
import json

async def test_coordination():
    config = {
        'projectDir': '${testProjectDir}',
        'collectionName': 'test_agent_memory',
        'maxRetries': 1
    }

    db = VectorDatabase(config)
    await db.initialize()

    # Store initial task states
    for task in ${JSON.stringify(agentTasks)}:
        await db.store_task_history(task)

    print("Stored initial task states")

    # Simulate Agent A completing its task
    completed_task = ${JSON.stringify(agentTasks[0])}
    completed_task['status'] = 'completed'
    completed_task['endTime'] = '${new Date().toISOString()}'

    await db.store_task_history(completed_task)
    print("Agent A completed its task")

    # Agent B can now check if its dependencies are met
    dependency_task = await db.get_task_history('agent_A_task_1')
    if dependency_task and dependency_task['status'] == 'completed':
        print("Agent B can now proceed - dependency completed")
    else:
        print("Agent B must wait - dependency not completed")

    await db.close()

asyncio.run(test_coordination())
        `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      vectorDbProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        vectorDbProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      expect(stdout).toContain("Stored initial task states");
      expect(stdout).toContain("Agent A completed its task");
      expect(stdout).toContain("Agent B can now proceed");
    });

    test("agents can share progress updates and coordinate work", async () => {
      const vectorDbScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "vector_database.py",
      );

      vectorDbProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.append('${path.dirname(vectorDbScript)}')
from vector_database import VectorDatabase
import asyncio
import json

async def test_progress_sharing():
    config = {
        'projectDir': '${testProjectDir}',
        'collectionName': 'test_agent_memory',
        'maxRetries': 1
    }

    db = VectorDatabase(config)
    await db.initialize()

    # Simulate progress updates from multiple agents
    progress_updates = [
        {
            taskId: 'progress_task_1',
            type: 'analysis',
            description: 'Code analysis task',
            status: 'running',
            agentId: 'analyzer_agent',
            progress: 25,
            current_step: 'Scanning files'
        },
        {
            taskId: 'progress_task_2',
            type: 'testing',
            description: 'Test execution task',
            status: 'running',
            agentId: 'tester_agent',
            progress: 50,
            current_step: 'Running unit tests'
        }
    ]

    # Store progress updates
    for update in progress_updates:
        await db.store_task_history(update)

    print("Stored progress updates from multiple agents")

    # Query current progress across all agents
    all_tasks = []
    for update in progress_updates:
        task = await db.get_task_history(update.taskId)
        if task:
            all_tasks.append(task)

    print(f"Retrieved progress for {len(all_tasks)} tasks")
    total_progress = sum(task.get('progress', 0) for task in all_tasks) / len(all_tasks)
    print(f"Average progress across agents: {total_progress:.1f}%")

    # Check which agents are working on which steps
    for task in all_tasks:
        print(f"Agent {task['agentId']}: {task.get('current_step', 'Unknown step')} ({task.get('progress', 0)}%)")

    await db.close()

asyncio.run(test_progress_sharing())
        `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      vectorDbProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        vectorDbProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      expect(stdout).toContain("Stored progress updates");
      expect(stdout).toContain("Retrieved progress for");
      expect(stdout).toContain("Average progress across agents");
      expect(stdout).toContain("analyzer_agent");
      expect(stdout).toContain("tester_agent");
    });
  });

  describe("Agent Communication Reliability", () => {
    test("handles database connection failures gracefully", async () => {
      const vectorDbScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "vector_database.py",
      );

      vectorDbProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.append('${path.dirname(vectorDbScript)}')
from vector_database import VectorDatabase
import asyncio
import json

async def test_failure_handling():
    # Test with invalid ChromaDB URL to force fallback
    config = {
        'projectDir': '${testProjectDir}',
        'collectionName': 'test_agent_memory',
        'chromaUrl': 'http://invalid-chroma-url:9999',
        'maxRetries': 1
    }

    db = VectorDatabase(config)
    success = await db.initialize()

    if success:
        print("Database initialized successfully (using fallback)")

        # Test basic operations still work
        learning = {
            'content': 'Test learning with fallback storage',
            'category': 'testing'
        }

        try:
            doc_id = await db.store_learning(learning)
            print(f"Successfully stored learning with fallback: {doc_id}")

            retrieved = await db.get_learnings()
            print(f"Retrieved {len(retrieved)} learnings from fallback storage")

        except Exception as e:
            print(f"Error with fallback operations: {e}")

        await db.close()
    else:
        print("Failed to initialize database even with fallback")

asyncio.run(test_failure_handling())
        `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      vectorDbProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        vectorDbProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      expect(stdout).toContain("Database initialized successfully") ||
        expect(stdout).toContain("Successfully stored learning");
      expect(stdout).toContain("Retrieved");
      expect(stdout).toContain("learnings");
    });

    test("maintains data consistency across agent operations", async () => {
      const vectorDbScript = path.join(
        __dirname,
        "..",
        "..",
        "scripts",
        "vector_database.py",
      );

      vectorDbProcess = spawn(
        "python3",
        [
          "-c",
          `
import sys
sys.path.append('${path.dirname(vectorDbScript)}')
from vector_database import VectorDatabase
import asyncio
import json

async def test_consistency():
    config = {
        'projectDir': '${testProjectDir}',
        'collectionName': 'test_agent_memory',
        'maxRetries': 1
    }

    db = VectorDatabase(config)
    await db.initialize()

    # Simulate concurrent agent operations
    task_data = {
        taskId: 'consistency_test_task',
        type: 'testing',
        description: 'Test data consistency',
        status: 'running'
    }

    # Store initial state
    await db.store_task_history(task_data)
    print("Stored initial task state")

    # Simulate multiple status updates (like multiple agents updating)
    updates = ['running', 'running', 'completed']
    for i, status in enumerate(updates):
        task_data['status'] = status
        task_data['progress'] = (i + 1) * 33
        await db.store_task_history(task_data)
        print(f"Updated task status to: {status} ({task_data['progress']}%)")

    # Verify final state
    final_task = await db.get_task_history('consistency_test_task')
    if final_task:
        print(f"Final task status: {final_task['status']}")
        print(f"Final progress: {final_task.get('progress', 0)}%")

        # Check that we have a consistent final state
        if final_task['status'] == 'completed' and final_task.get('progress') >= 99:
            print("Data consistency maintained")
        else:
            print("Data consistency issue detected")
    else:
        print("Failed to retrieve final task state")

    await db.close()

asyncio.run(test_consistency())
        `,
        ],
        {
          cwd: testProjectDir,
          stdio: "pipe",
        },
      );

      let stdout = "";
      vectorDbProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        vectorDbProcess.on("close", (code) => {
          expect(code).toBe(0);
          resolve();
        });
      });

      expect(stdout).toContain("Stored initial task state");
      expect(stdout).toContain("Updated task status");
      expect(stdout).toContain("Final task status: completed");
      expect(stdout).toContain("Data consistency maintained");
    });
  });
});
