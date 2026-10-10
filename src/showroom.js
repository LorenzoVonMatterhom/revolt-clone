import * as THREE from "three";
import { gameAssetUrl } from "./assets.js";
import { loadLevel, loadCar, parsePrm, makeMeshes } from "./revolt.js";
import { FRONTEND } from "./levels.js";

export const STOCK_CARS = ["rc", "tc6", "phat", "volken", "beatall", "mouse", "candy", "mite", "r5", "tc1", "mud", "moss", "gencar", "tc5", "tc4", "dino", "adeon", "tc3", "fone", "rotor", "amw", "flag", "sgt", "tc2", "cougar", "toyeca", "sugo", "panga"];


// The shop corner between SALEBIN (265, -181) and MAGSTAND (233, -85).
// Coordinates use the same converted world units as the original frontend.
export const CAR_DISPLAY = { center: [242, 0, -134], radius: 32, columns: 7, rows: 4, scale: 0.7 };

export function boxShelfPose(index) {
  const column = index % CAR_DISPLAY.columns;
  const row = Math.floor(index / CAR_DISPLAY.columns);
  const angle = -1.15 + column * 2.3 / (CAR_DISPLAY.columns - 1);
  return {
    position: [CAR_DISPLAY.center[0] + Math.cos(angle) * CAR_DISPLAY.radius,
      4.82 + row * 10.2, CAR_DISPLAY.center[2] + Math.sin(angle) * CAR_DISPLAY.radius],
    rotation: -Math.PI / 2 - angle,
  };
}

function addBoxShelves(scene) {
  const wood = new THREE.MeshBasicMaterial({ color: 0x80602d });
  // Short boards follow the curve instead of cutting across the shop corner.
  for (let row = 0; row < CAR_DISPLAY.rows; row++) {
    for (let column = 0; column < CAR_DISPLAY.columns - 1; column++) {
      const a = new THREE.Vector3(...boxShelfPose(row * CAR_DISPLAY.columns + column).position);
      const b = new THREE.Vector3(...boxShelfPose(row * CAR_DISPLAY.columns + column + 1).position);
      const board = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, a.distanceTo(b) + 2), wood);
      board.position.copy(a).add(b).multiplyScalar(0.5);
      board.position.x += 3;
      board.position.y -= 4.9;
      board.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      scene.add(board);
    }
  }
}

export function carDetails(text, id) {
  const clean = text.replace(/;[^\r\n]*/g, "");
  const number = (key) => Number(clean.match(new RegExp(`^\\s*${key}\\s+([-\\d.]+)`, "im"))?.[1] ?? 0);
  return { id, name: clean.match(/Name\s+"([^"]+)"/i)?.[1] ?? id,
    engineClass: number("Class"), rating: number("Rating"), speed: number("TopSpeed"),
    acceleration: number("Acc"), weight: number("Weight"), transmission: number("Trans") };
}

// Keep the original box geometry and atlas UVs; only its front label is car-specific.
export function labeledBox(source) {
  const model = structuredClone(source);
  model.polygons.forEach((polygon, i) => {
    polygon.colors = polygon.colors.map(() => [255, 255, 255, 255]);
    if (i === 0) {
      polygon.texture = 7;
      polygon.uv = [[0, 0], [0, 1], [1, 1], [1, 0]];
    }
  });
  return model;
}

