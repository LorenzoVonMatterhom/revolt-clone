import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {RaceCountdown,DIRECTION_SPRITES} from '../src/race-cues.js';
import {parseDirectionTriggers,directionIntersection,TurnGuide} from '../src/track-directions.js';
import {parseInfo} from '../src/revolt.js';
import {LEVELS} from '../src/levels.js';
const buffer=path=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};

test('countdown holds the timer until GO, emits each cue once and resets for a new race',()=>{
 const cues=[],countdown=new RaceCountdown(cue=>cues.push(cue));countdown.start();
 for(let second=0;second<3;second++){
  assert.equal(countdown.stage,String(3-second));assert.equal(countdown.locked,true);
  for(let i=0;i<8;i++)assert.ok(countdown.update(.125)<.00001);
 }
 assert.equal(countdown.stage,'GO!');assert.equal(countdown.locked,false);
 assert.ok(Math.abs(countdown.update(.25)-.25)<.00001);
 countdown.update(1);assert.equal(countdown.stage,null);
 assert.deepEqual(cues,['3','2','1','GO!']);
 countdown.reset();assert.equal(countdown.stage,null);assert.equal(countdown.locked,false);
 countdown.start();assert.equal(countdown.stage,'3');assert.equal(countdown.locked,true);
});

test('the GO transition counts only elapsed time after release and a paused countdown stays held',()=>{
 const countdown=new RaceCountdown();countdown.start();countdown.update(2.9);
 assert.equal(countdown.update(0),0);assert.equal(countdown.locked,true);
 assert.ok(Math.abs(countdown.update(.2)-.1)<1e-8);
});

for(const {id} of LEVELS.filter(level=>level.kind==='race'&&level.id!=='stunts'))test(`${id}: authored TRI direction regions load and display valid stock sprites`,()=>{
 const base=`levels/${id}/${id}`,info=parseInfo(readFileSync(base+'.inf','utf8'));
 const triggers=parseDirectionTriggers(buffer(base+'.tri'),info.STARTPOS);
 assert.ok(triggers.length>0);
 for(const t of triggers){
  assert.ok(t.type===11||DIRECTION_SPRITES[t.type],`Unknown direction ${t.type}`);
  assert.equal(directionIntersection(t,t.position,t.position),0);
  const outside=t.position.clone().add(new THREE.Vector3(100000,0,0));
  assert.equal(directionIntersection(t,outside,outside),null);
  let sounds=0;const guide=new TurnGuide([t],()=>sounds++);
  const cue=guide.update(.01,t.position);
  assert.equal(cue?.type,t.type===11?undefined:t.type);
  for(let i=0;i<20;i++)guide.update(.01,t.position);
  assert.equal(sounds,t.type===11?0:1,'Do not replay a sound every frame inside a trigger');
  assert.equal(guide.update(3,t.position),null);
 }
});

test('a fast car crossing a thin, rotated direction region gets its cue without stopping inside it',()=>{
 const theta=Math.PI/4,rotation=new THREE.Matrix4().makeRotationY(theta);
 const t={id:0,type:6,position:new THREE.Vector3(),inverse:rotation.clone().invert(),halfExtents:new THREE.Vector3(.5,10,10)};
 const a=new THREE.Vector3(-20,0,0).applyMatrix4(rotation),b=new THREE.Vector3(20,0,0).applyMatrix4(rotation);
 const guide=new TurnGuide([t]);assert.equal(guide.update(.01,a),null);
 assert.equal(guide.update(.01,b).type,6);
});
