import * as THREE from "three";

export function makeRaceRoute(points) {
  const curve = new THREE.CurvePath();
  for (let i = 0; i < points.length; i++) curve.add(new THREE.LineCurve3(points[i], points[(i + 1) % points.length]));
  return curve;
}

export function makeAiRoute(path, racingLine) {
  // POS nodes measure race progress; FAN nodes specify the actual driving line.
  return racingLine.length >= 3 ? racingLine : path.length >= 3 ? path : [];
}

export function findAiRecovery(physics, ai, distance) {
  for (let ahead = 0; ahead <= 300; ahead += 10) {
    const routeDistance = Math.min(ai.length - 1, distance + ahead);
    const routePosition = ai.at(routeDistance);
    for (const radius of [0, 8, 16, 32, 64, 128]) for (let side = 0; side < (radius ? 8 : 1); side++) {
      const position = routePosition.clone().add(new THREE.Vector3(Math.sin(side * Math.PI / 4) * radius, 0, Math.cos(side * Math.PI / 4) * radius));
      const floor = physics.groundAt(position, 15, 60);
      if (floor !== null && Math.abs(floor - position.y) < 40) {
        position.y = floor + 0.8;
        const direction = ai.at(routeDistance + 8).sub(ai.at(routeDistance));
        return { position, distance: routeDistance, heading: Math.atan2(direction.x, direction.z) };
      }
    }
  }
  return null;
}

export function trafficSpeedLimit(position, heading, velocity, halfExtents, traffic) {
  const forward = new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
  const side = new THREE.Vector3(forward.z,0,-forward.x);
  const speed = Math.max(0,velocity.dot(forward));
  let limit = Infinity;
  for(const other of traffic) {
    const delta=other.position.clone().sub(position),size=other.halfExtents;
    if(Math.abs(delta.y)>halfExtents.y+size.y+2) continue;
    const ahead=delta.dot(forward);
    if(ahead<=0||ahead>halfExtents.z+size.z+15+speed*1.2) continue;
    const angle=(other.heading??heading)-heading;
    const width=Math.abs(Math.cos(angle))*size.x+Math.abs(Math.sin(angle))*size.z;
    if(Math.abs(delta.dot(side))>halfExtents.x+width+0.6) continue;
    const length=Math.abs(Math.cos(angle))*size.z+Math.abs(Math.sin(angle))*size.x;
    const gap=ahead-halfExtents.z-length;
    const leadSpeed=Math.max(0,other.velocity.dot(forward));
    limit=Math.min(limit,Math.max(0,leadSpeed+2*(gap-5-speed*0.18)));
    if(gap<3) limit=0;
  }
  return limit;
}

export class RaceAI {
  constructor(points, pace = 0.9, setup = null) {
    this.points = points;
    this.pace = pace;
    const wheels=setup?.wheels??[];
    this.wheelbase=wheels.length?Math.max(...wheels.map(wheel=>wheel.position.z))-Math.min(...wheels.map(wheel=>wheel.position.z)):8;
    this.steeringAngle=Math.max(0.1,...wheels.filter(wheel=>wheel.turnable).map(wheel=>wheel.steerRatio));
    if(!wheels.length) this.steeringAngle=0.45;
    this.lengths = points.map((point, i) => point.distanceTo(points[(i + 1) % points.length]));
    this.offsets = [0];
    this.lengths.forEach((length) => this.offsets.push(this.offsets.at(-1) + length));
    this.length = this.offsets.at(-1);
    this.reset();
  }

  reset() { this.segment = 0; this.distance = 0; this.laps = 0; this.stalled = 0; this.reversing = 0; this.recoveryCount = 0; this.recoveryCooldown = 0; this.trafficWait=0; }

  acceptRecovery(distance) {
    this.distance = distance;
    this.segment = this.offsets.findIndex((offset, i) => i < this.points.length && distance < this.offsets[i + 1]);
    if (this.segment < 0) this.segment = this.points.length - 1;
  }

  at(distance) {
    distance = ((distance % this.length) + this.length) % this.length;
    let segment = this.offsets.findIndex((offset, i) => i < this.points.length && distance < this.offsets[i + 1]);
    if (segment < 0) segment = 0;
    const t = (distance - this.offsets[segment]) / Math.max(0.01, this.lengths[segment]);
    return this.points[segment].clone().lerp(this.points[(segment + 1) % this.points.length], t);
  }

