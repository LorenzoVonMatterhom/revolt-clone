import * as THREE from "three";

export function setWheelPose(wheel, steering, rotation) {
  wheel.rotation.set(0, steering, 0);
  wheel.userData.tire.rotation.set(rotation, 0, 0);
}

export class CarResetFade {
  constructor(mesh) {
    this.mesh = mesh; this.materials = new Map(); this.active = false;
    this.opacity = 1; this.elapsed = 0; this.repositioned = false;
  }

  start(reposition) {
    if (this.active) return false;
    this.active = true; this.elapsed = 0; this.repositioned = false; this.reposition = reposition;
    this.apply(1);
    return true;
  }

  apply(opacity) {
    this.opacity = opacity;
    this.mesh.traverse((object) => {
      if (!object.material) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!this.materials.has(material)) this.materials.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
        const original = this.materials.get(material);
        if (!material.transparent) { material.transparent = true; material.needsUpdate = true; }
        material.opacity = original.opacity * opacity;
        material.depthWrite = false;
      }
    });
  }

  update(dt) {
    if (!this.active) return;
    this.elapsed += Math.max(0, dt);
    const fadeOut = 0.25, fadeIn = 0.4;
    if (this.elapsed < fadeOut) this.apply(1 - this.elapsed / fadeOut);
    else {
      if (!this.repositioned) { this.apply(0); this.repositioned = true; this.reposition(); }
      if (this.elapsed < fadeOut + fadeIn) this.apply((this.elapsed - fadeOut) / fadeIn);
      else this.cancel();
    }
  }

  cancel() {
    for (const [material, original] of this.materials) {
      if (material.transparent !== original.transparent) material.needsUpdate = true;
      material.opacity = original.opacity; material.transparent = original.transparent; material.depthWrite = original.depthWrite;
    }
    this.materials.clear(); this.active = false; this.opacity = 1; this.reposition = null;
  }
}

export function engineProfile(engineClass) {
  return engineClass === 1
    ? { sample: "/wavs/petrol.wav", idleVolume: 0.12, idlePitch: 0.7, revRange: 1.4 }
    : { sample: "/wavs/electro.wav", idleVolume: 0.025, idlePitch: 0.65, revRange: 1.7 };
}

export class CarEngineAudio {
  constructor(listener, mesh, buffer) {
    this.profile = engineProfile(mesh.userData.engineClass);
    this.audio = new THREE.PositionalAudio(listener);
    this.audio.setBuffer(buffer).setLoop(true).setRefDistance(18).setRolloffFactor(1.5).setMaxDistance(160);
    this.audio.setVolume(0);
    mesh.add(this.audio);
    this.revs = 0;
  }

  update(dt, { running, muted, speed, throttle, airborne }) {
    if (!running || muted) {
      if (this.audio.isPlaying) this.audio.stop();
      return;
    }
    if (!this.audio.isPlaying) this.audio.play();
    const load = Math.abs(throttle);
    const target = THREE.MathUtils.clamp(Math.abs(speed) / 45 * 0.8 + load * (airborne ? 0.8 : 0.25), 0, 1);
    this.revs = THREE.MathUtils.lerp(this.revs, target, 1 - Math.exp(-dt * 8));
    this.audio.setPlaybackRate(this.profile.idlePitch + this.revs * this.profile.revRange);
    this.audio.setVolume(this.profile.idleVolume + this.revs * 0.22 + load * 0.07);
  }
}

