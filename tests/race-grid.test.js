import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import * as THREE from 'three';
import {OPPONENTS,makeStartingGrid,placeStartingGrid} from '../src/race-grid.js';
import {loadCar,loadLevel,disposeLevel} from '../src/revolt.js';
import {initializePhysics,MeshPhysics} from '../src/physics.js';
import {makeLapGates,LapProgress} from '../src/lap-progress.js';
import {LEVELS} from '../src/levels.js';
await initializePhysics();
const manifest=readdirSync('levels',{recursive:true}).map(p=>'/levels/'+p.replaceAll('\\','/'));

test('seven opponents occupy a staggered two-column, four-row grid with the player eighth',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
 let meshes=[];
 try{
  assert.equal(OPPONENTS.length,7);assert.equal(new Set(OPPONENTS.map(o=>o.id)).size,7);
  meshes=await Promise.all(['rc',...OPPONENTS.map(o=>o.id)].map(id=>loadCar(id,id)));
  const slots=makeStartingGrid(meshes.map(m=>m.userData.physics));
  assert.equal(slots[0].rank,7);assert.equal(slots[0].row,3);
  for(let row=0;row<4;row++)assert.equal(slots.filter(s=>s.row===row).length,2);
  assert.ok(slots.slice(1).every(s=>s.behind<slots[0].behind));
 }finally{globalThis.fetch=saved;meshes.forEach(m=>m.traverse(o=>{o.geometry?.dispose();o.material?.dispose();}));}
});

for(const definition of LEVELS)test(`${definition.id}: grid fits original terrain, stays clear and resets back to the same slots`,async()=>{
 const saved=globalThis.fetch;globalThis.fetch=async url=>new Response(readFileSync(String(url).slice(1)));
 let meshes=[],level,physics;
 try{
  meshes=await Promise.all(['rc',...OPPONENTS.map(o=>o.id)].map(id=>loadCar(id,id)));
  level=await loadLevel(definition,manifest);physics=new MeshPhysics(level.group);
  const cars=meshes.map(mesh=>physics.createCar(mesh)),heading=level.info.STARTROT[0]*Math.PI*2;
  const forward=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
  const right=new THREE.Vector3(forward.z,0,-forward.x);
  const gates=makeLapGates(level.aiPath,forward,{corridor:level.aiTrack,nodes:level.aiNodes,includeSidewalks:/^nhood[12]$/.test(definition.id)});
  for(let restart=0;restart<2;restart++){
   if(restart){cars.forEach(car=>car.body.setTranslation({x:0,y:0,z:0},true));physics.world.propagateModifiedBodyPositionsToColliders();}
   const slots=placeStartingGrid(physics,cars,heading);
   const scores=[];
   cars.forEach((car,i)=>{
    const position=new THREE.Vector3().copy(car.body.translation());
    assert.ok(Math.abs(position.dot(forward)+slots[i].behind)<.05,'Keep the requested row');
    assert.ok(Math.abs(position.dot(right)-slots[i].lateral)<.05,'Keep the requested column');
    assert.equal(physics.overlapsCar(car,position,new THREE.Quaternion().copy(car.body.rotation())),false,'No terrain or car overlap');
    const tracker=new LapProgress(gates);tracker.reset(gates,position);scores.push(tracker.score(position));
   });
   if(gates.length)assert.ok(scores.slice(1).every(score=>score>scores[0]),`Player must rank eighth: ${scores}`);
  }
 }finally{globalThis.fetch=saved;physics?.dispose();if(level)disposeLevel(level);meshes.forEach(m=>m.traverse(o=>{o.geometry?.dispose();o.material?.dispose();}));}
});
