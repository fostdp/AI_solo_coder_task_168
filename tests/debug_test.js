const { LogisticsSimulationFramework } = require('../server/framework/LogisticsFramework');

const TEST_WORKSTATIONS = [
  { id: 1, name: '原料仓库', type: 'warehouse', x: 50, y: 200, processing_time: 0, capacity: 10, status: 'idle' },
  { id: 2, name: '切割工位', type: 'cutting', x: 200, y: 100, processing_time: 3, capacity: 1, status: 'idle' },
  { id: 8, name: '成品仓库', type: 'finished', x: 350, y: 200, processing_time: 0, capacity: 10, status: 'idle' }
];

const TEST_AGVS = [
  { id: 1, name: 'AGV-01', speed: 15.0, capacity: 1, status: 'idle', current_station: 1, battery: 100 }
];

const TEST_ORDERS = [
  { id: 1, product_type: 'simple', quantity: 1, priority: 2, status: 'pending' }
];

const CUSTOM_ROUTES = {
  'simple': [1, 2, 8]
};

console.log('调试测试 - 简单流程');
console.log('='.repeat(70));

const simulation = new LogisticsSimulationFramework(TEST_WORKSTATIONS, TEST_AGVS, TEST_ORDERS);
simulation.processRoutes = CUSTOM_ROUTES;
simulation.totalJobs = 1;

simulation.start();

for (let i = 0; i < 200; i++) {
  simulation.step(0.5);
  
  if (i % 20 === 0 || simulation.completedJobs >= 1) {
    console.log(`\n--- 步骤 ${i}, 时间: ${simulation.time.toFixed(1)}s ---`);
    console.log('订单:', simulation.orders.map(o => ({ step: o.currentStep, remaining: o.remainingQuantity, completed: o.completedQuantity })));
    console.log('工位队列:', simulation.workstations.map(w => ({ name: w.name, queue: w.queue.filter(j=>j.completed).length + '/' + w.queue.length, current: w.currentJob ? '有' : '无' })));
    console.log('AGV:', simulation.agvs.map(a => ({ 
      name: a.name, 
      status: a.status, 
      x: a.x.toFixed(0), 
      y: a.y.toFixed(0), 
      task: a.currentTask ? `${a.currentTask.fromStation}->${a.currentTask.toStation}` : '无', 
      pathIdx: a.pathIndex,
      pathLen: a.path.length 
    })));
  }
  
  if (simulation.completedJobs >= 1) break;
}

simulation.stop();
console.log('\n测试结束，完成任务数:', simulation.completedJobs);
console.log('总时间:', simulation.time.toFixed(1) + 's');
