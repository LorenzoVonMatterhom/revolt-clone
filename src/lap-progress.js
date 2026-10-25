import * as THREE from "three";
import { makeRaceRoute } from "./race-ai.js";

// Gates span the driving corridor, rather than requiring a hit on a tiny point.
export function makeLapGates(points, finishForward, { halfWidth = 120, height = 80, corridor = [], nodes = [] } = {}) {
  if (points.length < 3) return [];
  const route = makeRaceRoute(points);
  const gates = [{ position: new THREE.Vector3(), normal: finishForward.clone().normalize(), halfWidth: Math.min(halfWidth, 120), height: 80 }];
  // The first route node can be on either side of the painted start line.
  // Anchor gate order to the closest forward crossing of the actual finish.
  let phase = 0, closest = Infinity, distanceAlong = 0;
  const offsets = [];
  const length = route.getLength();
  for (let i = 0; i < points.length; i++) {
    offsets.push(distanceAlong);
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
  // FAN boundaries describe the whole legal corridor. Sampling an arbitrary
  // point on the racing line can put a narrow gate across the inside of a turn.
  // Use authored cross-sections instead, keeping checkpoint order unchanged.
  const authored = corridor.length === points.length;
  let eligible = corridor.map((_, i) => i);
  if (authored) {
    if (nodes.length) {
      const start = nodes.indexOf(corridor[0]);
      eligible = eligible.filter(index => {
        const blocked = nodes.indexOf(corridor[index]);
        if (blocked === start) return false;
        const seen = new Set([blocked]), pending = [...nodes[start].next];
        while (pending.length) {
          const next = pending.pop();
          if (next === start) return false; // A legal branch bypasses this node.
          if (!nodes[next] || seen.has(next)) continue;
          seen.add(next); pending.push(...nodes[next].next);
        }
        return true;
      });
    }
    // Wide/angled finish corridors can cross the finish plane on different
    // adjacent FAN segments. Include their boundary intersections, not just
    // the segment crossed by the preferred AI line.
    const side = new THREE.Vector3(-finishForward.z, 0, finishForward.x).normalize();
    const edges = [];
    const sections = nodes.length
      ? nodes.flatMap(a => a.next.filter(index => nodes[index]).map(index => [a, nodes[index]]))
      : corridor.map((a, j) => [a, corridor[(j + 1) % corridor.length]]);
    for (const [a, b] of sections) {
      if (Math.min(a.position.length(), b.position.length()) > Math.max(250, closest + 150)) continue;
      for (const key of ["left", "right"]) {
        const from = a[key].dot(finishForward), to = b[key].dot(finishForward);
        if (from > 0 || to < 0 || Math.abs(to - from) < 0.000001) continue;
        const at = a[key].clone().lerp(b[key], -from / (to - from));
        if (Math.abs(at.y - gates[0].position.y) < height) edges.push(at);
      }
    }
    if (edges.length >= 2) {
      const lateral = edges.map(edge => edge.dot(side)), low = Math.min(...lateral), high = Math.max(...lateral);
      gates[0].position.addScaledVector(side, (low + high) / 2 - gates[0].position.dot(side));
      gates[0].halfWidth = (high - low) / 2 + 8;
    }
  }
  for (let i = 1; i < 8; i++) {
    const t = (phase + i / 8) % 1;
    if (authored) {
      const distance = t * length;
      let index = 0, best = Infinity;
      for (const j of eligible) {
        const difference = Math.abs(offsets[j] - distance);
        const error = Math.min(difference, length - difference);
        if (error < best) { best = error; index = j; }
      }
      const node = corridor[index];
      const across = node.right.clone().sub(node.left);
      const normal = new THREE.Vector3(-across.z, 0, across.x).normalize();
      const direction = points[(index + 1) % points.length].clone().sub(points[(index - 1 + points.length) % points.length]);
      if (normal.dot(direction) < 0) normal.negate();
      gates.push({ position: node.left.clone().add(node.right).multiplyScalar(0.5), normal,
        halfWidth: Math.hypot(across.x, across.z) / 2 + 8, height: height + Math.abs(across.y) / 2 });
      continue;
    }
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

  score(position) {
    if (this.finished) return this.totalLaps * this.gates.length;
    if (!this.gates.length) return 0;
    const next = this.nextCheckpoint;
    const completed = next === 0 ? this.gates.length - 1 : next - 1;
    const previous = this.gates[completed].position;
    const ahead = this.gates[next].position;
    const behindDistance = position.distanceTo(previous);
    const aheadDistance = position.distanceTo(ahead);
    const fraction = behindDistance / Math.max(0.001, behindDistance + aheadDistance);
    return (this.lap - 1) * this.gates.length + completed + fraction;
  }

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