export class FlexibleAntenna {
  constructor(car, { offset, direction, length, stiffness = 2000, damping = 5.5 }) {
    this.car = car;
    this.offset = offset.clone();
    this.direction = direction.clone().normalize();
    this.length = length;
    this.count = 8;
    this.segmentLength = length / this.count;
    this.stiffness = THREE.MathUtils.clamp(stiffness * 0.04, 45, 180);
    this.damping = THREE.MathUtils.clamp(damping, 4, 12);
    this.points = Array.from({ length: this.count + 1 }, () => new THREE.Vector3());
    this.velocities = this.points.map(() => new THREE.Vector3());
    this.lastAnchor = new THREE.Vector3();
    this.initialized = false;
    this.group = new THREE.Group();
    this.group.name = "Flexible antenna";
    const material = new THREE.MeshBasicMaterial({ color: 0x17191c });
    const radius = Math.max(0.025, length * 0.015);
    this.rods = Array.from({ length: this.count }, () => {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, this.segmentLength, 5), material);
      this.group.add(rod);
      return rod;
    });
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(radius * 2.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd3272e }));
    this.group.add(this.tip);
    car.add(this.group);
    this.reset();
  }

  reset() {
    this.car.updateMatrixWorld(true);
    this.points.forEach((point, i) => {
      point.copy(this.offset).addScaledVector(this.direction, i * this.segmentLength);
      this.car.localToWorld(point);
      this.velocities[i].set(0, 0, 0);
    });
    this.lastAnchor.copy(this.points[0]);
    this.initialized = true;
    this.draw();
  }

  update(dt) {
    if (!(dt > 0)) return;
    this.car.updateMatrixWorld(true);
    const anchor = this.car.localToWorld(this.offset.clone());
    const travel = anchor.clone().sub(this.lastAnchor);
    // Teleports and car resets must not launch the aerial across the track.
    if (travel.length() > this.length * 3) { this.reset(); return; }
    const duration = Math.min(dt, 0.05);
    const steps = Math.max(1, Math.ceil(duration * 120));
    const h = duration / steps;
    const baseVelocity = travel.clone().divideScalar(duration);
    const rotation = this.car.getWorldQuaternion(new THREE.Quaternion());
    const up = this.direction.clone().applyQuaternion(rotation);
    const previous = this.points.map(point => point.clone());
    for (let step = 1; step <= steps; step++) {
      const base = this.lastAnchor.clone().lerp(anchor, step / steps);
      previous.forEach((point, i) => point.copy(this.points[i]));
      this.points[0].copy(base);
      for (let i = 1; i <= this.count; i++) {
        const target = base.clone().addScaledVector(up, i * this.segmentLength);
        const force = target.sub(this.points[i]).multiplyScalar(this.stiffness)
          .addScaledVector(this.velocities[i].clone().sub(baseVelocity), -this.damping);
        force.y -= 2;
        // Air resistance bends the aerial back as speed increases.
        force.addScaledVector(baseVelocity, -0.025 * baseVelocity.length());
        this.velocities[i].addScaledVector(force, h);
        this.points[i].addScaledVector(this.velocities[i], h);
      }
      for (let pass = 0; pass < 6; pass++) {
        this.points[0].copy(base);
        for (let i = 1; i <= this.count; i++) {
          const delta = this.points[i].clone().sub(this.points[i - 1]);
          const distance = delta.length();
          if (distance < 0.000001) continue;
          const correction = delta.multiplyScalar((distance - this.segmentLength) / distance);
          this.points[i].addScaledVector(correction, i === 1 ? -1 : -0.5);
          if (i > 1) this.points[i - 1].addScaledVector(correction, 0.5);
        }
      }
      for (let i = 1; i <= this.count; i++) {
        this.velocities[i].copy(this.points[i]).sub(previous[i]).divideScalar(h);
      }
    }
    this.lastAnchor.copy(anchor);
    this.draw();
  }

  draw() {
    const local = this.points.map(point => this.car.worldToLocal(point.clone()));
    const axis = new THREE.Vector3(0, 1, 0);
    this.rods.forEach((rod, i) => {
      const delta = local[i + 1].clone().sub(local[i]);
      rod.position.copy(local[i]).add(local[i + 1]).multiplyScalar(0.5);
      rod.scale.y = delta.length() / this.segmentLength;
      if (delta.lengthSq() > 0) rod.quaternion.setFromUnitVectors(axis, delta.normalize());
    });
    this.tip.position.copy(local[this.count]);
  }
}
