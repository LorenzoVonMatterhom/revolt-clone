import * as THREE from "three";

// Stock TRI: count, then 68-byte records (type, packed flags, position,
// orientation, half-extents). Only type 2 contains HUD direction instructions.
export function parseDirectionTriggers(buffer, origin = [0, 0, 0]) {
  if (buffer.byteLength <= 4) return [];
  const view = new DataView(buffer), count = view.getUint32(0, true);
  if (buffer.byteLength !== 4 + count * 68) throw new Error("Invalid Re-Volt TRI file");
  const triggers = [];
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 68;
    if (view.getInt32(at, true) !== 2) continue;
    const flags = view.getUint32(at + 4, true);
    const vector = offset => [0, 1, 2].map(axis => view.getFloat32(at + offset + axis * 4, true));
    const p = vector(8), m = Array.from({length:9}, (_, j) => view.getFloat32(at + 20 + j * 4, true));
    const rotation = new THREE.Matrix4().set(m[0], -m[3], m[6], 0, -m[1], m[4], -m[7], 0, m[2], -m[5], m[8], 0, 0, 0, 0, 1);
    triggers.push({ id:i, type:flags & 0xffff, order:flags >>> 16,
      position:new THREE.Vector3((p[0]-origin[0])*.1, -(p[1]-origin[1])*.1, (p[2]-origin[2])*.1),
      inverse:rotation.invert(), halfExtents:new THREE.Vector3(...vector(56)).multiplyScalar(.1) });
  }
  return triggers;
}

export function directionIntersection(trigger, from, to) {
  const a = from.clone().sub(trigger.position).applyMatrix4(trigger.inverse);
  const b = to.clone().sub(trigger.position).applyMatrix4(trigger.inverse);
  let enter = 0, exit = 1;
  for (const axis of ['x','y','z']) {
    const delta = b[axis] - a[axis], extent = trigger.halfExtents[axis];
    if (Math.abs(delta) < 1e-8) { if (Math.abs(a[axis]) > extent) return null; continue; }
    const first = (-extent-a[axis])/delta, last = (extent-a[axis])/delta;
    enter = Math.max(enter, Math.min(first,last)); exit = Math.min(exit, Math.max(first,last));
    if (enter > exit) return null;
  }
  return enter;
}

export class TurnGuide {
  constructor(triggers = [], onEnter = () => {}) { this.onEnter = onEnter; this.reset(triggers); }
  reset(triggers = this.triggers) { this.triggers = triggers; this.previous = null; this.inside = new Set(); this.current = null; this.remaining = 0; }
  update(dt, position) {
    this.remaining = Math.max(0, this.remaining-dt);
    const previous = this.previous && this.previous.distanceToSquared(position) < 80*80 ? this.previous : position;
    const inside = new Set(); let selected = null, latest = -1;
    for (const trigger of this.triggers) {
      if (directionIntersection(trigger, position, position) !== null) inside.add(trigger.id);
      const crossing = directionIntersection(trigger, previous, position);
      if (crossing !== null && !this.inside.has(trigger.id) && crossing >= latest) { selected = trigger; latest = crossing; }
    }
    this.previous = position.clone(); this.inside = inside;
    if (selected) {
      this.current = selected; this.remaining = selected.type === 11 ? 0 : 2.5;
      if (this.remaining) this.onEnter(selected);
    }
    return this.remaining > 0 ? this.current : null;
  }
}
