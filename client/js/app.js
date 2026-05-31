class WorkshopSimulation {
  constructor() {
    this.canvas = document.getElementById('workshopCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.ws = null;
    this.isRunning = false;
    this.currentState = null;
    this.workstations = [];
    this.agvs = [];
    this.orders = [];
    this.speed = 1;
    this.agvCount = 3;
    this.heatmapData = [];
    this.showHeatmap = true;
    this.kpiData = null;
    this.dashboardData = null;
    
    this.init();
  }

  async init() {
    await this.loadData();
    this.setupEventListeners();
    this.connectWebSocket();
    this.loadKPI();
    this.render();
  }

  async loadData() {
    try {
      const [wsRes, agvRes, ordersRes] = await Promise.all([
        fetch('/api/workstations'),
        fetch('/api/agvs'),
        fetch('/api/orders')
      ]);
      
      this.workstations = await wsRes.json();
      this.agvs = await agvRes.json();
      this.orders = await ordersRes.json();
      
      this.updateOrderList();
      this.updateAgvList();
      this.updateUtilizationChart();
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }

  async loadKPI() {
    try {
      const [kpiRes, bottleneckRes] = await Promise.all([
        fetch('/api/kpi/overview'),
        fetch('/api/kpi/bottleneck')
      ]);
      
      this.kpiData = await kpiRes.json();
      const bottleneckData = await bottleneckRes.json();
      
      this.updateKPIDashboard();
      this.updateBottleneckPanel(bottleneckData);
    } catch (error) {
      console.error('Failed to load KPI:', error);
    }
  }

  setupEventListeners() {
    document.getElementById('startBtn').addEventListener('click', () => this.startSimulation());
    document.getElementById('stopBtn').addEventListener('click', () => this.stopSimulation());
    document.getElementById('addOrderBtn').addEventListener('click', () => this.addOrder());
    
    document.getElementById('speedSlider').addEventListener('input', (e) => {
      this.speed = parseFloat(e.target.value);
      document.getElementById('speedValue').textContent = this.speed + 'x';
      if (this.isRunning && this.ws) {
        this.ws.send(JSON.stringify({ type: 'update_params', params: { speed: this.speed } }));
      }
    });
    
    document.getElementById('agvCount').addEventListener('input', (e) => {
      this.agvCount = parseInt(e.target.value);
      document.getElementById('agvCountValue').textContent = this.agvCount;
    });

    document.getElementById('heatmapToggle').addEventListener('change', (e) => {
      this.showHeatmap = e.target.checked;
    });
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('Connected to simulation server');
      this.updateConnectionStatus(true);
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleWebSocketMessage(message);
    };

    this.ws.onclose = () => {
      console.log('Disconnected from simulation server');
      this.updateConnectionStatus(false);
      setTimeout(() => this.connectWebSocket(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.updateConnectionStatus(false);
    };
  }

  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'state_update':
        this.handleStateUpdate(message.state);
        break;
      case 'kpi_update':
        this.dashboardData = message.dashboard;
        this.updateRealtimeDashboard(message.dashboard);
        if (message.dashboard.heatmapData) {
          this.heatmapData = message.dashboard.heatmapData;
        }
        break;
      case 'simulation_started':
        console.log('Simulation started:', message.params);
        break;
      case 'connected':
        console.log('WebSocket connected');
        break;
    }
  }

  startSimulation() {
    if (this.orders.length === 0) {
      alert('请先添加订单！');
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'start_simulation',
        params: {
          agvCount: this.agvCount,
          speed: this.speed
        }
      }));
      this.isRunning = true;
      this.updateButtons();
    }
  }

  stopSimulation() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop_simulation' }));
    }
    this.isRunning = false;
    this.updateButtons();
    this.loadKPI();
  }

  updateButtons() {
    document.getElementById('startBtn').disabled = this.isRunning;
    document.getElementById('stopBtn').disabled = !this.isRunning;
    document.getElementById('addOrderBtn').disabled = this.isRunning;
    document.getElementById('agvCount').disabled = this.isRunning;
  }

  async addOrder() {
    const productType = document.getElementById('productType').value;
    const quantity = parseInt(document.getElementById('orderQuantity').value);
    const priority = parseInt(document.getElementById('orderPriority').value);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_type: productType, quantity, priority })
      });
      
      if (res.ok) {
        const order = await res.json();
        this.orders.push(order);
        this.updateOrderList();
      }
    } catch (error) {
      console.error('Failed to add order:', error);
    }
  }

  async deleteOrder(id) {
    try {
      await fetch(`/api/orders/${id}`, { method: 'DELETE' });
      this.orders = this.orders.filter(o => o.id !== id);
      this.updateOrderList();
    } catch (error) {
      console.error('Failed to delete order:', error);
    }
  }

  updateConnectionStatus(connected) {
    const status = document.getElementById('connectionStatus');
    if (connected) {
      status.textContent = '● 已连接';
      status.className = 'connection-status connected';
    } else {
      status.textContent = '○ 未连接';
      status.className = 'connection-status disconnected';
    }
  }

  updateOrderList() {
    const container = document.getElementById('orderList');
    if (this.orders.length === 0) {
      container.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">暂无订单</div>';
      return;
    }
    
    const priorityLabels = { 1: '低', 2: '中', 3: '高' };
    const priorityColors = { 1: '#4CAF50', 2: '#FF9800', 3: '#F44336' };
    
    container.innerHTML = this.orders.map(order => `
      <div class="order-item">
        <div class="order-info">
          <span class="product-type">产品${order.product_type}</span>
          <div class="order-meta">
            数量: ${order.quantity} | 
            优先级: <span style="color: ${priorityColors[order.priority]}">${priorityLabels[order.priority]}</span>
          </div>
        </div>
        <button class="delete-btn" onclick="app.deleteOrder(${order.id})">×</button>
      </div>
    `).join('');
  }

  updateAgvList() {
    const container = document.getElementById('agvList');
    const displayAgvs = this.agvs.slice(0, this.agvCount);
    container.innerHTML = displayAgvs.map(agv => {
      const state = this.currentState?.agvs?.find(a => a.id === agv.id);
      const status = state?.status || agv.status;
      const utilization = state?.utilization?.toFixed(1) || '0.0';
      const waitTime = state?.waitTime?.toFixed(1) || '0.0';
      const collisionCount = state?.collisionCount || 0;
      const statusText = {
        'idle': '空闲',
        'moving': '移动',
        'waiting': '等待',
        'loading': '装卸'
      }[status] || status;
      
      return `
        <div class="agv-item">
          <div class="agv-info">
            <span class="agv-status ${status}"></span>
            <span>${agv.name} - ${statusText}</span>
            <div class="agv-utilization">
              利用率: ${utilization}% | 等待: ${waitTime}s | 冲突: ${collisionCount}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  handleStateUpdate(state) {
    this.currentState = state;
    
    document.getElementById('simTime').textContent = state.time.toFixed(1) + 's';
    document.getElementById('completedOrders').textContent = `${state.completedOrders}/${state.totalOrders}`;
    document.getElementById('completedJobs').textContent = `${state.completedJobs}/${state.totalJobs}`;
    document.getElementById('bottleneck').textContent = state.bottleneck?.name || '-';
    document.getElementById('totalWaitTime').textContent = (state.totalWaitTime || 0).toFixed(1) + 's';
    document.getElementById('totalCollisions').textContent = state.totalCollisions || 0;
    
    this.updateAgvList();
    this.updateUtilizationChart();
    
    if (state.isComplete) {
      this.isRunning = false;
      this.updateButtons();
      this.loadKPI();
      this.showCompletionDialog(state);
    }
  }

  showCompletionDialog(state) {
    alert(`仿真完成！\n\n` +
      `总耗时: ${state.time.toFixed(1)}s\n` +
      `完成订单: ${state.completedOrders}/${state.totalOrders}\n` +
      `完成工件: ${state.completedJobs}/${state.totalJobs}\n` +
      `瓶颈工位: ${state.bottleneck?.name || '无'}\n` +
      `总等待时间: ${(state.totalWaitTime || 0).toFixed(1)}s\n` +
      `冲突次数: ${state.totalCollisions || 0}`);
  }

  updateUtilizationChart() {
    const container = document.getElementById('utilizationChart');
    const workstations = this.currentState?.workstations || this.workstations.map(w => ({ ...w, utilization: 0 }));
    const bottleneckId = this.currentState?.bottleneck?.id;
    
    container.innerHTML = workstations
      .filter(w => w.processing_time !== undefined ? w.processing_time > 0 : true)
      .map(ws => {
        const utilization = ws.utilization || 0;
        const isBottleneck = bottleneckId === ws.id;
        return `
          <div class="utilization-bar">
            <div class="utilization-bar-fill ${isBottleneck ? 'bottleneck' : ''}" style="height: ${utilization}%"></div>
            <span class="utilization-bar-value">${utilization.toFixed(0)}%</span>
            <span class="utilization-bar-label">${ws.name}</span>
          </div>
        `;
      }).join('');
  }

  updateKPIDashboard() {
    if (!this.kpiData) return;
    
    const metrics = this.kpiData.currentMetrics;
    const averages = this.kpiData.averages;
    
    document.getElementById('kpiCompletionTime').textContent = 
      metrics.totalCompletionTime ? metrics.totalCompletionTime.toFixed(1) + 's' : '-';
    document.getElementById('kpiThroughput').textContent = 
      metrics.throughput ? metrics.throughput.toFixed(3) + ' 件/s' : '-';
    document.getElementById('kpiAgvUtilization').textContent = 
      metrics.agvUtilization ? metrics.agvUtilization.toFixed(1) + '%' : '-';
    document.getElementById('kpiDeadlocks').textContent = metrics.deadlockResolutions || 0;
    document.getElementById('kpiOrdersCompleted').textContent = metrics.ordersCompleted || 0;
  }

  updateBottleneckPanel(bottleneckData) {
    const container = document.getElementById('bottleneckAnalysis');
    if (!bottleneckData || !bottleneckData.bottleneckHistory) {
      container.innerHTML = '<div style="color: #888; padding: 10px;">暂无瓶颈分析数据</div>';
      return;
    }

    let html = '';
    
    if (bottleneckData.primaryBottleneck) {
      html += `
        <div class="bottleneck-primary">
          <span class="bottleneck-label">主要瓶颈:</span>
          <span class="bottleneck-name">${bottleneckData.primaryBottleneck.stationName}</span>
          <span class="bottleneck-percentage">${bottleneckData.primaryBottleneck.percentage}%</span>
        </div>
      `;
    }

    html += '<div class="bottleneck-history">';
    bottleneckData.bottleneckHistory.slice(0, 5).forEach(item => {
      html += `
        <div class="bottleneck-item">
          <span>${item.stationName}</span>
          <div class="bottleneck-bar">
            <div class="bottleneck-bar-fill" style="width: ${item.percentage}%"></div>
          </div>
          <span class="bottleneck-count">${item.occurrenceCount}次</span>
        </div>
      `;
    });
    html += '</div>';

    if (bottleneckData.recommendations && bottleneckData.recommendations.length > 0) {
      html += '<div class="recommendations">';
      bottleneckData.recommendations.forEach(rec => {
        html += `
          <div class="recommendation ${rec.type}">
            <div class="rec-message">${rec.message}</div>
            <div class="rec-suggestion">💡 ${rec.suggestion}</div>
          </div>
        `;
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  updateRealtimeDashboard(dashboard) {
    if (!dashboard || !dashboard.hasData) return;

    if (dashboard.agvSummary) {
      document.getElementById('agvTotal').textContent = dashboard.agvSummary.total;
      document.getElementById('agvIdle').textContent = dashboard.agvSummary.idle;
      document.getElementById('agvMoving').textContent = dashboard.agvSummary.moving;
      document.getElementById('agvWaiting').textContent = dashboard.agvSummary.waiting;
      document.getElementById('agvAvgUtil').textContent = dashboard.agvSummary.avgUtilization.toFixed(1) + '%';
    }

    if (dashboard.wsSummary) {
      document.getElementById('wsTotal').textContent = dashboard.wsSummary.total;
      document.getElementById('wsProcessing').textContent = dashboard.wsSummary.processing;
      document.getElementById('wsIdle').textContent = dashboard.wsSummary.idle;
      document.getElementById('wsAvgUtil').textContent = dashboard.wsSummary.avgUtilization.toFixed(1) + '%';
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    this.drawGrid();
    
    if (this.showHeatmap && this.heatmapData.length > 0) {
      this.drawHeatmap();
    }
    
    this.drawPaths();
    this.drawWorkstations();
    this.drawAgvs();
    
    requestAnimationFrame(() => this.render());
  }

  drawGrid() {
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    this.ctx.lineWidth = 1;
    
    for (let x = 0; x < this.canvas.width; x += 50) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }
    
    for (let y = 0; y < this.canvas.height; y += 50) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
  }

  drawHeatmap() {
    for (const point of this.heatmapData) {
      const gradient = this.ctx.createRadialGradient(
        point.x, point.y, 0,
        point.x, point.y, 40
      );
      
      const alpha = point.intensity * 0.4;
      gradient.addColorStop(0, `rgba(255, 100, 100, ${alpha})`);
      gradient.addColorStop(0.5, `rgba(255, 200, 50, ${alpha * 0.5})`);
      gradient.addColorStop(1, 'rgba(255, 255, 0, 0)');
      
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, 40, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawPaths() {
    const processRoutes = [
      [1, 2, 4, 5, 6, 7, 8],
      [1, 3, 4, 5, 6, 7, 8],
      [1, 2, 3, 5, 6, 7, 8]
    ];
    
    const colors = ['rgba(0, 212, 255, 0.2)', 'rgba(123, 47, 247, 0.2)', 'rgba(255, 152, 0, 0.2)'];
    
    processRoutes.forEach((route, routeIndex) => {
      this.ctx.strokeStyle = colors[routeIndex];
      this.ctx.lineWidth = 3;
      this.ctx.setLineDash([5, 5]);
      
      for (let i = 0; i < route.length - 1; i++) {
        const from = this.workstations.find(w => w.id === route[i]);
        const to = this.workstations.find(w => w.id === route[i + 1]);
        
        if (from && to) {
          this.ctx.beginPath();
          this.ctx.moveTo(from.x, from.y);
          this.ctx.lineTo(to.x, to.y);
          this.ctx.stroke();
        }
      }
      
      this.ctx.setLineDash([]);
    });
  }

  drawWorkstations() {
    const workstationColors = {
      warehouse: { bg: '#2e7d32', border: '#4caf50' },
      cutting: { bg: '#1565c0', border: '#2196f3' },
      stamping: { bg: '#6a1b9a', border: '#9c27b0' },
      welding: { bg: '#ef6c00', border: '#ff9800' },
      assembly: { bg: '#c62828', border: '#f44336' },
      painting: { bg: '#00695c', border: '#009688' },
      inspection: { bg: '#283593', border: '#3f51b5' },
      finished: { bg: '#33691e', border: '#8bc34a' }
    };

    const bottleneckId = this.currentState?.bottleneck?.id;

    this.workstations.forEach(ws => {
      const state = this.currentState?.workstations?.find(s => s.id === ws.id);
      const status = state?.status || 'idle';
      const colors = workstationColors[ws.type] || { bg: '#424242', border: '#757575' };
      const isBottleneck = bottleneckId === ws.id;
      
      const wsWidth = 80;
      const wsHeight = 60;
      const x = ws.x - wsWidth / 2;
      const y = ws.y - wsHeight / 2;
      
      this.ctx.shadowColor = isBottleneck ? '#F44336' : 'rgba(0, 0, 0, 0.3)';
      this.ctx.shadowBlur = isBottleneck ? 20 : 10;
      
      this.ctx.fillStyle = isBottleneck ? '#c62828' : colors.bg;
      this.ctx.strokeStyle = isBottleneck ? '#F44336' : colors.border;
      this.ctx.lineWidth = isBottleneck ? 3 : 2;
      
      this.roundRect(x, y, wsWidth, wsHeight, 8);
      this.ctx.fill();
      this.ctx.stroke();
      
      this.ctx.shadowBlur = 0;
      
      if (status === 'processing') {
        const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
        this.ctx.fillStyle = `rgba(255, 152, 0, ${pulse})`;
        this.ctx.beginPath();
        this.arc(ws.x + wsWidth / 2 - 10, y + 10, 5, 0, Math.PI * 2);
        this.ctx.fill();
      }
      
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 11px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(ws.name, ws.x, y + 28);
      
      this.ctx.font = '10px Arial';
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      if (state) {
        this.ctx.fillText(`队列: ${state.queueLength} | ${state.utilization.toFixed(0)}%`, ws.x, y + 45);
      } else {
        this.ctx.fillText(`处理: ${ws.processing_time}s`, ws.x, y + 45);
      }

      if (state && state.queueLength > 0) {
        this.ctx.fillStyle = '#FF9800';
        this.ctx.beginPath();
        this.ctx.arc(ws.x + wsWidth / 2 - 5, y - 5, 8, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 10px Arial';
        this.ctx.fillText(state.queueLength, ws.x + wsWidth / 2 - 5, y - 2);
      }
    });
  }

  drawAgvs() {
    const agvsToDraw = this.currentState?.agvs?.slice(0, this.agvCount) || this.agvs.slice(0, this.agvCount);
    
    agvsToDraw.forEach(agv => {
      const x = agv.x;
      const y = agv.y;
      
      if (agv.status === 'moving' && agv.path && agv.path.length > 0) {
        this.ctx.strokeStyle = 'rgba(33, 150, 243, 0.3)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        
        const endPoint = agv.path[agv.path.length - 1];
        if (endPoint) {
          this.ctx.lineTo(endPoint.x, endPoint.y);
        }
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }
      
      const statusColor = {
        'idle': '#4CAF50',
        'moving': '#2196F3',
        'waiting': '#FF5722',
        'loading': '#FF9800'
      }[agv.status] || '#2196F3';
      
      this.ctx.shadowColor = statusColor;
      this.ctx.shadowBlur = 15;
      
      this.ctx.fillStyle = '#1976D2';
      this.ctx.strokeStyle = statusColor;
      this.ctx.lineWidth = 2;
      
      this.ctx.beginPath();
      this.roundRect(x - 18, y - 12, 36, 24, 6);
      this.ctx.fill();
      this.ctx.stroke();
      
      this.ctx.shadowBlur = 0;
      
      this.ctx.fillStyle = '#64B5F6';
      this.ctx.beginPath();
      this.ctx.arc(x - 12, y - 6, 3, 0, Math.PI * 2);
      this.ctx.arc(x + 12, y - 6, 3, 0, Math.PI * 2);
      this.ctx.arc(x - 12, y + 6, 3, 0, Math.PI * 2);
      this.ctx.arc(x + 12, y + 6, 3, 0, Math.PI * 2);
      this.ctx.fill();
      
      if (agv.currentTask) {
        this.ctx.fillStyle = '#FFD54F';
        this.ctx.fillRect(x - 6, y - 4, 12, 8);
      }
      
      this.ctx.fillStyle = statusColor;
      this.ctx.beginPath();
      this.ctx.arc(x + 15, y - 10, 4, 0, Math.PI * 2);
      this.ctx.fill();
      
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 9px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(agv.name, x, y + 22);
    });
  }

  roundRect(x, y, width, height, radius) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
  }
}

const app = new WorkshopSimulation();
