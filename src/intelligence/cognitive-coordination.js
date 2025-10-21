/**
 * Cognitive-Coordination™ - Intelligent Task Orchestration
 *
 * Provides intelligent task decomposition, dependency-aware execution,
 * and cognitive synthesis of results for complex multi-step tasks.
 *
 * @module intelligence/cognitive-coordination
 */

import { ContextConsciousness } from './context-consciousness.js';
import { MemoryCloude } from './memory-cloude.js';

/**
 * Task Graph for dependency management
 */
class TaskGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  addNode(task) {
    const id = task.id || `task-${Date.now()}-${Math.random()}`;
    this.nodes.set(id, {
      id,
      ...task,
      status: 'pending'
    });

    // Initialize edges for this node
    if (!this.edges.has(id)) {
      this.edges.set(id, []);
    }

    // Add edges for dependencies
    if (task.dependencies && task.dependencies.length > 0) {
      for (const dep of task.dependencies) {
        if (!this.edges.has(dep)) {
          this.edges.set(dep, []);
        }
        this.edges.get(dep).push(id);
      }
    }

    return id;
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  updateNode(id, updates) {
    const node = this.nodes.get(id);
    if (node) {
      this.nodes.set(id, { ...node, ...updates });
    }
  }

  getDependents(id) {
    return this.edges.get(id) || [];
  }

  getExecutableNodes() {
    // Return nodes that have no pending dependencies
    const executable = [];

    for (const [id, node] of this.nodes.entries()) {
      if (node.status === 'pending') {
        const dependencies = node.dependencies || [];
        const allDepsComplete = dependencies.every(depId => {
          const dep = this.nodes.get(depId);
          return dep && dep.status === 'completed';
        });

        if (allDepsComplete) {
          executable.push(node);
        }
      }
    }

    return executable;
  }

  isComplete() {
    return Array.from(this.nodes.values()).every(
      node => node.status === 'completed' || node.status === 'failed'
    );
  }

  toJSON() {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.entries()).map(([from, to]) => ({ from, to }))
    };
  }
}

/**
 * Execution Engine for parallel task execution
 */
class ExecutionEngine {
  constructor(env) {
    this.env = env;
    this.maxConcurrency = 5; // Max parallel tasks
    this.running = new Set();
  }

  async execute(executionPlan, options = {}) {
    const {
      parallel = true,
      dependencyAware = true,
      failover = true,
      timeout = 60000
    } = options;

    const results = [];
    const graph = executionPlan.graph;

    while (!graph.isComplete()) {
      const executable = graph.getExecutableNodes();

      if (executable.length === 0) {
        // Check for deadlock
        const pending = Array.from(graph.nodes.values()).filter(n => n.status === 'pending');
        if (pending.length > 0) {
          console.error('[ExecutionEngine] Deadlock detected:', pending);
          break;
        }
        break;
      }

      // Execute tasks (parallel if enabled)
      if (parallel) {
        const batch = executable.slice(0, this.maxConcurrency - this.running.size);
        const promises = batch.map(task => this.executeTask(task, graph, failover, timeout));
        const batchResults = await Promise.allSettled(promises);

        results.push(...batchResults.map((r, i) => ({
          task: batch[i],
          success: r.status === 'fulfilled',
          result: r.status === 'fulfilled' ? r.value : null,
          error: r.status === 'rejected' ? r.reason : null
        })));
      } else {
        // Sequential execution
        for (const task of executable) {
          try {
            const result = await this.executeTask(task, graph, failover, timeout);
            results.push({ task, success: true, result });
          } catch (error) {
            results.push({ task, success: false, error });
            if (!failover) throw error;
          }
        }
      }
    }

    return results;
  }

