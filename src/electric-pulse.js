import * as THREE from "three";

export function createElectricPulse(car) {
  const size = car.userData.physics?.halfExtents ?? new THREE.Vector3(2, 1, 4);
  const center = car.userData.physics?.center ?? new THREE.Vector3();
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 pulseUv;
      varying vec3 pulseNormal;
      varying vec3 pulseView;
      void main() {
        pulseUv = uv;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        pulseNormal = normalize(normalMatrix * normal);
        pulseView = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float strength;
      varying vec2 pulseUv;
      varying vec3 pulseNormal;
      varying vec3 pulseView;
      void main() {
        float edge = pow(1.0 - abs(dot(normalize(pulseNormal), normalize(pulseView))), 2.0);
        float zigzag = sin(pulseUv.y * 64.0 + time * 19.0) * 0.7
          + sin(pulseUv.y * 137.0 - time * 27.0) * 0.35;
        float arc = pow(max(0.0, cos(pulseUv.x * 50.2655 + zigzag + time * 3.0)), 45.0);
        float flicker = 0.65 + 0.35 * sin(time * 37.0 + pulseUv.y * 23.0);
        float alpha = strength * (edge * 0.14 + arc * flicker * 0.85);
        vec3 color = mix(vec3(0.08, 0.4, 1.0), vec3(0.65, 0.95, 1.0), arc);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material);
  shell.name = "Animated electro pulse";
  shell.userData.electricPulseFX = true;
  shell.position.copy(center);
  shell.scale.set(size.x * 1.35 + 0.5, size.y * 1.5 + 0.8, size.z * 1.25 + 0.5);
  car.add(shell);
  return shell;
}

export function disposeElectricPulse(car) {
  const shell = car.userData.electricPulse;
  if (!shell) return;
  car.remove(shell);
  shell.geometry.dispose(); shell.material.dispose();
  delete car.userData.electricPulse;
}
