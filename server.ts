import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { AgentLoop } from './server/core/loop';
import { getLogs } from './server/utils/logger';

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log(`[INIT] Starting RSEA Server in ${process.env.NODE_ENV || 'development'} mode`);

  app.use(express.json());

  // Log all requests for debugging
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[API REQUEST] ${req.method} ${req.url}`);
    }
    next();
  });

  // Initialize Agent
  const agentLoop = new AgentLoop();

  // Root test route
  app.get('/ping', (req, res) => {
    res.send('pong');
  });

  // API Routes
  app.get('/api/status', (req, res) => {
    try {
      res.json({
        status: 'active',
        framework: 'RSEA',
        version: '1.0.0',
        uptime: process.uptime(),
        goals: agentLoop.getAgent().getGoals().getGoals()
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate status' });
    }
  });

  app.get('/api/health', (req, res) => {
    try {
      const health = agentLoop.getAgent().checkHealth();
      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    } catch (err) {
      res.status(500).json({ status: 'unhealthy', error: 'Internal health check failure' });
    }
  });

  app.get('/api/logs', (req, res) => {
    try {
      const logs = getLogs();
      res.json(logs.reverse().slice(0, 100)); // Last 100 logs
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.get('/api/memory', (req, res) => {
    try {
      const memory = agentLoop.getAgent().getMemory().getSnapshot();
      res.json(memory);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch memory' });
    }
  });

  app.get('/api/debug/state', (req, res) => {
    try {
      const agent = agentLoop.getAgent();
      res.json({
        loop: agentLoop.getTelemetry(),
        goals: agent.getGoals().getGoals(),
        memoryStats: {
          shortTermCount: agent.getMemory().getSnapshot().shortTerm.length,
          longTermCount: Object.keys(agent.getMemory().getSnapshot().longTerm).length
        },
        nodeEnv: process.env.NODE_ENV || 'development'
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch debug state' });
    }
  });

  app.get('/api/memory/data', (req, res) => {
    try {
      const data = agentLoop.getAgent().getMemory().getSnapshot();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to parsing memory data' });
    }
  });

  app.post('/api/command', (req, res) => {
    try {
      const { command } = req.body;
      if (command) {
        agentLoop.getAgent().addInstruction(command);
        res.json({ message: 'Instruction queued' });
      } else {
        res.status(400).json({ error: 'No command provided' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to process command' });
    }
  });

  app.post('/api/control', (req, res) => {
    try {
      const { action, interval } = req.body;
      if (action === 'start') {
        agentLoop.start();
        res.json({ message: 'Agent started' });
      } else if (action === 'stop') {
        agentLoop.stop();
        res.json({ message: 'Agent stopped' });
      } else if (action === 'set_interval') {
        if (interval && typeof interval === 'number') {
          agentLoop.setInterval(interval);
          res.json({ message: `Agent interval set to ${interval}ms` });
        } else {
          res.status(400).json({ error: 'Invalid interval value' });
        }
      } else {
        res.status(400).json({ error: 'Invalid action' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Control action failed' });
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RSEA Server running at http://localhost:${PORT}`);
    // Start agent after server is successfuly listening
    agentLoop.start();
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
