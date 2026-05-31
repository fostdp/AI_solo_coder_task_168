const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const db = require('./db');
const simulation = require('./simulation');
const KPIAnalyzer = require('./kpiAnalyzer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const kpiAnalyzer = new KPIAnalyzer(db);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.get('/api/workstations', (req, res) => {
  db.all('SELECT * FROM workstations ORDER BY id', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/agvs', (req, res) => {
  db.all('SELECT * FROM agvs ORDER BY id', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/orders', (req, res) => {
  db.all('SELECT * FROM orders ORDER BY priority DESC, created_at', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/orders', (req, res) => {
  const { product_type, quantity, priority } = req.body;
  db.run(`
    INSERT INTO orders (product_type, quantity, priority, status, created_at)
    VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `, [product_type, quantity, priority], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, product_type, quantity, priority, status: 'pending' });
  });
});

app.delete('/api/orders/:id', (req, res) => {
  db.run('DELETE FROM orders WHERE id = ?', req.params.id, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put('/api/agvs/:id', (req, res) => {
  const { status, current_station } = req.body;
  db.run('UPDATE agvs SET status = ?, current_station = ? WHERE id = ?', 
    [status, current_station, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/snapshots', (req, res) => {
  const { simulation_time, agv_states, workstation_states, completed_orders } = req.body;
  db.run(`
    INSERT INTO snapshots (simulation_time, agv_states, workstation_states, completed_orders, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    simulation_time,
    JSON.stringify(agv_states),
    JSON.stringify(workstation_states),
    completed_orders
  ], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.get('/api/snapshots', (req, res) => {
  db.all('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 50', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(s => ({
      ...s,
      agv_states: JSON.parse(s.agv_states),
      workstation_states: JSON.parse(s.workstation_states),
      statistics: s.statistics ? JSON.parse(s.statistics) : null
    })));
  });
});

app.get('/api/snapshots/latest', (req, res) => {
  db.get('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 1', (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json(null);
    res.json({
      ...row,
      agv_states: JSON.parse(row.agv_states),
      workstation_states: JSON.parse(row.workstation_states),
      statistics: row.statistics ? JSON.parse(row.statistics) : null
    });
  });
});

app.get('/api/simulation/results', (req, res) => {
  const results = simulation.getLatestResults();
  res.json(results);
});

app.get('/api/kpi/overview', async (req, res) => {
  try {
    const kpi = await kpiAnalyzer.getOverallKPI();
    res.json(kpi);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kpi/bottleneck', async (req, res) => {
  try {
    const analysis = await kpiAnalyzer.getBottleneckAnalysis();
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kpi/dashboard', async (req, res) => {
  try {
    const dashboard = await kpiAnalyzer.getRealtimeDashboard();
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kpi/agv-performance', async (req, res) => {
  try {
    const metrics = await kpiAnalyzer.getAGVPerformanceMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kpi/heatmap', async (req, res) => {
  try {
    const dashboard = await kpiAnalyzer.getRealtimeDashboard();
    res.json({ heatmapData: dashboard.heatmapData || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let broadcastInterval = null;

function broadcastState(state) {
  const message = JSON.stringify({ 
    type: 'state_update', 
    state,
    timestamp: Date.now()
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastKPIUpdate() {
  kpiAnalyzer.getRealtimeDashboard().then(dashboard => {
    const message = JSON.stringify({
      type: 'kpi_update',
      dashboard,
      timestamp: Date.now()
    });
    
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }).catch(err => console.error('KPI broadcast error:', err));
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'start_simulation') {
        simulation.start(message.params, (state) => {
          broadcastState(state);
        });
        
        ws.send(JSON.stringify({ 
          type: 'simulation_started', 
          params: message.params 
        }));
      } else if (message.type === 'stop_simulation') {
        simulation.stop();
        broadcastState({ type: 'simulation_stopped' });
      } else if (message.type === 'update_params') {
        simulation.updateParams(message.params);
      } else if (message.type === 'get_kpi') {
        try {
          const kpi = await kpiAnalyzer.getOverallKPI();
          ws.send(JSON.stringify({ type: 'kpi_data', data: kpi }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'kpi_error', error: err.message }));
        }
      } else if (message.type === 'get_bottleneck') {
        try {
          const analysis = await kpiAnalyzer.getBottleneckAnalysis();
          ws.send(JSON.stringify({ type: 'bottleneck_data', data: analysis }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'bottleneck_error', error: err.message }));
        }
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
  
  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to simulation server' }));
});

if (broadcastInterval) clearInterval(broadcastInterval);
broadcastInterval = setInterval(broadcastKPIUpdate, 5000);

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);
});
