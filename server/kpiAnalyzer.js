class KPIAnalyzer {
  constructor(db) {
    this.db = db;
  }

  async getOverallKPI() {
    const results = await this.dbAll(
      `SELECT * FROM simulation_results ORDER BY created_at DESC LIMIT 10`
    );

    if (results.length === 0) {
      return this.getDefaultKPI();
    }

    const avgCompletionTime = this.calculateAverage(results, 'total_completion_time');
    const avgAgvUtilization = this.calculateAverage(results, 'avg_agv_utilization');
    const avgThroughput = this.calculateAverage(results, 'throughput');
    const totalDeadlocks = results.reduce((sum, r) => sum + (r.deadlock_resolutions || 0), 0);
    const totalCollisions = results.reduce((sum, r) => sum + (r.total_collisions || 0), 0);

    const latestResult = results[0];

    return {
      currentMetrics: {
        totalCompletionTime: latestResult.total_completion_time,
        bottleneckStation: latestResult.bottleneck_station,
        agvUtilization: latestResult.avg_agv_utilization,
        throughput: latestResult.throughput,
        ordersCompleted: latestResult.total_orders_completed,
        totalWaitTime: latestResult.total_wait_time,
        deadlockResolutions: latestResult.deadlock_resolutions,
        collisions: latestResult.total_collisions
      },
      averages: {
        avgCompletionTime,
        avgAgvUtilization,
        avgThroughput
      },
      totals: {
        totalDeadlocks,
        totalCollisions,
        simulationsCount: results.length
      }
    };
  }

  async getBottleneckAnalysis() {
    const results = await this.dbAll(
      `SELECT bottleneck_station, COUNT(*) as count 
       FROM simulation_results 
       WHERE bottleneck_station IS NOT NULL 
       GROUP BY bottleneck_station 
       ORDER BY count DESC`
    );

    const workstations = await this.dbAll('SELECT * FROM workstations ORDER BY id');

    const bottleneckStats = results.map(r => {
      const ws = workstations.find(w => w.id === r.bottleneck_station);
      return {
        stationId: r.bottleneck_station,
        stationName: ws?.name || `工位${r.bottleneck_station}`,
        occurrenceCount: r.count,
        percentage: results.length > 0 ? (r.count / results.length * 100).toFixed(1) : 0
      };
    });

    const snapshots = await this.dbAll(
      `SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 100`
    );

    let workstationLoads = {};
    for (const snapshot of snapshots) {
      try {
        const wsStates = JSON.parse(snapshot.workstation_states);
        for (const ws of wsStates) {
          if (!workstationLoads[ws.id]) {
            workstationLoads[ws.id] = { total: 0, count: 0 };
          }
          workstationLoads[ws.id].total += ws.utilization || 0;
          workstationLoads[ws.id].count++;
        }
      } catch (e) {}
    }

    const avgUtilizations = Object.keys(workstationLoads).map(id => {
      const ws = workstations.find(w => w.id === parseInt(id));
      return {
        stationId: parseInt(id),
        stationName: ws?.name || `工位${id}`,
        avgUtilization: workstationLoads[id].count > 0 
          ? (workstationLoads[id].total / workstationLoads[id].count).toFixed(1) 
          : 0
      };
    }).sort((a, b) => b.avgUtilization - a.avgUtilization);

    const recommendations = this.generateBottleneckRecommendations(bottleneckStats, avgUtilizations);

    return {
      bottleneckHistory: bottleneckStats,
      avgUtilizations,
      primaryBottleneck: bottleneckStats[0] || null,
      recommendations
    };
  }

  async getRealtimeDashboard() {
    const snapshot = await this.dbGet(
      `SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 1`
    );

    if (!snapshot) {
      return { hasData: false };
    }

    try {
      const agvStates = JSON.parse(snapshot.agv_states);
      const wsStates = JSON.parse(snapshot.workstation_states);
      const statistics = snapshot.statistics ? JSON.parse(snapshot.statistics) : null;

      const agvSummary = {
        total: agvStates.length,
        idle: agvStates.filter(a => a.status === 'idle').length,
        moving: agvStates.filter(a => a.status === 'moving').length,
        waiting: agvStates.filter(a => a.status === 'waiting').length,
        avgUtilization: agvStates.reduce((sum, a) => sum + (a.utilization || 0), 0) / agvStates.length
      };

      const wsSummary = {
        total: wsStates.length,
        processing: wsStates.filter(w => w.status === 'processing').length,
        idle: wsStates.filter(w => w.status === 'idle').length,
        avgUtilization: wsStates.reduce((sum, w) => sum + (w.utilization || 0), 0) / wsStates.length
      };

      const heatmapData = this.generateHeatmapData(agvStates, wsStates);

      return {
        hasData: true,
        simulationTime: snapshot.simulation_time,
        completedOrders: snapshot.completed_orders,
        agvSummary,
        wsSummary,
        statistics,
        heatmapData,
        agvStates,
        wsStates,
        timestamp: snapshot.created_at
      };
    } catch (e) {
      return { hasData: false, error: e.message };
    }
  }

  generateHeatmapData(agvStates, wsStates) {
    const gridSize = 30;
    const heatmap = [];

    for (let x = 0; x <= 900; x += gridSize) {
      for (let y = 0; y <= 450; y += gridSize) {
        let intensity = 0;

        for (const agv of agvStates) {
          const dist = Math.sqrt((agv.x - x) ** 2 + (agv.y - y) ** 2);
          if (dist < 100) {
            intensity += (100 - dist) / 100 * 0.6;
          }
        }

        for (const ws of wsStates) {
          const dist = Math.sqrt((ws.x - x) ** 2 + (ws.y - y) ** 2);
          if (dist < 80) {
            intensity += (ws.utilization || 0) / 100 * (80 - dist) / 80 * 0.4;
          }
        }

        if (intensity > 0.05) {
          heatmap.push({
            x,
            y,
            intensity: Math.min(intensity, 1)
          });
        }
      }
    }

    return heatmap;
  }

  async getAGVPerformanceMetrics() {
    const results = await this.dbAll(
      `SELECT * FROM simulation_results ORDER BY created_at DESC LIMIT 20`
    );

    if (results.length === 0) {
      return [];
    }

    return results.map(r => ({
      timestamp: r.created_at,
      completionTime: r.total_completion_time,
      agvUtilization: r.avg_agv_utilization,
      throughput: r.throughput,
      ordersCompleted: r.total_orders_completed,
      deadlocks: r.deadlock_resolutions,
      collisions: r.total_collisions
    }));
  }

  generateBottleneckRecommendations(bottleneckStats, avgUtilizations) {
    const recommendations = [];

    if (bottleneckStats.length > 0) {
      const primary = bottleneckStats[0];
      recommendations.push({
        type: 'warning',
        message: `工位"${primary.stationName}"是主要瓶颈，出现频率为${primary.percentage}%`,
        suggestion: `建议增加"${primary.stationName}"的产能或优化其加工流程`
      });
    }

    if (avgUtilizations.length > 0) {
      const overloaded = avgUtilizations.filter(u => parseFloat(u.avgUtilization) > 70);
      if (overloaded.length > 0) {
        recommendations.push({
          type: 'info',
          message: `以下工位负载过高: ${overloaded.map(o => o.stationName).join(', ')}`,
          suggestion: '考虑增加AGV数量或调整调度策略以平衡工位负载'
        });
      }

      const underloaded = avgUtilizations.filter(u => parseFloat(u.avgUtilization) < 30 && parseFloat(u.avgUtilization) > 0);
      if (underloaded.length > 0) {
        recommendations.push({
          type: 'info',
          message: `以下工位负载过低: ${underloaded.map(u => u.stationName).join(', ')}`,
          suggestion: '这些工位可能存在资源浪费，可考虑合并或调整工位配置'
        });
      }
    }

    return recommendations;
  }

  calculateAverage(array, field) {
    if (array.length === 0) return 0;
    const sum = array.reduce((sum, item) => sum + (item[field] || 0), 0);
    return (sum / array.length).toFixed(2);
  }

  getDefaultKPI() {
    return {
      currentMetrics: {
        totalCompletionTime: 0,
        bottleneckStation: null,
        agvUtilization: 0,
        throughput: 0,
        ordersCompleted: 0,
        totalWaitTime: 0,
        deadlockResolutions: 0,
        collisions: 0
      },
      averages: {
        avgCompletionTime: 0,
        avgAgvUtilization: 0,
        avgThroughput: 0
      },
      totals: {
        totalDeadlocks: 0,
        totalCollisions: 0,
        simulationsCount: 0
      }
    };
  }

  dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
}

module.exports = KPIAnalyzer;
