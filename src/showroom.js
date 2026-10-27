import * as THREE from "three";
import { ShowroomNavigation } from "./showroom-navigation.js";
import { gameAssetUrl } from "./assets.js";
import { loadLevel, parsePrm, makeMeshes, decodeBitmap } from "./revolt.js";
import { originalBoxPlacements, originalBoxArtwork, originalBoxModel } from "./car-boxes.js";
import { FRONTEND } from "./levels.js";

export const STOCK_CARS = ["rc", "tc6", "phat", "volken", "beatall", "mouse", "candy", "mite", "r5", "tc1", "mud", "moss", "gencar", "tc5", "tc4", "dino", "adeon", "tc3", "fone", "rotor", "amw", "flag", "sgt", "tc2", "cougar", "toyeca", "sugo", "panga"];


export function carDetails(text, id) {
  const clean = text.replace(/;[^\r\n]*/g, "");
  const number = (key) => Number(clean.match(new RegExp(`^\\s*${key}\\s+([-\\d.]+)`, "im"))?.[1] ?? 0);
  return { id, name: clean.match(/Name\s+"([^"]+)"/i)?.[1] ?? id,
    engineClass: number("Class"), rating: number("Rating"), speed: number("TopSpeed"),
    acceleration: number("Acc"), weight: number("Weight"), transmission: number("Trans") };
}

export class Showroom {
  static async create(renderer, manifest) {
    const showroom = new Showroom();
    const loaded = await loadLevel(FRONTEND, manifest, { collisions: false });
    showroom.room.add(loaded.group);
    const response = await fetch(gameAssetUrl("/levels/frontend/carbox.m"));
    const source = parsePrm(await response.arrayBuffer());
    const placements=originalBoxPlacements(loaded.objects);
    const artwork=new Map(await Promise.all([1,2,3,5].map(async page=>[
      page,decodeBitmap(await (await fetch(gameAssetUrl(`/cars/misc/carbox${page}.bmp`))).arrayBuffer()),
    ])));
    showroom.cars = await Promise.all(STOCK_CARS.map(async (id) => carDetails(await (await fetch(gameAssetUrl(`/cars/${id}/parameters.txt`))).text(), id)));
    // Use the exact native positions, including the floor stacks and shelf boxes.
    for (let index = 0; index < showroom.cars.length; index++) {
      const id=showroom.cars[index].id,pose=placements.get(id);
      if(!pose)throw new Error(`Missing original showroom position for ${id}`);
      const model=originalBoxModel(source,id),{page}=originalBoxArtwork(id);
      const box = makeMeshes([model], {...loaded.textures,7:artwork.get(page)}, [0, 0, 0]);
      box.traverse(object=>{if(object.material){
        // Package art is opaque printing; preserve its black ink and original RGB.
        object.material.vertexColors=false;object.material.alphaTest=0;
      }});
      box.position.copy(pose.position);box.quaternion.copy(pose.quaternion);
      box.userData.homeQuaternion = pose.quaternion.clone();
      box.userData.home = pose.position.clone();box.userData.boxId=pose.boxId;
      box.userData.carIndex = index;box.userData.carId=id;
      showroom.boxes.push(box); showroom.room.add(box);
    }
    showroom.select(0);
    return showroom;
  }

  constructor() {
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x111111);
    // Reflect the native showroom's handedness so its left/right arrangement
    // and printed box labels match the original view. Source textures are intact.
    this.room=new THREE.Group();this.room.scale.x=-1;this.scene.add(this.room);
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
      this.camera.position.set(portrait ? -15 : -110, portrait ? 105 : 66, portrait ? -62 : 48);
      this.camera.lookAt(-190, portrait ? 25 : 32, 148);
      this.navigation.initialized = true;
    }
    this.navigation.update(dt, keys);
    for (const [i, box] of this.boxes.entries()) {
      const target = i === this.selected ? new THREE.Vector3(portrait ? 174 : 208, portrait ? 54 : 50, 106) : box.userData.home;
      box.position.lerp(target, 1 - Math.exp(-dt * 9));
      const blend = 1 - Math.exp(-dt * 9);
      const scale = i === this.selected ? (portrait ? 1.6 : 2.2) : 1;
      box.scale.lerp(new THREE.Vector3(scale, scale, scale), blend);
      const rotation = i === this.selected
        ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(target.x+this.camera.position.x,target.z-this.camera.position.z))
        : box.userData.homeQuaternion;
      box.quaternion.slerp(rotation,blend);
    }
    renderer.render(this.scene, this.camera);
  }
}
