import * as THREE from "three";

export function disposeBatteryGlow(car) {
  const glow = car.userData.batteryGlow;
  if (!glow) return;
  for (const mesh of glow.meshes) mesh.removeFromParent();
  glow.material.dispose();
  delete car.userData.batteryGlow;
}

export function updateBatteryGlow(car, active, time, remaining) {
  if (!active) { disposeBatteryGlow(car); return; }
  let glow = car.userData.batteryGlow;
  if (!glow) {
    const parts = [];
    const fuse = car.userData.bombFuse;
    car.traverse(part => {
      if (part.isMesh && !part.userData.electricPulseFX && !part.userData.batteryGlowFX && !fuse?.getObjectById(part.id)) parts.push(part);
    });
    const material = new THREE.ShaderMaterial({
      uniforms: { time: { value: time }, strength: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      vertexShader: `
        varying vec3 glowNormal;
        varying vec3 glowView;
        varying vec3 glowPosition;
        void main() {
          glowPosition = position;
          vec4 viewPosition = modelViewMatrix * vec4(position + normal * 0.045, 1.0);
          glowNormal = normalize(normalMatrix * normal);
          glowView = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float strength;
        varying vec3 glowNormal;
        varying vec3 glowView;
        varying vec3 glowPosition;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(glowNormal), normalize(glowView))), 1.5);
          float pulse = 0.9 + 0.1 * sin(time * 7.0 + glowPosition.z * 0.45);
          vec3 orange = mix(vec3(1.0, 0.16, 0.015), vec3(1.0, 0.52, 0.06), rim);
          gl_FragColor = vec4(orange, strength * pulse * (0.30 + rim * 0.50));
        }
      `,
    });
    const meshes = parts.map(part => {
      const overlay = new THREE.Mesh(part.geometry, material);
      overlay.name = "Orange battery boost glow";
      overlay.userData.batteryGlowFX = true;
      part.add(overlay);
      return overlay;
    });
    glow = car.userData.batteryGlow = { material, meshes };
  }
  glow.material.uniforms.time.value = time;
  glow.material.uniforms.strength.value = Math.min(1, remaining * 4);
}
