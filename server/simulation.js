const db = require('./db');
const { LogisticsSimulationFramework } = require('./framework/LogisticsFramework');

let simulationInstance = null;
let simulationInterval = null;
let latestResults = null;

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

async function initSimulation(params) {
  const workstations = await dbAll('SELECT * FROM workstations ORDER BY id');
  const agvsDb = await dbAll('SELECT * FROM agvs ORDER BY id');
  const orders = await dbAll('SELECT * FROM orders WHERE status = "pending" ORDER BY priority DESC, created_at');
  
  const agvCount = params.agvCount || agvsDb.length;
  const selectedAgvs = agvsDb.slice(0, agvCount);
  
  const framework = new LogisticsSimulationFramework(workstations, selectedAgvs, orders);
  
  return framework;
}

async function saveSnapshot(simulation) {
  const state = simulation.getState();
  const statistics = simulation.getStatistics();
  
  const snapshotData = {
    simulation_time: state.time,
    agv_states: JSON.stringify(state.agvs),
    workstation_states: JSON.stringify(state.workstations),
    completed_orders: state.completedOrders,
    statistics: JSON.stringify(statistics)
  };
  
  await dbRun(`
    INSERT INTO snapshots (simulation_time, agv_states, workstation_states, completed_orders, statistics, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    snapshotData.simulation_time,
    snapshotData.agv_states,
    snapshotData.workstation_states,
    snapshotData.completed_orders,
    snapshotData.statistics
  ]);
}

async function saveResults(simulation) {
  const statistics = simulation.getStatistics();
  
  await dbRun(`
    INSERT INTO simulation_results (total_completion_time, bottleneck_station, avg_agv_utilization, total_orders_completed, total_wait_time, total_collisions, throughput, deadlock_resolutions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    statistics.simulationTime,
    statistics.bottleneckStation,
    statistics.avgAgvUtilization,
    simulation.completedOrders,
    statistics.totalWaitTime,
    statistics.totalCollisions,
    statistics.throughput,
    statistics.deadlockResolutions
  ]);
}

module.exports = {
  async start(params, onUpdate) {
    simulationInstance = await initSimulation(params);
    simulationInstance.start();
    
    const stepDuration = 0.1;
    const speed = params.speed || 1;
    let snapshotCounter = 0;
    
    if (simulationInterval) clearInterval(simulationInterval);
    
    simulationInterval = setInterval(async () => {
      if (!simulationInstance || !simulationInstance.isRunning) return;
      
      const state = simulationInstance.step(stepDuration * speed);
      
      if (!state) return;
      
      if (onUpdate) {
        onUpdate(state);
      }
      
      snapshotCounter++;
      if (snapshotCounter % 20 === 0) {
        await saveSnapshot(simulationInstance);
      }
      
      if (state.isComplete) {
        this.stop();
        
        const statistics = simulationInstance.getStatistics();
        latestResults = {
          total_completion_time: statistics.simulationTime,
          bottleneck_station: statistics.bottleneckStation,
          bottleneck_name: state.bottleneck?.name,
          avg_agv_utilization: statistics.avgAgvUtilization,
          total_orders_completed: state.completedOrders,
          total_wait_time: statistics.totalWaitTime,
          total_collisions: statistics.totalCollisions,
          throughput: statistics.throughput,
          deadlock_resolutions: statistics.deadlockResolutions,
          workstation_utilization: statistics.workstationUtilizations
        };
        
        await saveSnapshot(simulationInstance);
        await saveResults(simulationInstance);
      }
    }, 50);
  },
  
  stop() {
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    if (simulationInstance) {
      simulationInstance.stop();
    }
  },
  
  updateParams(params) {
    if (simulationInstance && params.speed !== undefined) {
      simulationInstance.speed = params.speed;
    }
  },
  
  getLatestResults() {
    return latestResults;
  },
  
  getFramework() {
    return simulationInstance;
  }
};
