const { LogisticsSimulationFramework } = require('../server/framework/LogisticsFramework');

const TEST_WORKSTATIONS = [
  { id: 1, name: '原料仓库', type: 'warehouse', x: 50, y: 200, processing_time: 0, capacity: 10, status: 'idle' },
  { id: 2, name: '切割工位', type: 'cutting', x: 200, y: 100, processing_time: 3, capacity: 1, status: 'idle' },
  { id: 3, name: '冲压工位', type: 'stamping', x: 200, y: 300, processing_time: 4, capacity: 1, status: 'idle' },
  { id: 4, name: '焊接工位', type: 'welding', x: 400, y: 100, processing_time: 5, capacity: 1, status: 'idle' },
  { id: 5, name: '组装工位', type: 'assembly', x: 400, y: 300, processing_time: 6, capacity: 2, status: 'idle' },
  { id: 6, name: '喷涂工位', type: 'painting', x: 600, y: 200, processing_time: 4, capacity: 1, status: 'idle' },
  { id: 7, name: '质检工位', type: 'inspection', x: 750, y: 100, processing_time: 2, capacity: 1, status: 'idle' },
  { id: 8, name: '成品仓库', type: 'finished', x: 750, y: 300, processing_time: 0, capacity: 10, status: 'idle' }
];

const TEST_AGVS = [
  { id: 1, name: 'AGV-01', speed: 2.0, capacity: 1, status: 'idle', current_station: 1, battery: 100 },
  { id: 2, name: 'AGV-02', speed: 2.0, capacity: 1, status: 'idle', current_station: 1, battery: 100 },
  { id: 3, name: 'AGV-03', speed: 2.0, capacity: 1, status: 'idle', current_station: 1, battery: 100 }
];

const TEST_ORDERS = [
  { id: 1, product_type: 'A', quantity: 3, priority: 2, status: 'pending' }
];

console.log('物流模拟框架 - 简化测试');
console.log('='.repeat(70));

const simulation = new LogisticsSimulationFramework(TEST_WORKSTATIONS, TEST_AGVS, TEST_ORDERS);

let steps = 0;
const maxSteps = 2000;

simulation.start();

const interval = setInterval(() => {
  const state = simulation.step(0.5);
  steps++;
  
  if (steps % 200 === 0 || state.isComplete) {
    console.log(`步骤 ${steps}: 完成 ${state.completedJobs}/${state.totalJobs}, 时间: ${state.time.toFixed(1)}s, 冲突: ${state.totalCollisions}, 死锁解除: ${state.deadlockResolutions}`);
    
    for (const agv of state.agvs) {
      console.log(`  ${agv.name}: (${agv.x.toFixed(0)},${agv.y.toFixed(0)}) ${agv.status}, 等待: ${agv.waitTime.toFixed(1)}s`);
    }
  }
  
  if (state.isComplete) {
    clearInterval(interval);
    console.log('\n✅ 仿真完成!');
    const stats = simulation.getStatistics();
    console.log(`总耗时: ${state.time.toFixed(1)}s`);
    console.log(`平均AGV利用率: ${stats.avgAgvUtilization.toFixed(1)}%`);
    console.log(`吞吐量: ${stats.throughput.toFixed(3)}件/秒`);
    simulation.stop();
  } else if (steps >= maxSteps) {
    clearInterval(interval);
    console.log('\n⚠️  达到最大步骤数，强制停止');
    console.log(`进度: ${simulation.completedJobs}/${simulation.totalJobs}`);
    simulation.stop();
  }
}, 10);
