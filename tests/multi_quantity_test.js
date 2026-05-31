const { LogisticsSimulationFramework } = require('../server/framework/LogisticsFramework');

const TEST_WORKSTATIONS = [
  { id: 1, name: '原料仓库', type: 'warehouse', x: 50, y: 200, processing_time: 0, capacity: 10, status: 'idle' },
  { id: 2, name: '切割工位', type: 'cutting', x: 200, y: 100, processing_time: 3, capacity: 1, status: 'idle' },
  { id: 8, name: '成品仓库', type: 'finished', x: 350, y: 200, processing_time: 0, capacity: 10, status: 'idle' }
];

const TEST_AGVS = [
  { id: 1, name: 'AGV-01', speed: 15.0, capacity: 1, status: 'idle', current_station: 1, battery: 100 },
  { id: 2, name: 'AGV-02', speed: 15.0, capacity: 1, status: 'idle', current_station: 1, battery: 100 }
];

const TEST_ORDERS = [
  { id: 1, product_type: 'simple', quantity: 4, priority: 2, status: 'pending' }
];

const CUSTOM_ROUTES = {
  'simple': [1, 2, 8]
};

console.log('多数量订单测试');
console.log('='.repeat(70));

const simulation = new LogisticsSimulationFramework(TEST_WORKSTATIONS, TEST_AGVS, TEST_ORDERS);
simulation.processRoutes = CUSTOM_ROUTES;
simulation.totalJobs = 4;

simulation.start();

for (let i = 0; i < 500; i++) {
  simulation.step(0.5);
  
  if (i % 50 === 0 || simulation.completedJobs >= 4) {
    console.log(`\n--- 步骤 ${i}, 时间: ${simulation.time.toFixed(1)}s, 完成: ${simulation.completedJobs}/4 ---`);
    console.log('订单:', simulation.orders.map(o => ({ remaining: o.remainingQuantity, completed: o.completedQuantity })));
    console.log('工位队列:', simulation.workstations.map(w => ({ 
      name: w.name, 
      queue: w.queue.length, 
      completed: w.queue.filter(j=>j.completed).length,
      current: w.currentJob ? '有' : '无' 
    })));
    console.log('AGV状态:', simulation.agvs.map(a => ({ 
      name: a.name, 
      status: a.status, 
      task: a.currentTask ? `${a.currentTask.fromStation}->${a.currentTask.toStation}(step${a.currentTask.step})` : '无'
    })));
  }
  
  if (simulation.completedJobs >= 4) break;
}

simulation.stop();
console.log('\n' + '='.repeat(70));
console.log('测试结束!');
console.log(`完成任务数: ${simulation.completedJobs}/4`);
console.log(`总耗时: ${simulation.time.toFixed(1)}s`);