function boxLabel(renderer, car, details, atlas) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 416;
  const ctx = canvas.getContext("2d");
  const image = atlas.image;
  const original = document.createElement("canvas");
  original.width = image.width; original.height = image.height;
  original.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 512, 416);
  ctx.drawImage(original, 0, 86, 132, 110, 0, 0, 512, 416);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(145, 64, 365, 336);
  ctx.fillStyle = "#d32132"; ctx.font = "bold 30px Arial";
  ctx.fillText(details.name.toUpperCase(), 153, 100, 348);

  const preview = new THREE.Scene();
  preview.add(car);
  const bounds = new THREE.Box3().setFromObject(car);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3()).length();
  const camera = new THREE.PerspectiveCamera(38, 1.4, 0.1, 200);
  camera.position.copy(center).add(new THREE.Vector3(size * 0.8, size * 0.65, size * 0.9));
  camera.lookAt(center);
  const target = new THREE.WebGLRenderTarget(350, 250);
  const oldTarget = renderer.getRenderTarget(), oldColor = renderer.getClearColor(new THREE.Color()), oldAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target); renderer.setClearColor(0xffffff, 0);
  renderer.render(preview, camera);
  const pixels = new Uint8Array(350 * 250 * 4);
  renderer.readRenderTargetPixels(target, 0, 0, 350, 250, pixels);
  renderer.setRenderTarget(oldTarget); renderer.setClearColor(oldColor, oldAlpha);
  const flipped = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < 250; y++) flipped.set(pixels.subarray(y * 1400, (y + 1) * 1400), (249 - y) * 1400);
  const rendered = document.createElement("canvas"); rendered.width = 350; rendered.height = 250;
  rendered.getContext("2d").putImageData(new ImageData(flipped, 350, 250), 0, 0);
  ctx.drawImage(rendered, 155, 122);
  target.dispose();
  preview.remove(car);
  car.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export class Showroom {
  static async create(renderer, manifest) {
    const showroom = new Showroom();
    const loaded = await loadLevel(FRONTEND, manifest, { collisions: false });
    showroom.scene.add(loaded.group);
    const response = await fetch(gameAssetUrl("/levels/frontend/carbox.m"));
    const model = labeledBox(parsePrm(await response.arrayBuffer()));
    showroom.cars = await Promise.all(STOCK_CARS.map(async (id) => carDetails(await (await fetch(gameAssetUrl(`/cars/${id}/parameters.txt`))).text(), id)));
    // Four curved shelves in the original shop corner shown in the reference.
    addBoxShelves(showroom.scene);
    const previews = await Promise.all(showroom.cars.map(details => loadCar(details.id, details.name)));
    for (const [index, details] of showroom.cars.entries()) {
      const car = previews[index];
      const label = boxLabel(renderer, car, details, loaded.textures[4]);
      const box = makeMeshes([model], { ...loaded.textures, 7: label }, [0, 0, 0]);
      const pose = boxShelfPose(index);
      box.scale.setScalar(CAR_DISPLAY.scale);
      box.position.set(...pose.position);
      box.rotation.y = pose.rotation;
      box.userData.homeRotation = pose.rotation;
      box.userData.home = box.position.clone(); box.userData.carIndex = index;
      showroom.boxes.push(box); showroom.scene.add(box);
    }
    showroom.select(0);
    return showroom;
  }

  constructor() {
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x111111);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 800);
    this.boxes = []; this.selected = 0; this.ray = new THREE.Raycaster();
  }

  select(index) {
    this.selected = (index + this.boxes.length) % this.boxes.length;
    return this.cars[this.selected];
  }

  pick(x, y) {
    this.ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = this.ray.intersectObjects(this.boxes, true)[0];
    if (!hit) return null;
    let box = hit.object;
    while (box && box.userData.carIndex === undefined) box = box.parent;
    return box ? this.select(box.userData.carIndex) : null;
  }

  render(renderer, dt, aspect) {
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    // Face the sale-display / magazine-rack corner, rather than the central aisle.
    const portrait = aspect < 1;
    this.camera.position.set(portrait ? 118 : 145, portrait ? 82 : 76, -134);
    this.camera.lookAt(256, portrait ? 35 : 28, -134);
    for (const [i, box] of this.boxes.entries()) {
      const target = i === this.selected ? new THREE.Vector3(225, portrait ? 49 : 42, portrait ? -134 : -112) : box.userData.home;
      box.position.lerp(target, 1 - Math.exp(-dt * 9));
      const blend = 1 - Math.exp(-dt * 9);
      const scale = i === this.selected ? 1.5 : CAR_DISPLAY.scale;
      box.scale.lerp(new THREE.Vector3(scale, scale, scale), blend);
      const rotation = i === this.selected ? -Math.PI / 2 + 0.12 : box.userData.homeRotation;
      box.rotation.y += (rotation - box.rotation.y) * blend;
    }
    renderer.render(this.scene, this.camera);
  }
}
