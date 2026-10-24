import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SkidMarks, isSkidding } from "../src/skid-marks.js";

test("skids require actual sliding or handbrake, and never trigger in the air", () => {
  const moving = { speed: 20, lateralSpeed: 5, steer: 0.8, handbrake: false, airborne: false };
  assert.ok(isSkidding(moving));
  assert.ok(!isSkidding({ ...moving, airborne: true }));
  assert.ok(!isSkidding({ ...moving, lateralSpeed: 0 }));
  assert.ok(isSkidding({ ...moving, lateralSpeed: 0, handbrake: true }));
});

test("skid ribbons follow wheel contact normals and reject teleport streaks", () => {
  const marks = new SkidMarks(new THREE.Scene());
  const normal = new THREE.Vector3(0, 1, -1).normalize();
  assert.ok(marks.segment(new THREE.Vector3(), new THREE.Vector3(0, 1, 1), normal, 0.5));
  for (let i = 0; i < 6; i++) {
    const point = new THREE.Vector3().fromArray(marks.positions, i * 3);
    assert.ok(Math.abs(point.dot(normal) - 0.025) < 0.00001);
  }
  assert.ok(!marks.segment(new THREE.Vector3(), new THREE.Vector3(100, 0, 0), normal, 0.5));
  assert.equal(marks.count, 1);
  marks.dispose();
});

test("only grounded wheels leave trails, even when sound is muted", () => {
  const marks = new SkidMarks(new THREE.Scene());
  let z = 0, contact = true;
  const racer = { sliding: true, car: { setup: { wheels: [{radius:1}] }, vehicle: {
    numWheels: () => 1, wheelIsInContact: () => contact,
    wheelContactPoint: () => ({x:0,y:0,z}), wheelContactNormal: () => ({x:0,y:1,z:0}),
  } } };
  marks.track(racer); z=1; marks.track(racer);
  assert.equal(marks.count,1);
  contact=false; z=2; marks.track(racer);
  contact=true; z=3; marks.track(racer);
  assert.equal(marks.count,1,"Must not connect a trail across an airborne gap");
  z=4; marks.track(racer); assert.equal(marks.count,2);
  marks.dispose();
});

test("skids use bounded geometry, fade and clear on race reset", () => {
  const marks=new SkidMarks(new THREE.Scene(),2);
  for(let i=0;i<3;i++) marks.segment(new THREE.Vector3(i,0,0),new THREE.Vector3(i+1,0,0),new THREE.Vector3(0,1,0),0.5);
  assert.equal(marks.count,2); assert.equal(marks.geometry.drawRange.count,12);
  marks.update(40); assert.equal(marks.colors[3],0);
  marks.clear(); assert.equal(marks.count,0); assert.equal(marks.geometry.drawRange.count,0);
  marks.dispose();
});

test("only oil-coated grounded wheels leave dark tracks during low friction even driving straight", () => {
  const marks=new SkidMarks(new THREE.Scene()); let z=0, contact=true;
  const racer={sliding:false,powerups:{slippery:4,oilWheels:[4,0]},car:{setup:{wheels:[{radius:1},{radius:1}]},vehicle:{
    numWheels:()=>2,wheelIsInContact:()=>contact,
    wheelContactPoint:i=>({x:i*4,y:0,z}),wheelContactNormal:()=>({x:0,y:1,z:0}),
  }}};
  try {
    marks.track(racer);z=1;marks.track(racer);assert.equal(marks.count,1);
    assert.ok(marks.colors[3]>.85);
    contact=false;z=2;marks.track(racer);contact=true;z=3;marks.track(racer);assert.equal(marks.count,1);
    z=4;marks.track(racer);assert.equal(marks.count,2);
    racer.powerups.slippery=0;z=5;marks.track(racer);assert.equal(marks.count,2);
    marks.update(40);assert.equal(marks.colors[3],0);
  } finally {marks.dispose();}
});
