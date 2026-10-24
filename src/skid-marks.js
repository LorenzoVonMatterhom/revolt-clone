import * as THREE from "three";

export function isSkidding({ speed, lateralSpeed, steer, handbrake, airborne }) {
  return !airborne && Math.abs(speed) > 8 && (Math.abs(lateralSpeed) > 3 || (handbrake && Math.abs(steer) > 0.25));
}

export class SkidMarks {
  constructor(scene, capacity = 2048) {
    this.scene = scene; this.capacity = capacity; this.count = 0; this.next = 0;
    this.previous = new Map(); this.ages = new Float32Array(capacity).fill(40);
    this.opacity = new Float32Array(capacity).fill(0.6);
    this.positions = new Float32Array(capacity * 18);
    this.colors = new Float32Array(capacity * 24);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.MeshBasicMaterial({ color: 0x141414, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "Tire skid marks"; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  segment(from, to, normal, width, opacity = 0.6) {
    const direction = to.clone().sub(from);
    const distance = direction.length();
    if (distance < 0.15 || distance > 8) return false;
    const side = new THREE.Vector3().crossVectors(normal, direction).normalize().multiplyScalar(width / 2);
    const lift = normal.clone().multiplyScalar(0.025);
    const corners = [from.clone().add(side).add(lift), from.clone().sub(side).add(lift), to.clone().sub(side).add(lift), to.clone().add(side).add(lift)];
    const slot = this.next; this.next = (slot + 1) % this.capacity;
    [0,1,2,0,2,3].forEach((corner, i) => {
      corners[corner].toArray(this.positions, slot * 18 + i * 3);
      this.colors.set([1,1,1,opacity], slot * 24 + i * 4);
    });
    this.opacity[slot] = opacity;
    this.ages[slot] = 0; this.count = Math.min(this.capacity, this.count + 1);
    this.geometry.setDrawRange(0, this.count * 6);
    this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.color.needsUpdate = true;
    return true;
  }

  track(racer) {
    const oily = racer.powerups?.slippery > 0 && racer.powerups.oilWheels?.some(time => time > 0);
    if ((!racer.sliding && !oily) || racer.finished) { this.previous.delete(racer); return; }
    const previous = this.previous.get(racer) ?? [];
    const vehicle = racer.car.vehicle;
    for (let i = 0; i < vehicle.numWheels(); i++) {
      const oiledWheel = oily && racer.powerups.oilWheels[i] > 0;
      if (!racer.sliding && !oiledWheel) { previous[i] = null; continue; }
      const contact = vehicle.wheelIsInContact(i) && vehicle.wheelContactPoint(i);
      const contactNormal = vehicle.wheelContactNormal(i);
      if (!contact || !contactNormal || contactNormal.y < 0.15) { previous[i] = null; continue; }
      const point = new THREE.Vector3().copy(contact), normal = new THREE.Vector3().copy(contactNormal).normalize();
      if (!previous[i]) previous[i] = point;
      else if (point.distanceTo(previous[i]) > 8) previous[i] = point;
      else {
        const wheel = racer.car.setup.wheels[i];
        const width = oiledWheel ? Math.max(0.35, (wheel.halfWidth ?? wheel.radius * 0.35) * 0.9) : Math.max(0.25, wheel.radius * 0.45);
        if (this.segment(previous[i], point, normal, width, oiledWheel ? 0.95 : 0.6)) previous[i] = point;
      }
    }
    this.previous.set(racer, previous);
  }

  update(dt) {
    for (let slot = 0; slot < this.count; slot++) {
      this.ages[slot] += dt;
      const alpha = this.opacity[slot] * THREE.MathUtils.clamp((40 - this.ages[slot]) / 20, 0, 1);
      for (let i = 0; i < 6; i++) this.colors[slot * 24 + i * 4 + 3] = alpha;
    }
    this.geometry.attributes.color.needsUpdate = true;
  }

  clear() { this.count = 0; this.next = 0; this.previous.clear(); this.geometry.setDrawRange(0, 0); this.ages.fill(40); }
  dispose() { this.scene.remove(this.mesh); this.geometry.dispose(); this.material.dispose(); this.previous.clear(); }
}
