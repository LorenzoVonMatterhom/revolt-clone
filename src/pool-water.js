import * as THREE from "three";

export function poolVolumes(objects) {
  const surfaces = objects.filter(object => object.type === 47 && object.flags[0] === 1);
  return objects.filter(object => object.type === 68).map(object => {
    const half = new THREE.Vector3(...object.flags.slice(0, 3).map(value => Math.abs(value) * 0.1));
    const surface = surfaces.reduce((best, candidate) => {
      const distance = Math.hypot(candidate.position.x - object.position.x, candidate.position.z - object.position.z);
      return !best || distance < best.distance ? { object: candidate, distance } : best;
    }, null);
    return {
      center: object.position.clone(), half,
      height: surface?.object.position.y ?? object.position.y + half.y,
      surfacePosition: surface?.object.position.clone() ?? new THREE.Vector3(object.position.x, object.position.y + half.y, object.position.z),
    };
  }).filter(volume => volume.half.x > 0 && volume.half.y > 0 && volume.half.z > 0);
}

export function submergedFraction(point, volume, bodyHeight) {
  if (Math.abs(point.x - volume.center.x) > volume.half.x ||
      Math.abs(point.z - volume.center.z) > volume.half.z ||
      point.y < volume.center.y - volume.half.y - bodyHeight) return 0;
  return THREE.MathUtils.clamp((volume.height - point.y) / bodyHeight, 0, 1);
}

export class PoolWater {
  constructor(objects, model) {
    this.volumes = poolVolumes(objects);
    this.group = new THREE.Group();
    this.group.name = "Swimming pool water";
    this.group.userData.noCollision = true;
    this.time = 0;
    this.ripples = [];
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(model.vertices.flatMap(vertex => [
      vertex.position[0] * 0.1, -vertex.position[1] * 0.1, vertex.position[2] * 0.1,
    ]));
    const indices = [];
    for (const polygon of model.polygons) {
      const [a, b, c, d] = polygon.indices;
      indices.push(a, b, c);
      if (polygon.flags & 1) indices.push(a, c, d);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    this.material = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        uniform float time;
        varying vec2 waterPosition;
        varying float wave;
        void main() {
          vec3 p = position;
          waterPosition = p.xz;
          wave = sin(p.x * 0.12 + time * 1.5) * cos(p.z * 0.16 - time);
          p.y += wave * 0.18;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec2 waterPosition;
        varying float wave;
        void main() {
          float ripple = sin(waterPosition.x * 0.45 + waterPosition.y * 0.32 + time * 2.0);
          float highlight = pow(max(0.0, ripple), 10.0);
          vec3 color = mix(vec3(0.02, 0.35, 0.52), vec3(0.18, 0.72, 0.80), wave * 0.5 + 0.5);
          color += highlight * vec3(0.22, 0.28, 0.28);
          gl_FragColor = vec4(color, 0.67);
        }
      `,
    });
    for (const volume of this.volumes) {
      const surface = new THREE.Mesh(geometry, this.material);
      surface.position.copy(volume.surfacePosition);
      surface.renderOrder = 2;
      this.group.add(surface);
    }
  }

  applyCar(car, dt) {
    const position = new THREE.Vector3().copy(car.body.translation());
    const rotation = new THREE.Quaternion().copy(car.body.rotation());
    const size = car.setup.halfExtents;
    const height = Math.max(0.8, size.y * 2);
    const mass = car.body.mass();
    let fraction = 0, activeVolume = null;
    for (const x of [-0.7, 0.7]) for (const z of [-0.7, 0.7]) {
      const point = new THREE.Vector3(car.setup.center.x + size.x * x,
        car.setup.center.y - size.y, car.setup.center.z + size.z * z)
        .applyQuaternion(rotation).add(position);
      let submerged = 0;
      for (const volume of this.volumes) {
        const amount = submergedFraction(point, volume, height);
        if (amount > submerged) { submerged = amount; activeVolume = volume; }
      }
      fraction += submerged / 4;
      // Sample the underside, but apply lift at the chassis center plane.
      // Applying full-submersion lift below the center of mass tips the car over.
      const liftPoint = new THREE.Vector3(car.setup.center.x + size.x * x,
        car.setup.center.y, car.setup.center.z + size.z * z)
        .applyQuaternion(rotation).add(position);
      if (submerged > 0) car.body.applyImpulseAtPoint({ x: 0, y: mass * 42 * 1.18 * submerged * dt / 4, z: 0 }, liftPoint, true);
    }
    const previous = car.waterFraction ?? 0;
    car.waterFraction = fraction;
    if (fraction > 0) {
      const velocity = car.body.linvel();
      const horizontal = 1 - Math.exp(-3 * fraction * dt);
      const vertical = 1 - Math.exp(-4 * fraction * dt);
      car.body.applyImpulse({ x: -mass * velocity.x * horizontal, y: -mass * velocity.y * vertical, z: -mass * velocity.z * horizontal }, true);
      const angular = car.body.angvel();
      const angularDrag = Math.exp(-2 * fraction * dt);
      car.body.setAngvel({ x: angular.x * angularDrag, y: angular.y * angularDrag, z: angular.z * angularDrag }, true);
      if (previous <= 0 && activeVolume) {
        this.addRipple(position, activeVolume.height);
        this.onSplash?.();
      }
    }
    return fraction;
  }

  addRipple(position, height) {
    const material = new THREE.MeshBasicMaterial({ color: 0xc0efff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 24), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(position.x, height + 0.24, position.z);
    ring.renderOrder = 3;
    this.group.add(ring);
    this.ripples.push({ ring, age: 0 });
  }

  update(dt, cars = []) {
    this.time += dt;
    this.material.uniforms.time.value = this.time;
    for (const car of cars) {
      car.waterWakeTime = (car.waterWakeTime ?? 0) + dt;
      const position = car.body.translation();
      const velocity = car.body.linvel();
      if (car.waterFraction > 0.05 && Math.hypot(velocity.x, velocity.z) > 2 && car.waterWakeTime > 0.25) {
        const volume = this.volumes.find(volume => submergedFraction(position, volume, 2) > 0);
        if (volume) this.addRipple(position, volume.height);
        car.waterWakeTime = 0;
      }
    }
    this.ripples = this.ripples.filter(ripple => {
      ripple.age += dt;
      ripple.ring.scale.setScalar(1 + ripple.age * 8);
      ripple.ring.material.opacity = Math.max(0, 0.75 * (1 - ripple.age));
      if (ripple.age < 1) return true;
      this.group.remove(ripple.ring);
      ripple.ring.geometry.dispose(); ripple.ring.material.dispose();
      return false;
    });
  }
}
