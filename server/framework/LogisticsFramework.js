class EventQueue {
  constructor() {
    this.events = [];
  }

  enqueue(event) {
    this.events.push(event);
    this.events.sort((a, b) => a.time - b.time);
  }

  dequeue() {
    return this.events.shift();
  }

  peek() {
    return this.events[0];
  }

  isEmpty() {
    return this.events.length === 0;
  }

  clear() {
    this.events = [];
  }

  size() {
    return this.events.length;
  }
}

class GlobalPathPlanner {
  constructor(workstations, intersections) {
    this.workstations = workstations;
    this.intersections = intersections || [];
    this.INTERSECTION_RADIUS = 25;
    this.SAFE_DISTANCE = 40;
    this.reservedSegments = new Map();
  }

  distance(p1, p2) {
    return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
  }

  findPath(start, end, agv, allAgvs) {
    const path = [];
    let current = { x: start.x, y: start.y };
    const stepSize = 10;
    let maxSteps = 500;
    let steps = 0;

    while (this.distance(current, end) > stepSize && steps < maxSteps) {
      const candidates = this.generateCandidates(current, end, stepSize);
      
      let bestCandidate = null;
      let bestScore = Infinity;

      for (const candidate of candidates) {
        const score = this.evaluateCandidate(candidate, end, agv, allAgvs);
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) break;
      
      current = { ...bestCandidate };
      path.push({ x: current.x, y: current.y });
      steps++;
    }

    path.push({ x: end.x, y: end.y });
    return path;
  }

  generateCandidates(current, end, stepSize) {
    const candidates = [];
    
    if (Math.abs(current.x - end.x) > stepSize / 2) {
      candidates.push({
        x: current.x + (current.x < end.x ? stepSize : -stepSize),
        y: current.y
      });
    }
    
    if (Math.abs(current.y - end.y) > stepSize / 2) {
      candidates.push({
        x: current.x,
        y: current.y + (current.y < end.y ? stepSize : -stepSize)
      });
    }
    
    if (candidates.length === 0) {
      candidates.push({ x: end.x, y: end.y });
    }
    
    return candidates;
  }

  evaluateCandidate(candidate, end, agv, allAgvs) {
    let score = this.distance(candidate, end);

    for (const other of allAgvs) {
      if (other.id === agv.id || other.status !== 'moving') continue;
      const distToOther = this.distance(candidate, { x: other.x, y: other.y });
      if (distToOther < this.SAFE_DISTANCE) {
        score += (this.SAFE_DISTANCE - distToOther) * 20;
      }
    }

    for (const intersection of this.intersections) {
      const distToIntersection = this.distance(candidate, intersection);
      if (distToIntersection < this.INTERSECTION_RADIUS * 2) {
        const occupied = allAgvs.some(a => 
          a.id !== agv.id && 
          this.distance({ x: a.x, y: a.y }, intersection) < this.INTERSECTION_RADIUS
        );
        if (occupied) {
          score += 1000;
        } else if (distToIntersection < this.INTERSECTION_RADIUS) {
          score += 50;
        }
      }
    }

    const segmentKey = `${Math.floor(candidate.x / 20)},${Math.floor(candidate.y / 20)}`;
    if (this.reservedSegments.has(segmentKey) && this.reservedSegments.get(segmentKey) !== agv.id) {
      score += 500;
    }

    return score;
  }

  reserveSegment(agvId, position) {
    const segmentKey = `${Math.floor(position.x / 20)},${Math.floor(position.y / 20)}`;
    this.reservedSegments.set(segmentKey, agvId);
  }

  releaseSegment(position) {
    const segmentKey = `${Math.floor(position.x / 20)},${Math.floor(position.y / 20)}`;
    this.reservedSegments.delete(segmentKey);
  }

  clearReservations() {
    this.reservedSegments.clear();
  }
}

