import * as THREE from "three";

export class ShowroomNavigation {
  constructor(camera) { this.camera = camera; this.initialized = false; }
  look(dx, dy) {
    const angles = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    angles.y -= dx * 0.003;
    angles.x = THREE.MathUtils.clamp(angles.x - dy * 0.003, -1.45, 1.45);
    this.camera.quaternion.setFromEuler(angles);
  }
  update(dt, keys) {
    const x = Number(keys.get("KeyD") === true) - Number(keys.get("KeyA") === true);
    const z = Number(keys.get("KeyW") === true) - Number(keys.get("KeyS") === true);
    if (!x && !z) return;
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const movement = forward.multiplyScalar(z).addScaledVector(right, x).normalize();
    this.camera.position.addScaledVector(movement, Math.min(dt, 0.05) * 65);
  }
}
