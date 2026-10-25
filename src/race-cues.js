import * as THREE from "three";
import { gameAssetUrl } from "./assets.js";
import { parsePrm, makeMeshes, decodeBitmap } from "./revolt.js";

export class RaceCountdown {
  constructor(onCue = () => {}) { this.onCue = onCue; this.reset(); }
  reset() { this.elapsed = null; this.stage = null; }
  start() { this.elapsed = 0; this.stage = '3'; this.onCue(this.stage); }
  get locked() { return this.elapsed !== null && this.elapsed < 3; }
  update(dt) {
    if (this.elapsed === null) return dt;
    const previous = this.elapsed;
    this.elapsed += Math.max(0, dt);
    const stage = this.elapsed < 3 ? String(3-Math.floor(this.elapsed)) : this.elapsed < 4 ? 'GO!' : null;
    if (stage !== this.stage) { this.stage = stage; if (stage) this.onCue(stage); }
    return Math.max(0,this.elapsed-3)-Math.max(0,previous-3);
  }
}

// Native TRI direction IDs. The converted Three.js driving view mirrors the
// original handedness: swap left/right artwork to match the visible road.
export const DIRECTION_SPRITES = [
  [64,0,false,'Chicane right'], [0,0,false,'Turn around right'],
  [64,64,false,'Turn right'], [192,0,false,'Bear right'],
  [64,0,true,'Chicane left'], [0,0,true,'Turn around left'],
  [64,64,true,'Turn left'], [192,0,true,'Bear left'],
  [0,64,false,'Straight ahead'], [128,0,false,'Caution'], [192,64,false,'Fork'],
];

function rasterizeCountdown(renderer, models) {
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-6.2,6.2,3.1,-3.1,.1,100);
  camera.position.z = -20; camera.lookAt(0,0,0);
  const target = new THREE.WebGLRenderTarget(512,256);
  const previousTarget = renderer.getRenderTarget(), clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
  const images = new Map();
  try {
    renderer.setRenderTarget(target); renderer.setClearColor(0,0);
    for (const [stage,model] of models) {
      const group = makeMeshes([model], {}, [0,0,0]);
      // Face the camera without clipping the wider GO! lettering.
      const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
      group.scale.x = -1; group.position.set(center.x,-center.y,-center.z);
      group.traverse(o=>{if(o.material)o.material.side=THREE.DoubleSide;}); scene.add(group);
      renderer.clear(); renderer.render(scene,camera);
      const pixels = new Uint8Array(512*256*4); renderer.readRenderTargetPixels(target,0,0,512,256,pixels);
      const canvas = document.createElement('canvas'); canvas.width=512;canvas.height=256;
      const ctx = canvas.getContext('2d'), image=ctx.createImageData(512,256);
      for(let y=0;y<256;y++) image.data.set(pixels.subarray((255-y)*512*4,(256-y)*512*4),y*512*4);
      ctx.putImageData(image,0,0); images.set(stage,canvas);
      scene.remove(group);group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
    }
  } finally { renderer.setRenderTarget(previousTarget);renderer.setClearColor(clearColor,clearAlpha);target.dispose(); }
  return images;
}

export class RaceCues {
  static async create(renderer) {
    const names = [['3','go3'],['2','go2'],['1','go1'],['GO!','gogo']];
    const [models, atlasBuffer] = await Promise.all([
      Promise.all(names.map(async ([stage,name])=>[stage,parsePrm(await (await fetch(gameAssetUrl(`/models/${name}.m`))).arrayBuffer())])),
      fetch(gameAssetUrl('/gfx/fxpage2.bmp')).then(r=>r.arrayBuffer()),
    ]);
    const texture=decodeBitmap(atlasBuffer), atlas=document.createElement('canvas');atlas.width=atlas.height=256;
    atlas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(texture.image.data),256,256),0,0);texture.dispose();
    return new RaceCues(rasterizeCountdown(renderer,models),atlas);
  }
  constructor(images,atlas) {
    this.images=images;this.atlas=atlas;
    this.element=document.createElement('div');this.element.className='hud race-cues';this.element.hidden=true;
    this.canvas=document.createElement('canvas');this.canvas.width=512;this.canvas.height=256;
    this.canvas.setAttribute('role','img');this.element.append(this.canvas);document.querySelector('#game').append(this.element);
    this.context=this.canvas.getContext('2d');this.last=null;
  }
  update(stage,direction) {
    const key=stage??(direction?`turn-${direction.type}`:null);
    if(key===this.last)return;this.last=key;
    this.element.hidden=key===null;if(key===null)return;
    this.context.clearRect(0,0,512,256);
    this.element.dataset.kind=stage?'countdown':'turn';this.element.dataset.cue=key;
    if(stage){this.context.drawImage(this.images.get(stage),0,0);this.canvas.setAttribute('aria-label',stage==='GO!'?'Go!':`Starting in ${stage}`);return;}
    const sprite=DIRECTION_SPRITES[direction.type];
    if(!sprite){this.element.hidden=true;return;}
    const [x,y,mirror,label]=sprite;this.context.save();this.context.translate(256,0);this.context.scale(mirror?-1:1,1);
    this.context.drawImage(this.atlas,x,y,64,64,-128,0,256,256);this.context.restore();this.canvas.setAttribute('aria-label',label);
  }
  hide(){this.update(null,null);}
}
