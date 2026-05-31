const db = require('./db');

async function initDatabase() {
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS workstations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        processing_time INTEGER NOT NULL,
        capacity INTEGER DEFAULT 1,
        status TEXT DEFAULT 'idle'
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS agvs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        speed REAL DEFAULT 1.0,
        capacity INTEGER DEFAULT 1,
        status TEXT DEFAULT 'idle',
        current_station INTEGER,
        battery REAL DEFAULT 100,
        FOREIGN KEY (current_station) REFERENCES workstations(id)
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        priority INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        simulation_time REAL NOT NULL,
        agv_states TEXT NOT NULL,
        workstation_states TEXT NOT NULL,
        completed_orders INTEGER DEFAULT 0,
        statistics TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS simulation_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_completion_time REAL,
        bottleneck_station INTEGER,
        avg_agv_utilization REAL,
        total_orders_completed INTEGER,
        total_wait_time REAL DEFAULT 0,
        total_collisions INTEGER DEFAULT 0,
        throughput REAL DEFAULT 0,
        deadlock_resolutions INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const workstations = [
      [1, '原料仓库', 'warehouse', 50, 200, 0, 10, 'idle'],
      [2, '切割工位', 'cutting', 200, 100, 3, 1, 'idle'],
      [3, '冲压工位', 'stamping', 200, 300, 4, 1, 'idle'],
      [4, '焊接工位', 'welding', 400, 100, 5, 1, 'idle'],
      [5, '组装工位', 'assembly', 400, 300, 6, 2, 'idle'],
      [6, '喷涂工位', 'painting', 600, 200, 4, 1, 'idle'],
      [7, '质检工位', 'inspection', 750, 100, 2, 1, 'idle'],
      [8, '成品仓库', 'finished', 750, 300, 0, 10, 'idle']
    ];

    const insertWs = db.prepare('INSERT OR IGNORE INTO workstations (id, name, type, x, y, processing_time, capacity, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    workstations.forEach(w => insertWs.run(...w));

    const agvs = [
      [1, 'AGV-01', 1.5, 1, 'idle', 1, 100],
      [2, 'AGV-02', 1.5, 1, 'idle', 1, 100],
      [3, 'AGV-03', 1.2, 2, 'idle', 1, 100]
    ];

    const insertAgv = db.prepare('INSERT OR IGNORE INTO agvs (id, name, speed, capacity, status, current_station, battery) VALUES (?, ?, ?, ?, ?, ?, ?)');
    agvs.forEach(a => insertAgv.run(...a));

    console.log('Database initialized successfully!');
    
    const wsRow = await db.get('SELECT COUNT(*) as count FROM workstations');
    console.log('Workstations:', wsRow.count);
    
    const agvRow = await db.get('SELECT COUNT(*) as count FROM agvs');
    console.log('AGVs:', agvRow.count);
    
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initDatabase();
