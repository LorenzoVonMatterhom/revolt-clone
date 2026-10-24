import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShowroomNavigation } from '../src/showroom-navigation.js';
test('WASD follows mouse heading, stays level, and normalizes diagonal movement', () => {
  const camera = new THREE.PerspectiveCamera(); camera.position.y = 20;
  const controls = new ShowroomNavigation(camera);
  controls.update(.05, new Map([['KeyW', true]]));
  assert.ok(camera.position.z < 0); assert.equal(camera.position.y, 20);
  camera.position.set(0,20,0);
  controls.update(.05, new Map([['KeyW',true],['KeyD',true]]));
  assert.ok(Math.abs(Math.hypot(camera.position.x,camera.position.z)-3.25)<1e-6);
  controls.look(500,10000);
  const pitch = new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ').x;
  assert.ok(Math.abs(pitch)<=1.45001);
  camera.position.set(0,20,0); controls.update(.05,new Map([['KeyW',true]]));
  assert.ok(camera.position.x>3); assert.equal(camera.position.y,20);
  const before=camera.position.clone();controls.update(.05,new Map());assert.ok(camera.position.equals(before));
});