  update(dt, position, heading, velocity, { disabled = false, upsideDown = false, traffic = [], halfExtents = new THREE.Vector3(3,2,6) } = {}) {
    if (this.points.length < 3 || this.length < 1) return { throttle: 0, brake: 1, steering: 0 };
    let segment = this.segment;
    let line = new THREE.Line3(this.points[segment], this.points[(segment + 1) % this.points.length]);
    let t = line.closestPointToPointParameter(position, false);
    const nextLine = new THREE.Line3(this.points[(segment + 1) % this.points.length], this.points[(segment + 2) % this.points.length]);
    const endpointDistance = position.distanceTo(line.end);
    if (t >= 1 || (endpointDistance < 10 && nextLine.closestPointToPointParameter(position, false) > 0)) {
      segment = (segment + 1) % this.points.length;
      if (segment === 0) this.laps++;
      this.segment = segment;
      line = nextLine;
      t = line.closestPointToPointParameter(position, false);
    }
    const previous = this.distance;
    const projected = this.offsets[segment] + THREE.MathUtils.clamp(t, 0, 1) * this.lengths[segment];
    this.distance = segment === 0 && previous > this.length * 0.5 ? projected : Math.max(previous, projected);
    let advance = this.distance - previous;
    if (advance < -this.length * 0.5) advance += this.length;
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const speed = velocity.dot(forward);
    const nearest=line.closestPointToPoint(position,true,new THREE.Vector3());
    const routeError=Math.hypot(position.x-nearest.x,position.z-nearest.z);
    const trafficLimit = trafficSpeedLimit(position,heading,velocity,halfExtents,traffic);
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);
    if (disabled) { this.stalled = 0; return { throttle: 0, brake: 0, steering: 0 }; }
    this.stalled = upsideDown || advance < dt * 0.8 || routeError > 35 ? this.stalled + dt : Math.max(0, this.stalled - dt * 2);
    this.trafficWait=trafficLimit<3&&Math.abs(speed)<4?this.trafficWait+dt:0;
    if(trafficLimit<3&&!upsideDown&&routeError<20) {
      if(this.trafficWait<2) this.stalled=0;
      this.reversing=0;
    }
    if ((this.stalled > 6 || (upsideDown && this.stalled > 2)) && this.recoveryCooldown === 0) {
      const distance = Math.min(this.length - 1, this.distance + 25);
      const recovery = this.at(distance);
      const direction = this.at(distance + 8).sub(recovery);
      this.stalled = 0; this.reversing = 0; this.recoveryCooldown = 3; this.recoveryCount++;this.trafficWait=0;
      return { throttle: 0, brake: 0, steering: 0, recovery, recoveryDistance: distance, heading: Math.atan2(direction.x, direction.z) };
    }
    if (this.stalled > 2 && this.reversing === 0 && trafficLimit>0) this.reversing = 1.2;
    const lookAhead = THREE.MathUtils.clamp(12 + Math.abs(speed) * 0.35, 15, 35);
    const target = this.at(this.distance + lookAhead);
    const delta = target.sub(position); delta.y = 0;
    const angle = Math.atan2(Math.sin(Math.atan2(delta.x, delta.z) - heading), Math.cos(Math.atan2(delta.x, delta.z) - heading));
    const steering = THREE.MathUtils.clamp(Math.atan2(2*this.wheelbase * Math.sin(angle), Math.max(8, delta.length())) / this.steeringAngle, -1, 1);
    if (this.reversing > 0) {
      this.reversing = Math.max(0, this.reversing - dt);
      return { throttle: -0.3, brake: 0, steering: -steering };
    }
    let desiredSpeed = 185 * this.pace;
    const stoppingDistance = speed * speed / 28 + 25;
    // Brake before sharp authored corners, instead of aiming through nearby walls.
    for (let i = 0; i < this.points.length; i++) {
      const corner = (segment + i + 1) % this.points.length;
      let distance = this.offsets[corner] - this.distance;
      if (distance < 0) distance += this.length;
      if (distance > stoppingDistance) break;
      const before = this.points[corner].clone().sub(this.points[(corner - 1 + this.points.length) % this.points.length]); before.y = 0;
      const after = this.points[(corner + 1) % this.points.length].clone().sub(this.points[corner]); after.y = 0;
      const turn = before.normalize().angleTo(after.normalize());
      if (turn > 0.3) {
        const segmentLength=Math.min(this.lengths[(corner-1+this.points.length)%this.points.length],this.lengths[corner]);
        const radius=Math.max(5,segmentLength*0.7/(2*Math.sin(turn/2)));
        const turnLimit=32+118*Math.max(0,1-turn/(Math.PI/2));
        const cornerSpeed=Math.min(THREE.MathUtils.clamp(Math.sqrt(radius*45),28,150),turnLimit);
        const approachSpeed = Math.sqrt(cornerSpeed * cornerSpeed + 28 * Math.max(0, distance - 15));
        desiredSpeed = Math.min(desiredSpeed, approachSpeed);
      }
    }
    if (Math.abs(angle) > 0.65 || routeError > 12) desiredSpeed = Math.min(desiredSpeed, 35);
    desiredSpeed=Math.min(desiredSpeed,trafficLimit);
    if(trafficLimit===0) return {throttle:0,brake:1,steering};
    return { throttle: THREE.MathUtils.clamp(0.15 + (desiredSpeed - speed) * 0.04, 0, 1), brake: THREE.MathUtils.clamp((speed - desiredSpeed) / 15, 0, 1), steering };
  }
}