class DeadlockDetector {
  constructor(agvs, workstations) {
    this.agvs = agvs;
    this.workstations = workstations;
    this.WAIT_THRESHOLD = 30;
    this.MAX_WAIT_TIME = 120;
  }

  detect() {
    const waitingAgvs = this.agvs.filter(a => a.status === 'waiting' || a.waitTime > this.WAIT_THRESHOLD);
    
    if (waitingAgvs.length < 2) return { hasDeadlock: false };

    const waitGraph = this.buildWaitGraph();
    const cycle = this.findCycle(waitGraph);

    if (cycle) {
      return {
        hasDeadlock: true,
        type: 'circular_wait',
        affectedAgvs: cycle,
        severity: cycle.length
      };
    }

    const longWaiters = waitingAgvs.filter(a => a.waitTime > this.MAX_WAIT_TIME);
    if (longWaiters.length >= 2) {
      return {
        hasDeadlock: true,
        type: 'long_wait',
        affectedAgvs: longWaiters.map(a => a.id),
        severity: longWaiters.length
      };
    }

    const cluster = this.detectClusterDeadlock(waitingAgvs);
    if (cluster) {
      return {
        hasDeadlock: true,
        type: 'cluster',
        affectedAgvs: cluster.map(a => a.id),
        severity: cluster.length
      };
    }

    return { hasDeadlock: false };
  }

  buildWaitGraph() {
    const graph = new Map();
    
    for (const agv of this.agvs) {
      graph.set(agv.id, []);
      
      if (agv.currentTask && agv.status === 'moving') {
        const targetWs = this.workstations.find(w => w.id === agv.currentTask.toStation);
        if (targetWs) {
          for (const other of this.agvs) {
            if (other.id === agv.id) continue;
            const dist = Math.sqrt((agv.x - other.x) ** 2 + (agv.y - other.y) ** 2);
            if (dist < 50 && other.status === 'moving') {
              graph.get(agv.id).push(other.id);
            }
          }
        }
      }
    }
    
    return graph;
  }

  findCycle(graph) {
    const visited = new Set();
    const recStack = new Set();
    
    const dfs = (node, path) => {
      visited.add(node);
      recStack.add(node);
      path.push(node);
      
      for (const neighbor of graph.get(node) || []) {
        if (!visited.has(neighbor)) {
          const result = dfs(neighbor, [...path]);
          if (result) return result;
        } else if (recStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart !== -1) {
            return path.slice(cycleStart);
          }
        }
      }
      
      recStack.delete(node);
      return null;
    };
    
    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        const result = dfs(node, []);
        if (result) return result;
      }
    }
    
    return null;
  }

  detectClusterDeadlock(waitingAgvs) {
    if (waitingAgvs.length < 2) return null;
    
    for (let i = 0; i < waitingAgvs.length; i++) {
      const cluster = [waitingAgvs[i]];
      
      for (let j = i + 1; j < waitingAgvs.length; j++) {
        const dist = Math.sqrt(
          (waitingAgvs[i].x - waitingAgvs[j].x) ** 2 +
          (waitingAgvs[i].y - waitingAgvs[j].y) ** 2
        );
        if (dist < 60) {
          cluster.push(waitingAgvs[j]);
        }
      }
      
      if (cluster.length >= 2) {
        return cluster;
      }
    }
    
    return null;
  }
}

class DeadlockResolver {
  constructor(agvs, workstations, pathPlanner) {
    this.agvs = agvs;
    this.workstations = workstations;
    this.pathPlanner = pathPlanner;
    this.resolutionCount = 0;
  }

  resolve(deadlockInfo) {
    this.resolutionCount++;
    console.log(`[DeadlockResolver] 解除死锁 #${this.resolutionCount}: ${deadlockInfo.type}`);

    switch (deadlockInfo.type) {
      case 'circular_wait':
        return this.resolveCircularWait(deadlockInfo.affectedAgvs);
      case 'long_wait':
        return this.resolveLongWait(deadlockInfo.affectedAgvs);
      case 'cluster':
        return this.resolveCluster(deadlockInfo.affectedAgvs);
      default:
        return this.resolveGeneral();
    }
  }

