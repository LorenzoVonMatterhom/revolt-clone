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
