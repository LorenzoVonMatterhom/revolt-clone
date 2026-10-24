import * as THREE from "three";

export function createShockwaveVisual() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
    const at = (y * size + x) * 4;
    pixels[at] = pixels[at + 1] = pixels[at + 2] = 255;
    pixels[at + 3] = Math.round(Math.max(0, Math.exp(-radius * radius * 5) - Math.exp(-5)) * 255);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.needsUpdate = true;
  const group = new THREE.Group(); group.name = "Blue-white shockwave with glowing bead trail";
  group.userData.shockwaveTexture = texture;
  group.userData.age = 0;
  const sprite = (color, scale, opacity) => {
    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color, opacity,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.scale.setScalar(scale); group.add(mesh); return mesh;
  };
  sprite(0x3265ff, 9, .8);
  sprite(0xb4deff, 4.5, 1);
  sprite(0xffffff, 2.5, 1);
  group.userData.beads = Array.from({ length: 12 }, (_, i) => {
    const bead = sprite(i < 3 ? 0xcceaff : 0x8c9fff, 2.3 - i * .12, .85 - i * .05);
    bead.position.set(Math.sin(i * 2.4) * .5, -(i + 1) * 3, Math.cos(i * 1.7) * .5);
    bead.visible = false; return bead;
  });
  return group;
}

export function updateShockwaveVisual(group, dt, speed) {
  group.userData.age += dt;
  group.children[0].scale.setScalar(9 + Math.sin(group.userData.age * 24) * .7);
  group.userData.beads.forEach((bead, i) => {
    bead.visible = group.userData.age * speed >= (i + 1) * 3;
    bead.material.opacity = (.85 - i * .05) * (.8 + .2 * Math.sin(group.userData.age * 18 - i));
  });
}

export function disposeShockwaveVisual(group) {
  group.traverse(part => part.material?.dispose());
  group.userData.shockwaveTexture.dispose();
}