  resolveCircularWait(affectedAgvIds) {
    const affectedAgvs = this.agvs.filter(a => affectedAgvIds.includes(a.id));
    if (affectedAgvs.length === 0) return false;

    const victim = affectedAgvs.reduce((min, a) => {
      const aPriority = a.currentTask ? (a.currentTask.priority || 0) : 0;
      const minPriority = min.currentTask ? (min.currentTask.priority || 0) : 0;
      return aPriority < minPriority ? a : min;
    }, affectedAgvs[0]);

    return this.escalateAgv(victim);
  }

  resolveLongWait(affectedAgvIds) {
    for (const agvId of affectedAgvIds) {
      const agv = this.agvs.find(a => a.id === agvId);
      if (agv) {
        this.forceMove(agv);
      }
    }
    return true;
  }

  resolveCluster(affectedAgvIds) {
    for (let i = 0; i < affectedAgvIds.length; i++) {
      const agv = this.agvs.find(a => a.id === affectedAgvIds[i]);
      if (agv) {
        const angle = (i / affectedAgvIds.length) * Math.PI * 2;
        this.evadeDirection(agv, angle);
      }
    }
    return true;
  }

  resolveGeneral() {
    for (const agv of this.agvs) {
      if (agv.status === 'waiting' && agv.waitTime > 60) {
        this.forceMove(agv);
      }
    }
    return true;
  }

  escalateAgv(agv) {
    if (!agv.currentTask) return false;

    const route = this.getRoute(agv.currentTask.productType);
    const alternativePath = this.findAlternativePath(agv, route);
    
    if (alternativePath && alternativePath.length > 0) {
      agv.path = alternativePath;
      agv.pathIndex = 0;
      agv.waitTime = 0;
      agv.status = 'moving';
      console.log(`[DeadlockResolver] AGV ${agv.id} 已重新规划路径`);
      return true;
    }

    return this.forceMove(agv);
  }

  forceMove(agv) {
    const directions = [
      { x: 30, y: 0 },
      { x: -30, y: 0 },
      { x: 0, y: 30 },
      { x: 0, y: -30 }
    ];

    for (const dir of directions) {
      const newPos = { x: agv.x + dir.x, y: agv.y + dir.y };
      if (this.isValidPosition(newPos, agv)) {
        agv.path = [newPos, ...agv.path.slice(agv.pathIndex)];
        agv.pathIndex = 0;
        agv.waitTime = 0;
        agv.status = 'moving';
        console.log(`[DeadlockResolver] AGV ${agv.id} 强制移动到 (${newPos.x}, ${newPos.y})`);
        return true;
      }
    }

    agv.waitTime = 0;
    agv.status = 'moving';
    return true;
  }

  evadeDirection(agv, angle) {
    const distance = 50;
    const newPos = {
      x: agv.x + Math.cos(angle) * distance,
      y: agv.y + Math.sin(angle) * distance
    };

    agv.path = [newPos, ...agv.path.slice(agv.pathIndex)];
    agv.pathIndex = 0;
    agv.waitTime = 0;
    agv.status = 'moving';
  }

  isValidPosition(pos, agv) {
    for (const other of this.agvs) {
      if (other.id === agv.id) continue;
      const dist = Math.sqrt((pos.x - other.x) ** 2 + (pos.y - other.y) ** 2);
      if (dist < 30) return false;
    }
    return true;
  }

  findAlternativePath(agv, route) {
    if (!agv.currentTask) return null;
    
    const toWs = this.workstations.find(w => w.id === agv.currentTask.toStation);
    if (!toWs) return null;

    const offset = { x: (Math.random() - 0.5) * 100, y: (Math.random() - 0.5) * 100 };
    const viaPoint = {
      x: Math.max(50, Math.min(850, agv.x + offset.x)),
      y: Math.max(50, Math.min(400, agv.y + offset.y))
    };

    const path1 = this.pathPlanner.findPath(
      { x: agv.x, y: agv.y },
      viaPoint,
      agv,
      this.agvs
    );
    
    const path2 = this.pathPlanner.findPath(
      viaPoint,
      { x: toWs.x, y: toWs.y },
      agv,
      this.agvs
    );

    return [...path1, ...path2];
  }

