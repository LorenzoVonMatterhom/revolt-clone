import * as THREE from "three";

export function createElectricPulse(car) {
  const parts = [];
  const fuse = car.userData.bombFuse;
  car.traverse(part => {
    if (part.isMesh && !part.userData.batteryGlowFX && !part.userData.electricPulseFX && !fuse?.getObjectById(part.id)) parts.push(part);
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: `
      varying vec3 arcPosition;
      void main() {
        arcPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * 0.04, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float strength;
      varying vec3 arcPosition;
      void main() {
        float tick = floor(time * 14.0);
        vec3 p = arcPosition * 0.65;
        float jag = sin(p.z * 6.0 + tick * 3.7) * 0.33
          + sin(p.z * 17.0 - tick * 2.3) * 0.14;
        float mainArc = abs(sin(p.x * 2.2 + p.y * 1.5 + jag + tick * 0.6));
        float branch = abs(sin(p.z * 2.0 - p.y * 2.7 + sin(p.x * 13.0 + tick) * 0.3));
        float core = 1.0 - smoothstep(0.015, 0.065, mainArc);
        float fork = (1.0 - smoothstep(0.01, 0.045, branch))
          * (1.0 - smoothstep(0.15, 0.55, mainArc));
        float glow = (1.0 - smoothstep(0.03, 0.24, mainArc)) * 0.22;
        float arc = max(core, fork);
        vec3 color = mix(vec3(0.32, 0.24, 1.0), vec3(0.88, 0.91, 1.0), arc);
        gl_FragColor = vec4(color, strength * min(1.0, arc + glow));
      }
    `,
  });
  const effect = new THREE.Group();
  effect.name = "White-violet surface lightning";
  effect.userData.electricPulseFX = true;
  effect.material = material;
  effect.userData.overlays = parts.map(part => {
    const overlay = new THREE.Mesh(part.geometry, material);
    overlay.name = "Surface lightning arcs";
    overlay.userData.electricPulseFX = true;
    part.add(overlay); return overlay;
  });
  car.add(effect);
  return effect;
}

export function disposeElectricPulse(car) {
  const effect = car.userData.electricPulse;
  if (!effect) return;
  for (const overlay of effect.userData.overlays) overlay.removeFromParent();
  effect.removeFromParent(); effect.material.dispose();
  delete car.userData.electricPulse;
}
