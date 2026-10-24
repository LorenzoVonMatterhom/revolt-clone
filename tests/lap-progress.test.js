import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { makeLapGates, LapProgress } from "../src/lap-progress.js";
import { makeRaceRoute } from "../src/race-ai.js";
import { parseAiPositions, parseInfo } from "../src/revolt.js";
import { LEVELS } from "../src/levels.js";

const points = [[10,0,0],[200,0,0],[200,0,200],[-200,0,200],[-200,0,0]].map(p=>new THREE.Vector3(...p));
const forward = new THREE.Vector3(1,0,0);
const route = makeRaceRoute(points);
function travel(tracker, curve, from=0, to=1, lane=0, steps=2000) {
  for(let i=0;i<=steps;i++) {
    const t=from+(to-from)*i/steps;
    const u=((t%1)+1)%1;
    const position=curve.getPointAt(u);
    const tangent=curve.getTangentAt(u);
    const side=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
    tracker.update(position.addScaledVector(side,lane).add(new THREE.Vector3(0,2,0)));
  }
}

test("complete forward laps advance 1/3 through 3/3 and finish once", () => {
  const tracker=new LapProgress(makeLapGates(points,forward,{halfWidth:80}));
  for(let lap=1;lap<=3;lap++){travel(tracker,route);assert.equal(tracker.lap,lap+1);}
  assert.equal(tracker.finished,true);
  travel(tracker,route);assert.equal(tracker.lap,4);
});

test("different driving lines count without touching the route center", () => {
  for(const lane of [-40,40]) {
    const tracker=new LapProgress(makeLapGates(points,forward,{halfWidth:80}));
    travel(tracker,route,0,1,lane);
    assert.equal(tracker.lap,2,`Lane ${lane} failed to count`);
  }
});

test("backwards travel and start-line oscillation cannot award laps", () => {
  const tracker=new LapProgress(makeLapGates(points,forward,{halfWidth:80}));
  travel(tracker,route,1,0);
  for(let i=0;i<10;i++){tracker.update(new THREE.Vector3(-2,0,0));tracker.update(new THREE.Vector3(2,0,0));}
  assert.equal(tracker.lap,1);
});

test("manual repositioning preserves earned checkpoints and cannot award a lap", () => {
  const tracker=new LapProgress(makeLapGates(points,forward,{halfWidth:80}));
  travel(tracker,route,0,0.55);
  const next=tracker.nextCheckpoint;assert.ok(next>1);
  tracker.relocate(route.getPointAt(0.53));
  assert.equal(tracker.nextCheckpoint,next);
  travel(tracker,route,0.53,1);assert.equal(tracker.lap,2);
  tracker.relocate(new THREE.Vector3(-2,0,0));tracker.relocate(new THREE.Vector3(2,0,0));
  assert.equal(tracker.lap,2);
});

test("a position jump cannot skip the route and count a lap", () => {
  const tracker=new LapProgress(makeLapGates(points,forward,{halfWidth:80}));
  tracker.update(new THREE.Vector3(-2,0,0));
  tracker.update(new THREE.Vector3(200,0,200));
  tracker.update(new THREE.Vector3(2,0,0));
  assert.equal(tracker.lap,1);
});

test("skipping an ordered gate cannot turn a finish crossing into a lap", () => {
  const tracker = new LapProgress(makeLapGates(points, forward));
  travel(tracker, route, 0, .4);
  tracker.relocate(new THREE.Vector3(-2, 2, 0));
  tracker.update(new THREE.Vector3(2, 2, 0));
  assert.equal(tracker.lap, 1);
});

test("the finish must be crossed forwards on the correct level", () => {
  const tracker = new LapProgress(makeLapGates(points, forward));
  travel(tracker, route, 0, .95);
  assert.equal(tracker.nextCheckpoint, 0);
  tracker.relocate(new THREE.Vector3(-2, 100, 0));
  tracker.update(new THREE.Vector3(2, 100, 0));
  assert.equal(tracker.lap, 1);
  tracker.relocate(new THREE.Vector3(2, 2, 0));
  tracker.update(new THREE.Vector3(-2, 2, 0));
  assert.equal(tracker.lap, 1);
  tracker.update(new THREE.Vector3(2, 2, 0));
  assert.equal(tracker.lap, 2);
});

test("a new race clears completed laps and uses the new track gates", () => {
  const tracker = new LapProgress(makeLapGates(points, forward));
  travel(tracker, route);
  tracker.reset(makeLapGates(points, forward), route.getPointAt(0));
  assert.equal(tracker.lap, 1);
  assert.equal(tracker.nextCheckpoint, 1);
  assert.equal(tracker.finished, false);
  travel(tracker, route);
  assert.equal(tracker.lap, 2);
});

for(const definition of LEVELS.filter(level=>level.kind==='race'&&level.id!=='stunts')) {
  test(`${definition.id}: original driving line completes three player laps`, () => {
    const base=`levels/${definition.id}/${definition.id}`;
    const info=parseInfo(readFileSync(base+'.inf','utf8'));
    const bytes=readFileSync(base+'.fan');
    const path=parseAiPositions(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),info.STARTPOS);
    const heading=info.STARTROT[0]*Math.PI*2;
    const normal=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
    const tracker=new LapProgress(makeLapGates(path,normal));
    const curve=makeRaceRoute(path);
    let phase=0,best=Infinity;
    for(let i=1;i<=4000;i++) {
      const a=curve.getPointAt((i-1)/4000),b=curve.getPointAt(i/4000),from=a.dot(normal),to=b.dot(normal);
      if(from>=0||to<0)continue;
      const t=from/(from-to),p=a.clone().lerp(b,t),distance=Math.hypot(p.x,p.z);
      if(distance<best&&Math.abs(p.y)<80){best=distance;phase=(i-1+t)/4000;}
    }
    assert.ok(best<120,'Authored driving route must cross the finish corridor');
    for(let lap=1;lap<=3;lap++){travel(tracker,curve,phase+.0001,phase+1.0001);assert.equal(tracker.lap,lap+1,`Failed player lap ${lap}, next gate ${tracker.nextCheckpoint}`);}
    assert.equal(tracker.finished,true);
    for (const lane of [-12, 12]) {
      const offsetTracker = new LapProgress(makeLapGates(path, normal));
      travel(offsetTracker, curve, phase - .01, phase + 1.01, lane);
      assert.equal(offsetTracker.lap, 2, `Driving line offset ${lane} must still count, next gate ${offsetTracker.nextCheckpoint}`);
    }
  });
}

 test("race position compares all cars using earned gates and forward progress", () => {
  const gates = makeLapGates(points, forward);
  const leader = new LapProgress(gates), follower = new LapProgress(gates);
  travel(leader, route, 0, .4); travel(follower, route, 0, .2);
  assert.ok(leader.score(route.getPointAt(.4)) > follower.score(route.getPointAt(.2)));
  travel(follower, route, .2, .6);
  assert.ok(follower.score(route.getPointAt(.6)) > leader.score(route.getPointAt(.4)));
  travel(leader, route, .4, 1);
  assert.ok(leader.score(route.getPointAt(0)) > follower.score(route.getPointAt(.6)));
});