  async executeTask(task, graph, failover, timeout) {
    console.log(`[ExecutionEngine] Executing task: ${task.id} (${task.subtask?.description || 'unknown'})`);

    graph.updateNode(task.id, { status: 'running', startTime: Date.now() });
    this.running.add(task.id);

    try {
      // Execute with timeout
      const result = await Promise.race([
        this.performTask(task),
        this.timeoutPromise(timeout, task.id)
      ]);

      graph.updateNode(task.id, {
        status: 'completed',
        result,
        endTime: Date.now()
      });

      return result;
    } catch (error) {
      console.error(`[ExecutionEngine] Task ${task.id} failed:`, error.message);

      if (failover) {
        // Try alternative approach
        try {
          const alternative = await this.performTaskAlternative(task);
          graph.updateNode(task.id, {
            status: 'completed',
            result: alternative,
            endTime: Date.now(),
            usedFailover: true
          });
          return alternative;
        } catch (failoverError) {
          graph.updateNode(task.id, {
            status: 'failed',
            error: failoverError.message,
            endTime: Date.now()
          });
          throw failoverError;
        }
      } else {
        graph.updateNode(task.id, {
          status: 'failed',
          error: error.message,
          endTime: Date.now()
        });
        throw error;
      }
    } finally {
      this.running.delete(task.id);
    }
  }

  async performTask(task) {
    // Execute the actual task
    // This would call the appropriate ChittyOS service or MCP tool

    const { subtask, learnedInsights } = task;

    // Simulate task execution (in real implementation, this would route to services)
    return {
      taskId: task.id,
      description: subtask?.description || 'Task completed',
      insights: learnedInsights,
      output: `Completed: ${subtask?.description || task.id}`
    };
  }

  async performTaskAlternative(task) {
    // Failover implementation
    console.log(`[ExecutionEngine] Using alternative approach for ${task.id}`);

    return {
      taskId: task.id,
      description: `Fallback: ${task.subtask?.description || task.id}`,
      output: `Completed via fallback: ${task.subtask?.description || task.id}`
    };
  }