  getRoute(productType) {
    const routes = {
      'A': [1, 2, 4, 5, 6, 7, 8],
      'B': [1, 3, 4, 5, 6, 7, 8],
      'C': [1, 2, 3, 5, 6, 7, 8]
    };
    return routes[productType] || routes['A'];
  }
}

class LogisticsSimulationFramework {
  constructor(workstations, agvs, orders) {
    this.workstations = workstations.map(ws => ({
      ...ws,
      queue: [],
      currentJob: null,
      processingEndTime: 0,
      totalWorkTime: 0,
      totalJobsProcessed: 0
    }));

    this.agvs = agvs.map(agv => ({
      ...agv,
      x: this.workstations.find(w => w.id === agv.current_station)?.x || 50,
      y: this.workstations.find(w => w.id === agv.current_station)?.y || 200,
      path: [],
      pathIndex: 0,
      currentTask: null,
      taskQueue: [],
      utilization: 0,
      totalWorkTime: 0,
      waitTime: 0,
      waiting: false,
      collisionCount: 0
    }));

    this.orders = orders.map(order => ({
      ...order,
      remainingQuantity: order.quantity,
      currentStep: 0,
      completedQuantity: 0
    }));

    this.intersections = [
      { x: 300, y: 100, name: '交叉点1' },
      { x: 300, y: 200, name: '交叉点2' },
      { x: 300, y: 300, name: '交叉点3' },
      { x: 500, y: 200, name: '交叉点4' },
      { x: 700, y: 200, name: '交叉点5' }
    ];

    this.eventQueue = new EventQueue();
    this.pathPlanner = new GlobalPathPlanner(this.workstations, this.intersections);
    this.deadlockDetector = new DeadlockDetector(this.agvs, this.workstations);
    this.deadlockResolver = new DeadlockResolver(this.agvs, this.workstations, this.pathPlanner);

    this.time = 0;
    this.completedOrders = 0;
    this.totalJobs = this.orders.reduce((sum, o) => sum + o.quantity, 0);
    this.completedJobs = 0;
    this.totalWaitTime = 0;
    this.totalCollisions = 0;
    this.deadlockResolutions = 0;
    this.isRunning = false;

    this.processRoutes = {
      'A': [1, 2, 4, 5, 6, 7, 8],
      'B': [1, 3, 4, 5, 6, 7, 8],
      'C': [1, 2, 3, 5, 6, 7, 8]
    };
  }

  start(callback) {
    this.isRunning = true;
    this.callback = callback;
  }

  step(deltaTime) {
    if (!this.isRunning) return null;

    this.processOrders();
    this.assignTasks();
    this.processWorkstations(deltaTime);
    this.processAgvs(deltaTime);
    this.checkAndResolveDeadlocks();
    
    this.time += deltaTime;

    return this.getState();
  }

  processOrders() {
    for (const order of this.orders) {
      if (order.remainingQuantity <= 0) continue;
      
      const route = this.processRoutes[order.product_type] || this.processRoutes['A'];
      const firstWs = this.workstations.find(w => w.id === route[0]);
      if (firstWs && order.remainingQuantity > 0) {
        let inSystem = 0;
        for (const ws of this.workstations) {
          inSystem += ws.queue.filter(j => j.orderId === order.id).length;
        }
        inSystem += this.agvs.filter(a => a.currentTask?.orderId === order.id).length;
        inSystem += order.completedQuantity || 0;
        
        const maxParallel = 3;
        if (inSystem < order.quantity && (inSystem - (order.completedQuantity || 0)) < maxParallel) {
          firstWs.queue.push({
            orderId: order.id,
            productType: order.product_type,
            priority: order.priority,
            quantity: 1,
            arrivalTime: this.time,
            completed: true,
            step: 0
          });
        }
      }
    }
  }

