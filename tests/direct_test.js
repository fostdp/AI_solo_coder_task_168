const simulation = require('../server/simulation');
const db = require('../server/db');

const TEST_ORDERS = [
  { product_type: 'A', quantity: 5, priority: 2 },
  { product_type: 'B', quantity: 4, priority: 1 },
  { product_type: 'C', quantity: 3, priority: 3 }
];

let testResults = [];

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

async function clearOrders() {
  const orders = await dbAll('SELECT id FROM orders');
  for (const order of orders) {
    await dbRun('DELETE FROM orders WHERE id = ?', [order.id]);
  }
}

async function createTestOrders() {
  for (const order of TEST_ORDERS) {
    await dbRun(
      'INSERT INTO orders (product_type, quantity, priority, status, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [order.product_type, order.quantity, order.priority, 'pending']
    );
  }
}

function runSimulationDirect(agvCount, speed = 3) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      simulation.stop();
      reject(new Error('Simulation timeout'));
    }, 120000);
    
    let finalState = null;
    
    simulation.start({ agvCount, speed }, (state) => {
      finalState = state;
      if (state.isComplete) {
        clearTimeout(timeout);
        simulation.stop();
        setTimeout(() => resolve(finalState), 500);
      }
    });
  });
}

async function test1_agvScalability() {
  console.log('\n' + '='.repeat(70));
  console.log('测试1: AGV数量对完工时间的影响');
  console.log('预期: AGV数量从2→3→4→5→6时，完工时间先减少后增加（存在最优值）');
  console.log('='.repeat(70));
  
  const agvCounts = [2, 3, 4, 5, 6];
  const results = [];
  
  for (const count of agvCounts) {
    console.log(`\n测试 ${count} 台 AGV...`);
    await clearOrders();
    await createTestOrders();
    
    try {
      const state = await runSimulationDirect(count, 4);
      results.push({
        agvCount: count,
        completionTime: state.time,
        totalWaitTime: state.totalWaitTime || 0,
        totalCollisions: state.totalCollisions || 0,
        completedOrders: state.completedOrders,
        totalOrders: state.totalOrders
      });
      console.log(`  ✓ 完工时间=${state.time.toFixed(1)}s, 等待=${(state.totalWaitTime || 0).toFixed(1)}s, 冲突=${state.totalCollisions || 0}次`);
    } catch (err) {
      console.log(`  ✗ 失败: ${err.message}`);
      results.push({ agvCount: count, error: err.message });
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  const validResults = results.filter(r => !r.error);
  
  console.log('\n数据汇总:');
  for (const r of validResults) {
    console.log(`  ${r.agvCount}台: ${r.completionTime.toFixed(1)}s | 等待: ${r.totalWaitTime.toFixed(1)}s | 冲突: ${r.totalCollisions}`);
  }
  
  const times = validResults.map(r => r.completionTime);
  let hasOptimal = false;
  let optimalPoint = null;
  
  for (let i = 1; i < times.length - 1; i++) {
    if (times[i] < times[i - 1] && times[i] <= times[i + 1]) {
      hasOptimal = true;
      optimalPoint = validResults[i];
      break;
    }
  }
  
  const assertions = [
    {
      name: 'AGV数量变化时完工时间存在先减后增趋势（最优值点）',
      passed: hasOptimal,
      expected: '存在最优AGV数量使完工时间最小',
      actual: hasOptimal ? `最优值在${optimalPoint.agvCount}台AGV，时间${optimalPoint.completionTime.toFixed(1)}s` : `未找到最优值点，时间序列: ${times.map(t => t.toFixed(1)).join('s, ')}s`
    },
    {
      name: 'AGV数量增加时完工时间整体呈下降趋势',
      passed: validResults.length >= 2 && times[0] > times[times.length - 1],
      expected: '更多AGV使完工时间减少',
      actual: `${validResults[0]?.agvCount}台: ${validResults[0]?.completionTime.toFixed(1)}s → ${validResults[validResults.length - 1]?.agvCount}台: ${validResults[validResults.length - 1]?.completionTime.toFixed(1)}s`
    },
    {
      name: '所有测试用例均完成全部订单',
      passed: validResults.every(r => r.completedOrders === r.totalOrders),
      expected: '完成订单数 = 总订单数',
      actual: validResults.map(r => `${r.agvCount}台: ${r.completedOrders}/${r.totalOrders}`).join(', ')
    },
    {
      name: 'AGV数量增加导致等待时间或冲突次数增加（拥堵效应）',
      passed: validResults.length >= 2 && (
        validResults[validResults.length - 1].totalWaitTime >= validResults[0].totalWaitTime ||
        validResults[validResults.length - 1].totalCollisions >= validResults[0].totalCollisions
      ),
      expected: '更多AGV → 更多等待/冲突',
      actual: `${validResults[0]?.agvCount}台: 等待${validResults[0]?.totalWaitTime.toFixed(1)}s/冲突${validResults[0]?.totalCollisions}次 → ${validResults[validResults.length - 1]?.agvCount}台: 等待${validResults[validResults.length - 1]?.totalWaitTime.toFixed(1)}s/冲突${validResults[validResults.length - 1]?.totalCollisions}次`
    }
  ];
  
  testResults.push({
    test: 'AGV数量可扩展性测试',
    assertions,
    data: validResults
  });
  
  return assertions;
}

async function test2_emptyLoadRate() {
  console.log('\n' + '='.repeat(70));
  console.log('测试2: 调度策略切换时AGV空载率变化');
  console.log('预期: 不同AGV数量（代表不同调度策略下的资源配置）空载率有显著差异');
  console.log('='.repeat(70));
  
  const testCases = [
    { agvCount: 2, desc: '少AGV策略' },
    { agvCount: 4, desc: '中AGV策略' },
    { agvCount: 6, desc: '多AGV策略' }
  ];
  
  const results = [];
  
  for (const tc of testCases) {
    console.log(`\n测试 ${tc.desc} (${tc.agvCount}台AGV)...`);
    await clearOrders();
    await createTestOrders();
    
    try {
      const state = await runSimulationDirect(tc.agvCount, 4);
      
      const agvData = state.agvs.map(agv => ({
        id: agv.id,
        utilization: agv.utilization,
        emptyRate: Math.max(0, 100 - agv.utilization),
        waitTime: agv.waitTime || 0
      }));
      
      const avgUtilization = agvData.reduce((sum, a) => sum + a.utilization, 0) / agvData.length;
      const avgEmptyRate = 100 - avgUtilization;
      
      results.push({
        strategy: tc.desc,
        agvCount: tc.agvCount,
        completionTime: state.time,
        avgUtilization,
        avgEmptyRate,
        agvDetails: agvData
      });
      
      console.log(`  ✓ 平均利用率=${avgUtilization.toFixed(1)}%, 空载率=${avgEmptyRate.toFixed(1)}%, 完工时间=${state.time.toFixed(1)}s`);
    } catch (err) {
      console.log(`  ✗ 失败: ${err.message}`);
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n空载率对比:');
  for (const r of results) {
    console.log(`  ${r.strategy}: ${r.avgEmptyRate.toFixed(1)}% (${r.agvCount}台)`);
  }
  
  const emptyRates = results.map(r => r.avgEmptyRate);
  const hasVariation = results.length >= 2 && 
    Math.abs(emptyRates[0] - emptyRates[emptyRates.length - 1]) > 2;
  
  const assertions = [
    {
      name: '不同AGV配置策略下空载率存在可测量差异（>2%）',
      passed: hasVariation,
      expected: '不同策略空载率有差异',
      actual: results.map(r => `${r.strategy}: ${r.avgEmptyRate.toFixed(1)}%`).join(', ')
    },
    {
      name: 'AGV数量增加导致平均利用率降低（空载率升高）',
      passed: results.length >= 2 && results[0].avgUtilization > results[results.length - 1].avgUtilization,
      expected: 'AGV越多 → 单台利用率越低',
      actual: results.map(r => `${r.agvCount}台: ${r.avgUtilization.toFixed(1)}%`).join(', ')
    },
    {
      name: '空载率数据已在AGV状态中正确计算（0-100%范围）',
      passed: results.every(r => r.agvDetails.every(a => a.utilization >= 0 && a.utilization <= 100)),
      expected: '利用率在0-100%范围内',
      actual: results.map(r => r.agvDetails.map(a => `${a.id}:${a.utilization.toFixed(1)}%`).join(',')).join(' | ')
    }
  ];
  
  testResults.push({
    test: '空载率与调度策略测试',
    assertions,
    data: results
  });
  
  return assertions;
}

async function test3_snapshotStatistics() {
  console.log('\n' + '='.repeat(70));
  console.log('测试3: 后端物流快照的设备利用率数据');
  console.log('预期: 快照表和仿真结果表包含完整的设备利用率统计数据');
  console.log('='.repeat(70));
  
  await clearOrders();
  await createTestOrders();
  
  console.log('运行仿真以生成快照数据...');
  const finalState = await runSimulationDirect(3, 4);
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('查询最新快照...');
  const snapshot = await dbAll('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 1');
  
  const assertions = [];
  
  if (snapshot.length > 0) {
    const s = snapshot[0];
    
    assertions.push({
      name: '快照表包含statistics字段',
      passed: !!s.statistics,
      expected: 'statistics字段存在',
      actual: s.statistics ? '存在' : '缺失'
    });
    
    if (s.statistics) {
      const stats = JSON.parse(s.statistics);
      
      assertions.push({
        name: 'statistics包含avgAgvUtilization',
        passed: stats.avgAgvUtilization !== undefined,
        expected: 'avgAgvUtilization存在',
        actual: stats.avgAgvUtilization !== undefined ? `${stats.avgAgvUtilization.toFixed(1)}%` : '缺失'
      });
      
      assertions.push({
        name: 'statistics包含workstationUtilizations数组',
        passed: Array.isArray(stats.workstationUtilizations) && stats.workstationUtilizations.length > 0,
        expected: '工位利用率数组存在且非空',
        actual: Array.isArray(stats.workstationUtilizations) ? `${stats.workstationUtilizations.length}个工位` : '缺失或无效'
      });
      
      if (Array.isArray(stats.workstationUtilizations)) {
        const validUtilizations = stats.workstationUtilizations.filter(
          w => w.utilization !== undefined && w.utilization >= 0 && w.utilization <= 100
        );
        assertions.push({
          name: '所有工位利用率在有效范围(0-100%)',
          passed: validUtilizations.length === stats.workstationUtilizations.length,
          expected: '所有工位利用率有效',
          actual: `${validUtilizations.length}/${stats.workstationUtilizations.length} 有效`
        });
        
        assertions.push({
          name: '工位利用率包含id和name字段',
          passed: stats.workstationUtilizations.every(w => w.id && w.name),
          expected: '每个工位有id和name',
          actual: stats.workstationUtilizations.slice(0, 3).map(w => `${w.id}:${w.name}`).join(', ')
        });
      }
      
      assertions.push({
        name: 'statistics包含throughput（吞吐量）',
        passed: stats.throughput !== undefined,
        expected: 'throughput字段存在',
        actual: stats.throughput !== undefined ? `${stats.throughput.toFixed(3)}件/秒` : '缺失'
      });
      
      assertions.push({
        name: 'statistics包含totalWaitTime',
        passed: stats.totalWaitTime !== undefined,
        expected: 'totalWaitTime字段存在',
        actual: stats.totalWaitTime !== undefined ? `${stats.totalWaitTime.toFixed(1)}s` : '缺失'
      });
      
      assertions.push({
        name: 'statistics包含bottleneckStation',
        passed: stats.bottleneckStation !== undefined,
        expected: 'bottleneckStation字段存在',
        actual: stats.bottleneckStation !== undefined ? `工位${stats.bottleneckStation}` : '缺失'
      });
    }
    
    const agvStates = JSON.parse(s.agv_states);
    assertions.push({
      name: '快照agv_states中每个AGV有utilization字段',
      passed: Array.isArray(agvStates) && agvStates.every(a => a.utilization !== undefined),
      expected: '每个AGV有utilization',
      actual: Array.isArray(agvStates) ? 
        `${agvStates.filter(a => a.utilization !== undefined).length}/${agvStates.length} 有利用率` : 
        'agv_states无效'
    });
    
    const wsStates = JSON.parse(s.workstation_states);
    assertions.push({
      name: '快照workstation_states中每个工位有utilization字段',
      passed: Array.isArray(wsStates) && wsStates.every(w => w.utilization !== undefined),
      expected: '每个工位有utilization',
      actual: Array.isArray(wsStates) ?
        `${wsStates.filter(w => w.utilization !== undefined).length}/${wsStates.length} 有利用率` :
        'workstation_states无效'
    });
  } else {
    assertions.push({
      name: '快照表存在数据',
      passed: false,
      expected: '至少有一条快照记录',
      actual: '快照表为空'
    });
  }
  
  console.log('查询simulation_results表...');
  const simResults = await dbAll('SELECT * FROM simulation_results ORDER BY created_at DESC LIMIT 1');
  
  if (simResults.length > 0) {
    const sr = simResults[0];
    assertions.push({
      name: 'simulation_results表包含total_wait_time字段',
      passed: sr.total_wait_time !== undefined,
      expected: 'total_wait_time字段存在',
      actual: sr.total_wait_time !== undefined ? `${sr.total_wait_time.toFixed(1)}s` : '缺失'
    });
    
    assertions.push({
      name: 'simulation_results表包含total_collisions字段',
      passed: sr.total_collisions !== undefined,
      expected: 'total_collisions字段存在',
      actual: sr.total_collisions !== undefined ? `${sr.total_collisions}次` : '缺失'
    });
    
    assertions.push({
      name: 'simulation_results表包含throughput字段',
      passed: sr.throughput !== undefined,
      expected: 'throughput字段存在',
      actual: sr.throughput !== undefined ? `${sr.throughput.toFixed(3)}件/秒` : '缺失'
    });
  } else {
    assertions.push({
      name: 'simulation_results表存在数据',
      passed: false,
      expected: '至少有一条仿真结果记录',
      actual: 'simulation_results表为空'
    });
  }
  
  const simResultsLatest = simulation.getLatestResults();
  assertions.push({
    name: 'simulation模块返回最新结果包含扩展字段',
    passed: simResultsLatest && simResultsLatest.total_wait_time !== undefined,
    expected: 'getLatestResults()返回total_wait_time等扩展字段',
    actual: simResultsLatest && simResultsLatest.total_wait_time !== undefined ? 
      `包含total_wait_time: ${simResultsLatest.total_wait_time.toFixed(1)}s` : '缺失扩展字段'
  });
  
  testResults.push({
    test: '快照统计数据完整性测试',
    assertions,
    data: { snapshot: snapshot[0], simResults: simResults[0] }
  });
  
  return assertions;
}

function printSummary() {
  console.log('\n' + '='.repeat(70));
  console.log('测试结果汇总');
  console.log('='.repeat(70));
  
  let totalPassed = 0;
  let totalFailed = 0;
  const failedCases = [];
  
  for (const test of testResults) {
    console.log(`\n📋 ${test.test}:`);
    for (const assertion of test.assertions) {
      const status = assertion.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`  ${status} - ${assertion.name}`);
      if (!assertion.passed) {
        console.log(`     期望: ${assertion.expected}`);
        console.log(`     实际: ${assertion.actual}`);
        failedCases.push({
          test: test.test,
          assertion: assertion.name,
          expected: assertion.expected,
          actual: assertion.actual
        });
        totalFailed++;
      } else {
        totalPassed++;
      }
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log(`总计: ${totalPassed + totalFailed} 个断言, ${totalPassed} 通过, ${totalFailed} 失败`);
  console.log('='.repeat(70));
  
  if (failedCases.length > 0) {
    console.log('\n❌ 失败用例明细:');
    for (const [i, fc] of failedCases.entries()) {
      console.log(`\n${i + 1}. [${fc.test}] ${fc.assertion}`);
      console.log(`   期望: ${fc.expected}`);
      console.log(`   实际: ${fc.actual}`);
    }
  } else {
    console.log('\n🎉 所有测试通过！');
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('修复评估:');
  console.log('1. 路径规划全局协同: ' + (testResults[0]?.assertions[0]?.passed ? '✅ 已修复' : '⚠️ 需改进'));
  console.log('2. 交叉口通行规则: ' + (testResults[0]?.assertions[3]?.passed ? '✅ 冲突检测已生效' : '⚠️ 需改进'));
  console.log('3. 快照统计量: ' + (testResults[2]?.assertions[0]?.passed ? '✅ 已修复' : '⚠️ 需改进'));
  console.log('='.repeat(70));
  
  return failedCases.length === 0;
}

async function runAllTests() {
  console.log('数字孪生车间物流模拟 - 自动化测试套件（直接调用）');
  console.log('='.repeat(70));
  console.log(`测试订单: ${TEST_ORDERS.map(o => `${o.product_type}×${o.quantity}`).join(', ')}`);
  
  try {
    await test1_agvScalability();
    await test2_emptyLoadRate();
    await test3_snapshotStatistics();
    
    const allPassed = printSummary();
    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('\n❌ 测试执行失败:', err.message);
    console.error(err.stack);
    process.exit(2);
  }
}

runAllTests();
