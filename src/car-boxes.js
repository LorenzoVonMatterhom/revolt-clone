import * as THREE from "three";

// Native Re-Volt car IDs used by the 28 type-46 entries in frontend.fob.
// This is independent of the menu's selection order.
export const ORIGINAL_BOX_CARS = [
  'rc','mite','phat','moss','mud','beatall','volken','tc6','dino',
  'candy','gencar','tc4','mouse','flag','tc2','r5','tc5','sgt',
  'tc3','adeon','fone','tc1','rotor','cougar','sugo','toyeca','amw','panga',
];

export function originalBoxPlacements(objects) {
  const placements=new Map();
  for(const object of objects) {
    if(object.type!==46)continue;
    const boxId=object.flags[0],id=ORIGINAL_BOX_CARS[boxId];
    if(!id)continue; // The negative ID is a separate, non-car display object.
    const up=new THREE.Vector3(-object.up[0],object.up[1],-object.up[2]).normalize();
    const forward=new THREE.Vector3(object.forward[0],-object.forward[1],object.forward[2]).normalize();
    const right=up.clone().cross(forward).normalize();forward.crossVectors(right,up).normalize();
    const quaternion=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,forward));
    placements.set(id,{boxId,position:object.position.clone(),quaternion});
  }
  return placements;
}

export function originalBoxArtwork(id) {
  const nativeId=ORIGINAL_BOX_CARS.indexOf(id);
  if(nativeId<0)throw new Error(`No original box artwork for ${id}`);
  // RVGL preserves the first 27 stock tiles. Panga is tile 5 on the fifth
  // sheet, after the Dreamcast cars, rather than the first Dreamcast tile.
  const tile=id==='panga'?41:nativeId;
  return {page:Math.floor(tile/9)+1,column:tile%3,row:Math.floor(tile%9/3)};
}

export function originalBoxModel(source,id) {
  const model=structuredClone(source),{column,row}=originalBoxArtwork(id);
  // Only the small white picture panel on the ORIGINAL front receives the
  // appropriate original atlas tile. The back, frame, sides and top stay intact.
  const x0=(column*85+.5)/256,x1=(column*85+84.5)/256;
  const y0=(row*85+.5)/256,y1=(row*85+84.5)/256;
  model.polygons[1].texture=7;
  model.polygons[1].uv=[[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
  return model;
}