  assignTasks() {
    const idleAgvs = this.agvs.filter(a => a.status === 'idle' && a.taskQueue.length === 0 && !a.waiting);

    for (const agv of idleAgvs) {
      for (const order of this.orders.sort((a, b) => b.priority - a.priority)) {
        if (order.remainingQuantity <= 0) continue;

        const route = this.processRoutes[order.product_type] || this.processRoutes['A'];
        
        for (let stepIdx = 0; stepIdx < route.length - 1; stepIdx++) {
          const currentStationId = route[stepIdx];
          const nextStationId = route[stepIdx + 1];
          const currentStation = this.workstations.find(w => w.id === currentStationId);
          const nextStation = this.workstations.find(w => w.id === nextStationId);

          if (currentStation && nextStation) {
            const processedJob = currentStation.queue.find(j => j.orderId === order.id && j.completed && j.step === stepIdx);
            if (processedJob) {
              const idx = currentStation.queue.indexOf(processedJob);
              currentStation.queue.splice(idx, 1);
              
              agv.taskQueue.push({
                orderId: order.id,
                productType: order.product_type,
                priority: order.priority,
                fromStation: currentStationId,
                toStation: nextStationId,
                quantity: 1,
                step: stepIdx
              });
              break;
            }
          }
        }
        
        if (agv.taskQueue.length > 0) break;
      }
    }

    for (const agv of this.agvs) {
      if (agv.status === 'idle' && agv.taskQueue.length > 0 && !agv.currentTask && !agv.waiting) {
        agv.currentTask = agv.taskQueue.shift();
        agv.status = 'moving';

        const fromWs = this.workstations.find(w => w.id === agv.currentTask.fromStation);
        const toWs = this.workstations.find(w => w.id === agv.currentTask.toStation);

        if (fromWs && toWs) {
          agv.path = this.pathPlanner.findPath(
            { x: agv.x, y: agv.y },
            { x: toWs.x, y: toWs.y },
            agv,
            this.agvs
          );
          agv.pathIndex = 0;
        }
      }
    }
  }

  processWorkstations(deltaTime) {
    for (const ws of this.workstations) {
      if (ws.processing_time === 0) continue;

      if (ws.currentJob) {
        ws.totalWorkTime += deltaTime;
        if (this.time >= ws.processingEndTime) {
          ws.currentJob.completed = true;
          ws.queue.push(ws.currentJob);
          ws.currentJob = null;
          ws.totalJobsProcessed++;
        }
      }

      const pendingJobs = ws.queue.filter(j => !j.completed);
      if (!ws.currentJob && pendingJobs.length > 0) {
        pendingJobs.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        ws.currentJob = pendingJobs[0];
        const idx = ws.queue.indexOf(ws.currentJob);
        ws.queue.splice(idx, 1);
        ws.processingEndTime = this.time + ws.processing_time;
        ws.status = 'processing';
      } else if (!ws.currentJob && pendingJobs.length === 0) {
        ws.status = 'idle';
      }
    }
  }