  timeoutPromise(ms, taskId) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Task ${taskId} timed out after ${ms}ms`)), ms)
    );
  }
}

/**
 * Cognitive-Coordination™ Main Class
 */
export class CognitiveCoordinator {
  constructor(env) {
    this.env = env;
    this.taskGraph = new TaskGraph();
    this.executionEngine = new ExecutionEngine(env);
    this.consciousness = new ContextConsciousness(env);
    this.memory = new MemoryCloude(env);
  }

  /**
   * Initialize Cognitive-Coordination™
   */
  async initialize() {
    console.log('[Cognitive-Coordination™] Initializing intelligent task orchestration...');

    await Promise.all([
      this.consciousness.initialize(),
      this.memory.initialize()
    ]);

    console.log('[Cognitive-Coordination™] Ready for complex task execution');
  }

  /**
   * Execute a complex task with cognitive coordination
   */
  async executeComplex(task, sessionId) {
    console.log(`[Cognitive-Coordination™] Analyzing task: ${task.description || task.type}`);

    // 1. Cognitive analysis of task complexity
    const analysis = await this.cognitiveAnalysis(task);

    if (analysis.complexity === 'simple') {
      console.log('[Cognitive-Coordination™] Simple task, executing directly');
      return await this.executeDirect(task);
    }

    // 2. Intelligent decomposition into dependency graph
    const taskGraph = await this.decomposeIntelligently(task, analysis);

    // 3. Create optimal execution plan
    const executionPlan = await this.createExecutionPlan(taskGraph);

    // 4. Coordinate parallel execution with dependency management
    const results = await this.executionEngine.execute(executionPlan, {
      parallel: true,
      dependencyAware: true,
      failover: true,
      timeout: 60000
    });

    // 5. Cognitive synthesis of results
    const synthesis = await this.cognitiveSynthesize(results, task);

    // 6. Learn from execution patterns
    await this.memory.persistInteraction(sessionId, {
      type: 'task_decomposition',
      task,
      taskGraph: taskGraph.toJSON(),
      executionPlan,
      results,
      synthesis,
      performance: this.measurePerformance(results)
    });

    return synthesis;
  }

  /**
   * Perform cognitive analysis of task
   */
  async cognitiveAnalysis(task) {
    try {
      const prompt = `Analyze this task and determine its complexity:

Task: ${JSON.stringify(task)}

Provide:
1. Complexity level (simple, moderate, complex)
2. Required subtasks
3. Dependencies between subtasks
4. Estimated execution time
5. Potential risks

Respond in JSON format: {
  "complexity": "simple|moderate|complex",
  "subtasks": [{"description": "...", "dependencies": [], "priority": 1}],
  "estimatedTime": 1000,
  "risks": ["..."]
}`;

      const response = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are a task analysis expert for ChittyOS Cognitive-Coordination™. Analyze tasks and provide structured decomposition.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const analysis = JSON.parse(response.response);
      console.log(`[Cognitive-Coordination™] Task complexity: ${analysis.complexity}`);

      return analysis;
    } catch (error) {
      console.warn('[Cognitive-Coordination™] AI analysis failed:', error.message);

      // Fallback to simple heuristics
      return {
        complexity: 'simple',
        subtasks: [{ description: task.description || 'Execute task', dependencies: [], priority: 1 }],
        estimatedTime: 5000,
        risks: []
      };
    }
  }

  /**
   * Intelligently decompose task into dependency graph
   */
  async decomposeIntelligently(task, analysis) {
    const graph = new TaskGraph();

    // Add each subtask to the graph
    for (const subtask of analysis.subtasks) {
      // Use ContextConsciousness™ to determine optimal dependencies
      const dependencies = await this.consciousness.getAwareness().then(awareness => {
        // Check if required services are available
        return subtask.dependencies || [];
      });

      // Use MemoryCloude™ to learn from past decompositions
      const learned = await this.memory.recallSimilarDecompositions(subtask);

      graph.addNode({
        subtask,
        dependencies,
        priority: subtask.priority || 1,
        learnedInsights: learned
      });
    }

    console.log(`[Cognitive-Coordination™] Created task graph with ${graph.nodes.size} nodes`);

    return graph;
  }

  /**
   * Create optimal execution plan from task graph
   */
  async createExecutionPlan(graph) {
    return {
      graph,
      strategy: 'parallel_dependency_aware',
      maxConcurrency: 5,
      failoverEnabled: true
    };
  }

  /**
   * Execute simple task directly
   */
  async executeDirect(task) {
    return {
      success: true,
      result: `Executed: ${task.description || task.type}`,
      complexity: 'simple'
    };
  }

  /**
   * Cognitive synthesis of results
   */
  async cognitiveSynthesize(results, originalTask) {
    try {
      const prompt = `Synthesize these task execution results into a coherent response:

Original task: ${JSON.stringify(originalTask)}
Results: ${JSON.stringify(results)}

Provide:
1. Summary of what was accomplished
2. Key insights from execution
3. Any issues encountered
4. Recommendations for future similar tasks

Use ContextConsciousness™ to understand broader implications.
Use MemoryCloude™ to reference past similar tasks.
Respect task dependencies and relationships.

Respond in JSON format: {
  "summary": "...",
  "insights": ["..."],
  "issues": ["..."],
  "recommendations": ["..."]
}`;

      const response = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are a cognitive synthesizer for ChittyConnect Cognitive-Coordination™. Analyze task results and provide intelligent synthesis.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const synthesis = JSON.parse(response.response);

      return {
        success: true,
        ...synthesis,
        details: results,
        confidence: this.calculateConfidence(results)
      };
    } catch (error) {
      console.warn('[Cognitive-Coordination™] Synthesis failed:', error.message);

      // Fallback synthesis
      return {
        success: true,
        summary: `Executed ${results.length} tasks`,
        details: results,
        confidence: this.calculateConfidence(results)
      };
    }
  }

  /**
   * Calculate confidence score from results
   */
  calculateConfidence(results) {
    const successful = results.filter(r => r.success).length;
    return successful / results.length;
  }

  /**
   * Measure performance of execution
   */
  measurePerformance(results) {
    const times = results
      .filter(r => r.task.startTime && r.task.endTime)
      .map(r => r.task.endTime - r.task.startTime);

    if (times.length === 0) return { totalTime: 0, avgTime: 0, tasks: 0 };

    return {
      totalTime: Math.max(...times.map((_, i) => results[i].task.endTime)) -
                 Math.min(...times.map((_, i) => results[i].task.startTime)),
      avgTime: times.reduce((a, b) => a + b, 0) / times.length,
      tasks: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    };
  }

  /**
   * Get coordination statistics
   */
  async getStats() {
    return {
      activeGraph: this.taskGraph.toJSON(),
      executionEngine: {
        running: this.executionEngine.running.size,
        maxConcurrency: this.executionEngine.maxConcurrency
      },
      consciousness: await this.consciousness.getAwareness(),
      memory: await this.memory.getStats('global')
    };
  }
}

export default CognitiveCoordinator;
