import * as THREE from "three";
import { makeRaceRoute } from "./race-ai.js";

// Gates span the driving corridor, rather than requiring a hit on a tiny point.
export function makeLapGates(points, finishForward, { halfWidth = 120, height = 80 } = {}) {
  if (points.length < 3) return [];
  const route = makeRaceRoute(points);
  const gates = [{ position: new THREE.Vector3(), normal: finishForward.clone().normalize(), halfWidth: Math.min(halfWidth, 120), height: 80 }];
  // The first route node can be on either side of the painted start line.
  // Anchor gate order to the closest forward crossing of the actual finish.
  let phase = 0, closest = Infinity, distanceAlong = 0;
  const length = route.getLength();
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const segmentLength = a.distanceTo(b);
    const from = a.dot(finishForward), to = b.dot(finishForward);
    if (from < 0 && to >= 0) {
      const fraction = from / (from - to), at = a.clone().lerp(b, fraction);
      const distance = Math.hypot(at.x, at.z);
      if (distance < closest && Math.abs(at.y) < height) {
        closest = distance; phase = (distanceAlong + fraction * segmentLength) / length;
        gates[0].position.copy(at);
      }
    }
    distanceAlong += segmentLength;
  }
  for (let i = 1; i < 8; i++) {
    const t = (phase + i / 8) % 1;
    const normal = route.getPoint((t + 0.0001) % 1).sub(route.getPoint((t - 0.0001 + 1) % 1));
    if (normal.lengthSq() < 0.000001) normal.copy(route.getTangentAt(t));
    normal.y = 0;
    if (normal.lengthSq() < 0.000001) normal.copy(finishForward);
    gates.push({ position: route.getPoint(t), normal: normal.normalize(), halfWidth, height });
  }
  return gates;
}

export class LapProgress {
  constructor(gates, totalLaps = 3) {
    this.totalLaps = totalLaps;
    this.reset(gates);
  }

  reset(gates = this.gates, position = null) {
    this.gates = gates;
    this.lap = 1;
    this.nextCheckpoint = 1;
    this.finished = false;
    this.previous = position?.clone() ?? null;
  }

  // Repositioning preserves earned gates but must not count as crossing one.
  relocate(position) { this.previous = position.clone(); }

  update(position) {
    if (this.finished || this.gates.length < 2 || !this.previous) {
      this.relocate(position);
      return false;
    }
    const previous = this.previous;
    this.relocate(position);
    // Ignore discontinuous position changes, including emergency recovery.
    if (previous.distanceToSquared(position) > 80 * 80) return false;
    let lastCrossing = -1;
    for (let i = 0; i < this.gates.length; i++) {
      const gate = this.gates[this.nextCheckpoint];
      const from = previous.clone().sub(gate.position).dot(gate.normal);
      const to = position.clone().sub(gate.position).dot(gate.normal);
      if (from >= 0 || to < 0) break;
      const fraction = from / (from - to);
      if (fraction < lastCrossing) break;
      const offset = previous.clone().lerp(position, fraction).sub(gate.position);
      const side = new THREE.Vector3(-gate.normal.z, 0, gate.normal.x);
      if (side.lengthSq() < 0.000001) side.set(1, 0, 0);
      side.normalize();
      if (Math.abs(offset.dot(side)) > gate.halfWidth || Math.abs(offset.y) > gate.height) break;
      lastCrossing = fraction;
      if (this.nextCheckpoint === 0) {
        this.lap++;
        this.nextCheckpoint = 1;
        this.finished = this.lap > this.totalLaps;
        return true;
      }
      this.nextCheckpoint = (this.nextCheckpoint + 1) % this.gates.length;
    }
    return false;
  }
}
