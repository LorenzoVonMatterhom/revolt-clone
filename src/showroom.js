import * as THREE from "three";
import { ShowroomNavigation } from "./showroom-navigation.js";
import { gameAssetUrl } from "./assets.js";
import { loadLevel, loadCar, parsePrm, makeMeshes } from "./revolt.js";
import { FRONTEND } from "./levels.js";

export const STOCK_CARS = ["rc", "tc6", "phat", "volken", "beatall", "mouse", "candy", "mite", "r5", "tc1", "mud", "moss", "gencar", "tc5", "tc4", "dino", "adeon", "tc3", "fone", "rotor", "amw", "flag", "sgt", "tc2", "cougar", "toyeca", "sugo", "panga"];


// Built-in perpendicular shelves in the frontend showroom, matching the reference.
export const CAR_DISPLAY = { center: [200.7, 0, 160.7], columns: 7, rows: 4, scale: 0.7,
  shelfHeights: [21.8, 39.5, 57.9, 76.4] };

export function boxShelfPose(index) {
  const column = index % CAR_DISPLAY.columns;
  const row = Math.floor(index / CAR_DISPLAY.columns);
  // The original box front is local +Z; its depth extends behind the label.
  return {
    position: column < 4
      ? [141 + column * 16, CAR_DISPLAY.shelfHeights[row] + 6.8308 * CAR_DISPLAY.scale, 160.7]
      : [200.7, CAR_DISPLAY.shelfHeights[row] + 6.8308 * CAR_DISPLAY.scale, 151 - (column - 4) * 21],
    rotation: column < 4 ? Math.PI : -Math.PI / 2,
  };
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
    // Use the four existing corner shelves; do not add a floating display rack.
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
    this.navigation = new ShowroomNavigation(this.camera);
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

  render(renderer, dt, aspect, keys = new Map()) {
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    // Start facing the existing L-shaped shelf corner shown in the reference.
    const portrait = aspect < 1;
    if (!this.navigation.initialized) {
      this.camera.position.set(portrait ? 50 : 110, portrait ? 88 : 66, portrait ? -20 : 48);
      this.camera.lookAt(190, portrait ? 25 : 47, 148);
      this.navigation.initialized = true;
    }
    this.navigation.update(dt, keys);
    for (const [i, box] of this.boxes.entries()) {
      const target = i === this.selected ? new THREE.Vector3(180, portrait ? 55 : 49, 128) : box.userData.home;
      box.position.lerp(target, 1 - Math.exp(-dt * 9));
      const blend = 1 - Math.exp(-dt * 9);
      const scale = i === this.selected ? 1.5 : CAR_DISPLAY.scale;
      box.scale.lerp(new THREE.Vector3(scale, scale, scale), blend);
      const rotation = i === this.selected ? -2.4 : box.userData.homeRotation;
      box.rotation.y += (rotation - box.rotation.y) * blend;
    }
    renderer.render(this.scene, this.camera);
  }
}