  processAgvs(deltaTime) {
    for (const agv of this.agvs) {
      if (agv.status === 'idle') continue;

      if (agv.status === 'waiting') {
        agv.waitTime += deltaTime;
        this.totalWaitTime += deltaTime;
        
        if (agv.waitTime > 2.0) {
          agv.status = 'moving';
          agv.waitTime = 0;
        }
        continue;
      }

      if (agv.status === 'moving' && agv.path.length > 0) {
        const collisionCheck = this.checkCollision(agv);
        if (collisionCheck.collision) {
          agv.collisionCount++;
          this.totalCollisions++;
          agv.waitTime += deltaTime * 0.5;
          agv.status = 'waiting';
          continue;
        }

        const intersectionCheck = this.checkIntersectionConflict(agv);
        if (intersectionCheck.shouldWait) {
          agv.waitTime += deltaTime;
          this.totalWaitTime += deltaTime;
          agv.status = 'waiting';
          continue;
        }

        if (this.shouldReroute(agv)) {
          const toWs = this.workstations.find(w => w.id === agv.currentTask.toStation);
          if (toWs) {
            agv.path = this.pathPlanner.findPath(
              { x: agv.x, y: agv.y },
              { x: toWs.x, y: toWs.y },
              agv,
              this.agvs
            );
            agv.pathIndex = 0;
          }
        }

        agv.totalWorkTime += deltaTime;

        const targetPoint = agv.path[Math.min(agv.pathIndex, agv.path.length - 1)];
        const dx = targetPoint.x - agv.x;
        const dy = targetPoint.y - agv.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
          agv.pathIndex++;
          if (agv.pathIndex >= agv.path.length) {
            const toWs = this.workstations.find(w => w.id === agv.currentTask.toStation);
            if (toWs) {
              agv.x = toWs.x;
              agv.y = toWs.y;
              agv.current_station = toWs.id;

              const order = this.orders.find(o => o.id === agv.currentTask.orderId);
              const route = order ? (this.processRoutes[order.product_type] || this.processRoutes['A']) : [];
              
              if (agv.currentTask.toStation === route[route.length - 1]) {
                if (order) {
                  order.completedQuantity++;
                  order.remainingQuantity--;
                  this.completedJobs++;
                  if (order.remainingQuantity <= 0) {
                    this.completedOrders++;
                  }
                }
              } else {
                toWs.queue.push({
                  orderId: agv.currentTask.orderId,
                  productType: agv.currentTask.productType,
                  priority: agv.currentTask.priority,
                  quantity: agv.currentTask.quantity,
                  arrivalTime: this.time,
                  completed: false,
                  step: agv.currentTask.step + 1
                });
              }

              agv.currentTask = null;
              agv.status = 'idle';
              agv.path = [];
              agv.pathIndex = 0;
              agv.waitTime = 0;
            }
          }
        } else {
          const moveSpeed = agv.speed * deltaTime * 30;
          agv.x += (dx / dist) * Math.min(moveSpeed, dist);
          agv.y += (dy / dist) * Math.min(moveSpeed, dist);
        }
      }

      agv.utilization = this.time > 0 ? (agv.totalWorkTime / this.time) * 100 : 0;
    }
  }

  checkCollision(agv) {
    for (const other of this.agvs) {
      if (other.id === agv.id || other.status !== 'moving') continue;
      const dist = Math.sqrt((agv.x - other.x) ** 2 + (agv.y - other.y) ** 2);
      if (dist < 35) {
        return { collision: true, other };
      }
    }
    return { collision: false };
  }

  checkIntersectionConflict(agv) {
    for (const intersection of this.intersections) {
      const distToIntersection = Math.sqrt(
        (agv.x - intersection.x) ** 2 + (agv.y - intersection.y) ** 2
      );
      if (distToIntersection < 25) {
        for (const other of this.agvs) {
          if (other.id === agv.id) continue;
          const otherDist = Math.sqrt(
            (other.x - intersection.x) ** 2 + (other.y - intersection.y) ** 2
          );
          if (otherDist < 25 && other.status === 'moving') {
            const agvPriority = agv.currentTask?.priority || 0;
            const otherPriority = other.currentTask?.priority || 0;

            if (agvPriority <= otherPriority) {
              return { shouldWait: true, intersection };
            }
          }
        }
      }
    }
    return { shouldWait: false };
  }

  shouldReroute(agv) {
    if (agv.path.length === 0 || agv.pathIndex >= agv.path.length) return false;

    const lookAhead = Math.min(5, agv.path.length - agv.pathIndex);
    const futurePos = agv.path[agv.pathIndex + lookAhead - 1];

    if (!futurePos) return false;

    for (const other of this.agvs) {
      if (other.id === agv.id || other.status !== 'moving') continue;
      const dist = Math.sqrt((futurePos.x - other.x) ** 2 + (futurePos.y - other.y) ** 2);
      if (dist < 35) return true;
    }

    return false;
  }

  checkAndResolveDeadlocks() {
    const deadlockInfo = this.deadlockDetector.detect();
    if (deadlockInfo.hasDeadlock) {
      const resolved = this.deadlockResolver.resolve(deadlockInfo);
      if (resolved) {
        this.deadlockResolutions++;
      }
    }
  }

  isComplete() {
    const allOrdersComplete = this.orders.every(o => o.remainingQuantity <= 0);
    const allAgvsIdle = this.agvs.every(a => a.status === 'idle' && a.taskQueue.length === 0);
    const allWsIdle = this.workstations
      .filter(w => w.processing_time > 0)
      .every(w => w.currentJob === null && w.queue.length === 0);

    return allOrdersComplete && allAgvsIdle && allWsIdle;
  }

  findBottleneck() {
    let maxUtilization = 0;
    let bottleneck = null;

    for (const ws of this.workstations) {
      if (ws.processing_time > 0) {
        const utilization = this.time > 0 ? (ws.totalWorkTime / this.time) * 100 : 0;
        if (utilization > maxUtilization) {
          maxUtilization = utilization;
          bottleneck = ws;
        }
      }
    }

    return bottleneck;
  }

  getState() {
    const bottleneck = this.findBottleneck();

    return {
      time: this.time,
      agvs: this.agvs.map(a => ({
        id: a.id,
        name: a.name,
        x: a.x,
        y: a.y,
        status: a.status,
        current_station: a.current_station,
        battery: a.battery,
        currentTask: a.currentTask,
        utilization: a.utilization,
        waitTime: a.waitTime,
        collisionCount: a.collisionCount
      })),
      workstations: this.workstations.map(w => ({
        id: w.id,
        name: w.name,
        type: w.type,
        x: w.x,
        y: w.y,
        status: w.status,
        queueLength: w.queue.length,
        totalJobsProcessed: w.totalJobsProcessed,
        utilization: this.time > 0 ? (w.totalWorkTime / this.time) * 100 : 0
      })),
      completedOrders: this.completedOrders,
      totalOrders: this.orders.length,
      completedJobs: this.completedJobs,
      totalJobs: this.totalJobs,
      bottleneck: bottleneck ? { id: bottleneck.id, name: bottleneck.name } : null,
      isComplete: this.isComplete(),
      totalWaitTime: this.totalWaitTime,
      totalCollisions: this.totalCollisions,
      deadlockResolutions: this.deadlockResolutions
    };
  }

  getStatistics() {
    const bottleneck = this.findBottleneck();

    return {
      simulationTime: this.time,
      avgAgvUtilization: this.agvs.reduce((sum, a) => sum + a.utilization, 0) / this.agvs.length,
      workstationUtilizations: this.workstations.map(w => ({
        id: w.id,
        name: w.name,
        utilization: this.time > 0 ? (w.totalWorkTime / this.time) * 100 : 0
      })),
      throughput: this.time > 0 ? this.completedJobs / this.time : 0,
      totalWaitTime: this.totalWaitTime,
      totalCollisions: this.totalCollisions,
      bottleneckStation: bottleneck?.id,
      bottleneckUtilization: bottleneck && this.time > 0 ? (bottleneck.totalWorkTime / this.time) * 100 : 0,
      deadlockResolutions: this.deadlockResolutions
    };
  }

  stop() {
    this.isRunning = false;
    this.pathPlanner.clearReservations();
  }

  updateSpeed(speed) {
    this.speed = speed;
  }
}

module.exports = {
  LogisticsSimulationFramework,
  EventQueue,
  GlobalPathPlanner,
  DeadlockDetector,
  DeadlockResolver
};
