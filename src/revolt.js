import * as THREE from "three";
import { gameAssetUrl } from "./assets.js";
import { computeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

export const RV_SCALE = 0.1;

class Reader {
  constructor(buffer) { this.view = new DataView(buffer); this.offset = 0; }
  u16() { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i16() { const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  i32() { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  f32() { const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
  vec() { return [this.f32(), this.f32(), this.f32()]; }
}

export function parseMesh(reader, world = false) {
  if (world) reader.offset += 40;
  const polygonCount = reader.u16(), vertexCount = reader.u16();
  const polygons = [];
  for (let i = 0; i < polygonCount; i++) {
    const flags = reader.u16(), texture = reader.i16();
    const indices = Array.from({ length: 4 }, () => reader.u16());
    const colors = [];
    for (let j = 0; j < 4; j++) {
      const o = reader.offset;
      colors.push([reader.view.getUint8(o + 2), reader.view.getUint8(o + 1), reader.view.getUint8(o), 255 - reader.view.getUint8(o + 3)]);
      reader.offset += 4;
    }
    const uv = Array.from({ length: 4 }, () => [reader.f32(), reader.f32()]);
    polygons.push({ flags, texture, indices, colors, uv });
  }
  const vertices = Array.from({ length: vertexCount }, () => ({ position: reader.vec(), normal: reader.vec() }));
  for (const p of polygons) {
    for (const index of p.indices.slice(0, p.flags & 1 ? 4 : 3)) {
      if (index >= vertexCount) throw new Error("Invalid Re-Volt vertex index");
    }
  }
  return { polygons, vertices };
}

export function parseWorld(buffer) {
  const r = new Reader(buffer), count = r.i32();
  const meshes = Array.from({ length: count }, () => parseMesh(r, true));
  const cubes = r.i32();
  for (let i = 0; i < cubes; i++) { r.offset += 16; const count = r.i32(); r.offset += count * 4; }
  const animations = [];
  if (r.offset < buffer.byteLength) {
    const count = r.i32();
    for (let i = 0; i < count; i++) {
      const frames = r.i32();
      animations.push(Array.from({ length: frames }, () => ({ texture: r.i32(), delay: r.f32(), uv: Array.from({ length: 4 }, () => [r.f32(), r.f32()]) })));
    }
  }
  return { meshes, animations };
}

export function parsePrm(buffer) { return parseMesh(new Reader(buffer)); }

export function parseObjects(buffer, origin = [0, 0, 0]) {
  const reader = new Reader(buffer);
  const count = reader.i32();
  if (count < 0 || buffer.byteLength !== 4 + count * 56) throw new Error("Invalid Re-Volt FOB object file");
  return Array.from({ length: count }, () => ({
    type: reader.i32(), flags: Array.from({ length: 4 }, () => reader.i32()),
    position: new THREE.Vector3(...converted(reader.vec(), origin)),
    up: reader.vec(), forward: reader.vec(),
  }));
}

export function resolveModel(name, files) {
  const matches = files.filter((p) => p.toLowerCase().split("/").at(-1).startsWith(name) && p.endsWith(".prm"));
  const exact = matches.find((p) => p.toLowerCase().endsWith(`/${name}.prm`) || p.toLowerCase() === `${name}.prm`);
  // The original FIN name is limited to eight characters. Match the base model before numbered variants.
  return exact ?? matches.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

export function parseInstances(buffer) {
  const r = new Reader(buffer), count = r.i32();
  return Array.from({ length: count }, () => {
    const offset = r.offset;
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset, 9)).split("\0")[0].toLowerCase();
    const tint = [9, 10, 11].map((i) => (128 + r.view.getInt8(offset + i)) / 255);
    const flags = r.view.getUint8(offset + 17);
    r.offset += 24;
    return { name, tint, flags, position: r.vec(), matrix: [...r.vec(), ...r.vec(), ...r.vec()] };
  });
}

export function parsePositions(buffer) {
  if (buffer.byteLength < 12) return [];
  const r = new Reader(buffer), count = r.i32(), start = r.i32();
  r.f32();
  const nodes = Array.from({ length: count }, () => ({ position: r.vec(), distance: r.f32(), prev: Array.from({ length: 4 }, () => r.i32()), next: Array.from({ length: 4 }, () => r.i32()) }));
  const path = [], seen = new Set();
  let index = start;
  while (nodes[index] && !seen.has(index)) {
    seen.add(index); path.push(nodes[index].position);
    index = nodes[index].next.find((n) => n >= 0);
  }
  return path;
}

export function parseInfo(text) {
  const info = {};
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.split(";")[0].trim().split(/[\s,]+/);
    if (tokens.length > 1) info[tokens[0].toUpperCase()] = tokens.slice(1).map(Number);
  }
  return info;
}

export function parseAiPositions(buffer, origin = [0, 0, 0]) {
  if (buffer.byteLength <= 4) return [];
  const view = new DataView(buffer), count = view.getInt16(0, true);
  if (count <= 0 || buffer.byteLength !== 12 + count * 76) throw new Error("Invalid stock Re-Volt FAN file");
  const nodes = Array.from({ length: count }, (_, i) => {
    const offset = 12 + i * 76;
    const readVector = (at) => [0, 1, 2].map((axis) => view.getFloat32(at + axis * 4, true));
    const left = new THREE.Vector3(...converted(readVector(offset + 40), origin));
    const right = new THREE.Vector3(...converted(readVector(offset + 56), origin));
    return { position: left.lerp(right, THREE.MathUtils.clamp(view.getFloat32(offset + 4, true), 0, 1)), next: [view.getInt32(offset + 28, true), view.getInt32(offset + 32, true)] };
  });
  let start = 0;
  nodes.forEach((node, i) => { if (node.position.lengthSq() < nodes[start].position.lengthSq()) start = i; });
  const path = [], seen = new Set();
  let index = start;
  while (nodes[index] && !seen.has(index)) {
    seen.add(index); path.push(nodes[index].position);
    index = nodes[index].next.find((next) => next >= 0 && next < count);
  }
  return path;
}

function converted(position, origin = [0, 0, 0]) {
  return [(position[0] - origin[0]) * RV_SCALE, -(position[1] - origin[1]) * RV_SCALE, (position[2] - origin[2]) * RV_SCALE];
}

export function makeMeshes(meshes, materials, origin, animations = [], tint = [1, 1, 1]) {
  const buckets = new Map(), color = new THREE.Color();
  for (const source of meshes) for (const p of source.polygons) {
    const frame = p.flags & 0x200 ? animations[p.texture]?.[0] : null;
    const texture = frame?.texture ?? p.texture;
    const key = `${texture}:${p.flags & 0x106}`;
    if (!buckets.has(key)) buckets.set(key, { positions: [], colors: [], uv: [], flags: p.flags, texture });
    const b = buckets.get(key);
    // The Y reflection converts the original clockwise winding to Three.js winding.
    const corners = p.flags & 1 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
    for (const c of corners) {
      const vertex = source.vertices[p.indices[c]];
      b.positions.push(...converted(vertex.position, origin));
      const rgba = p.colors[c];
      color.setRGB(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, THREE.SRGBColorSpace);
      b.colors.push(color.r * tint[0], color.g * tint[1], color.b * tint[2], p.flags & 4 ? rgba[3] / 255 : 1);
      const uv = frame?.uv[c] ?? p.uv[c];
      b.uv.push(uv[0], 1 - uv[1]);
    }
  }
  const group = new THREE.Group();
  for (const b of buckets.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(b.colors, 4));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    computeBoundsTree.call(geometry);
    const material = new THREE.MeshBasicMaterial({ map: materials[b.texture] ?? null, vertexColors: true, side: b.flags & 2 ? THREE.DoubleSide : THREE.FrontSide, transparent: Boolean(b.flags & 0x104), alphaTest: 0.01, depthWrite: !(b.flags & 0x104), blending: b.flags & 0x100 ? THREE.AdditiveBlending : THREE.NormalBlending });
    const object = new THREE.Mesh(geometry, material);
    object.raycast = acceleratedRaycast;
    group.add(object);
  }
  return group;
}

export function decodeBitmap(buffer) {
  const v = new DataView(buffer), offset = v.getUint32(10, true), dibSize = v.getUint32(14, true);
  const width = v.getInt32(18, true), signedHeight = v.getInt32(22, true), height = Math.abs(signedHeight);
  const bits = v.getUint16(28, true), compression = v.getUint32(30, true);
  if (![8, 24, 32].includes(bits) || compression !== 0) throw new Error(`Unsupported BMP: ${bits} bits, compression ${compression}`);
  const stride = Math.ceil(width * bits / 32) * 4, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = signedHeight > 0 ? height - 1 - y : y;
    let source = offset + row * stride + x * (bits / 8);
    if (bits === 8) source = 14 + dibSize + v.getUint8(source) * 4;
    const dest = (y * width + x) * 4;
    pixels[dest] = v.getUint8(source + 2); pixels[dest + 1] = v.getUint8(source + 1); pixels[dest + 2] = v.getUint8(source);
    pixels[dest + 3] = pixels[dest] + pixels[dest + 1] + pixels[dest + 2] === 0 ? 0 : 255;
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

async function fetchBuffer(url) {
  const response = await fetch(gameAssetUrl(url));
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.arrayBuffer();
}

export async function loadLevel(level, manifest) {
  const base = `/levels/${level.id}/${level.id}`;
  const [worldBuffer, instanceBuffer, positionsBuffer, infoResponse, objectsBuffer, aiBuffer] = await Promise.all([fetchBuffer(`${base}.w`), fetchBuffer(`${base}.fin`), manifest.includes(`${base}.pan`) ? fetchBuffer(`${base}.pan`) : Promise.resolve(new ArrayBuffer(0)), fetch(gameAssetUrl(`${base}.inf`)), fetchBuffer(`${base}.fob`), fetchBuffer(`${base}.fan`)]);
  const world = parseWorld(worldBuffer), instances = parseInstances(instanceBuffer);
  const info = parseInfo(await infoResponse.text()), origin = info.STARTPOS ?? [0, 0, 0];
  const textures = {};
  const files = manifest.filter((p) => p.startsWith(`/levels/${level.id}/`));
  await Promise.all(files.filter((p) => p.match(new RegExp(`/${level.id}[a-z]\\.bmp$`, "i"))).map(async (p) => {
    const page = p.at(-5).toLowerCase().charCodeAt(0) - 97;
    textures[page] = decodeBitmap(await fetchBuffer(p));
  }));
  const group = makeMeshes(world.meshes, textures, origin, world.animations);
  const models = new Map();
  const resolved = instances.map((instance) => {
    const path = resolveModel(instance.name, files);
    if (!path) throw new Error(`Missing or ambiguous model ${level.id}/${instance.name}`);
    return { ...instance, path };
  });
  await Promise.all([...new Set(resolved.map((i) => i.path))].map(async (p) => models.set(p, parsePrm(await fetchBuffer(p)))));
  for (const instance of resolved) {
    if (instance.flags & 2) continue;
    const model = makeMeshes([models.get(instance.path)], textures, [0, 0, 0], [], instance.flags & 16 ? instance.tint : [1, 1, 1]);
    const m = instance.matrix, position = converted(instance.position, origin);
    // FIN stores orientation basis vectors as rows (columns in Three.js).
    model.matrix.set(m[0], -m[3], m[6], position[0], -m[1], m[4], -m[7], position[1], m[2], -m[5], m[8], position[2], 0, 0, 0, 1);
    model.matrixAutoUpdate = false;
    model.name = instance.name;
    model.userData.noCollision = Boolean(instance.flags & 32);
    group.add(model);
  }
  group.updateMatrixWorld(true);
  let path = parsePositions(positionsBuffer).map((p) => new THREE.Vector3(...converted(p, origin)));
  if (path.length > 2) {
    let nearest = 0;
    path.forEach((p, i) => { if (p.lengthSq() < path[nearest].lengthSq()) nearest = i; });
    path = [...path.slice(nearest), ...path.slice(0, nearest)];
  }
  return { group, path, aiPath: parseAiPositions(aiBuffer, origin), info, textures, objects: parseObjects(objectsBuffer, origin), stats: { meshes: world.meshes.length, polygons: world.meshes.reduce((n, m) => n + m.polygons.length, 0), instances: instances.length, textures: Object.keys(textures).length } };
}

export function disposeLevel(level) {
  if (!level) return;
  level.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  Object.values(level.textures).forEach((t) => t.dispose());
}

export async function loadCar(id, name) {
  const base = `/cars/${id}`;
  const response = await fetch(gameAssetUrl(`${base}/parameters.txt`));
  const parameters = (await response.text()).replace(/;[^\r\n]*/g, "");
  const models = new Map([...parameters.matchAll(/MODEL\s+(\d+)\s+"([^"]+)"/gi)].map((m) => [Number(m[1]), `/${m[2].replaceAll("\\", "/").toLowerCase()}`]));
  const tpage = parameters.match(/TPAGE\s+"([^"]+)"/i)[1];
  const texture = decodeBitmap(await fetchBuffer(`/${tpage.replaceAll("\\", "/").toLowerCase()}`));
  const textures = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i, texture]));
  const root = new THREE.Group();
  root.name = name;
  root.userData.engineClass = Number(parameters.match(/^\s*Class\s+(\d+)/im)?.[1] ?? 0);
  const body = parameters.match(/BODY\s*\{([^}]+)\}/i)[1];
  const bodyNumber = Number(body.match(/ModelNum\s+(\d+)/i)[1]);
  const bodyMesh = makeMeshes([parsePrm(await fetchBuffer(models.get(bodyNumber)))], textures, [0, 0, 0]);
  root.add(bodyMesh);
  const bodyBounds = new THREE.Box3().setFromObject(root);
  const wheels = [];
  for (const block of parameters.matchAll(/WHEEL\s+\d+\s*\{([^}]+)\}/gi)) {
    const number = Number(block[1].match(/ModelNum\s+(\d+)/i)[1]);
    const offset = block[1].match(/Offset1\s+([^\r\n]+)/i)[1].trim().split(/[\s,]+/).map(Number);
    const tire = makeMeshes([parsePrm(await fetchBuffer(models.get(number)))], textures, [0, 0, 0]);
    const wheel = new THREE.Group();
    wheel.add(tire);
    wheel.userData.tire = tire;
    wheel.userData.turnable = /IsTurnable\s+TRUE/i.test(block[1]);
    wheel.userData.powered = /IsPowered\s+TRUE/i.test(block[1]);
    wheel.userData.engineRatio = Math.abs(Number(block[1].match(/EngineRatio\s+([-\d.]+)/i)?.[1] ?? 1));
    wheel.userData.steerRatio = Math.abs(Number(block[1].match(/SteerRatio\s+([-\d.]+)/i)?.[1] ?? 0.45));
    wheel.position.set(...converted(offset));
    root.add(wheel); wheels.push(wheel);
  }
  const bounds = new THREE.Box3().setFromObject(root);
  const visual = new THREE.Group();
  [...root.children].forEach((child) => visual.add(child));
  visual.position.y = -bounds.min.y - 0.42;
  root.add(visual);
  const bodyVertices = [];
  const vertex = new THREE.Vector3();
  bodyMesh.traverse((object) => {
    if (!object.geometry) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) bodyVertices.push(...vertex.fromBufferAttribute(positions, i).add(visual.position).toArray());
  });
  root.userData.wheels = wheels;
  root.userData.physics = {
    bodyVertices: new Float32Array(bodyVertices),
    halfExtents: bodyBounds.getSize(new THREE.Vector3()).multiplyScalar(0.5),
    center: bodyBounds.getCenter(new THREE.Vector3()).add(visual.position),
    wheels: wheels.map((wheel) => {
      const size = new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3());
      return { position: wheel.position.clone().add(visual.position), radius: size.y * 0.5, halfWidth: size.x * 0.5, turnable: wheel.userData.turnable, powered: wheel.userData.powered, steerRatio: wheel.userData.steerRatio, engineRatio: wheel.userData.engineRatio };
    }),
  };
  return root;
}
