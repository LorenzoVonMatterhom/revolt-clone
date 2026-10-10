import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

let initialization;
export function keyboardSteering(left, right) {
  // Looking forward along +Z, +X is left on the chase camera.
  return Number(left) - Number(right);
}

export function initializePhysics() {
  return initialization ??= RAPIER.init();
}

export function meshTriangles(group) {
  group = group.userData.collisionGroup ?? group;
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse((object) => {
    if (!object.isMesh) return;
    for (let parent = object; parent; parent = parent.parent) {
      if (parent.userData.noCollision) return;
    }
    meshes.push(object);
  });
  const vertexCount = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
  const indexCount = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count), 0);
  const vertices = new Float32Array(vertexCount * 3), indices = new Uint32Array(indexCount);
  const vertex = new THREE.Vector3();
  let vertexOffset = 0, indexOffset = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      vertex.toArray(vertices, (vertexOffset + i) * 3);
    }
    for (let i = 0; i < (index?.count ?? position.count); i++) indices[indexOffset++] = vertexOffset + (index ? index.getX(i) : i);
    vertexOffset += position.count;
  }
  return { vertices, indices };
}

// Chassis contacts all terrain; tires contact steep obstacle faces, not the road.
const CHASSIS_GROUPS = (1 << 16) | 3;
const TERRAIN_GROUPS = (1 << 16) | 1;
const TIRE_GROUPS = (2 << 16) | 3;
const OBSTACLE_GROUPS = (2 << 16) | 2;

export class MeshPhysics {
  constructor(group, water = null) {
    this.water = water;
    this.world = new RAPIER.World({ x: 0, y: -42, z: 0 });
    this.world.timestep = 1 / 120;
    this.world.integrationParameters.numSolverIterations = 8;
    this.world.integrationParameters.maxCcdSubsteps = 4;
    const { vertices, indices } = meshTriangles(group);
    this.triangleCount = indices.length / 3;
    this.bounds = new THREE.Box3().setFromArray(vertices);
    // One welded trimesh avoids false collisions at material/texture boundaries.
    this.terrain = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES | RAPIER.TriMeshFlags.ORIENTED).setFriction(0.8).setRestitution(0).setCollisionGroups(TERRAIN_GROUPS));
    const obstacleIndices = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < indices.length; i += 3) {
      a.fromArray(vertices, indices[i] * 3);
      b.fromArray(vertices, indices[i + 1] * 3).sub(a);
      c.fromArray(vertices, indices[i + 2] * 3).sub(a);
      const normal = b.cross(c).normalize();
      if (Math.abs(normal.y) < 0.65) obstacleIndices.push(indices[i], indices[i + 1], indices[i + 2]);
    }
    this.wheelObstacles = obstacleIndices.length ? this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, new Uint32Array(obstacleIndices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES)
        .setFriction(0.05).setRestitution(0).setCollisionGroups(OBSTACLE_GROUPS)
    ) : null;
    this.world.step();
  }

  groundAt(position, above = 1, below = 20) {
    const ray = new RAPIER.Ray({ x: position.x, y: position.y + above, z: position.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(ray, above + below, false, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    return hit && hit.normal.y > 0.15 ? position.y + above - hit.timeOfImpact : null;
  }

  createCar(mesh) {
    const setup = mesh.userData.physics;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setSoftCcdPrediction(0.5).setLinearDamping(0.15).setAngularDamping(1.5));
    const { halfExtents: size, center } = setup;
    const hull = setup.bodyVertices?.length >= 12 ? RAPIER.ColliderDesc.convexHull(setup.bodyVertices) : null;
    const shapeOffset = hull ? new THREE.Vector3() : center.clone();
    const descriptor = hull ?? RAPIER.ColliderDesc.cuboid(size.x, size.y, size.z).setTranslation(center.x, center.y, center.z);
    const collider = this.world.createCollider(descriptor.setMass(8).setFriction(0.3).setRestitution(0.02).setContactSkin(0.02).setCollisionGroups(CHASSIS_GROUPS), body);
    const vehicle = this.world.createVehicleController(body);
    vehicle.indexUpAxis = 1;
    vehicle.setIndexForwardAxis = 2;
    for (const wheel of setup.wheels) {
      const connection = { x: wheel.position.x, y: wheel.position.y + 0.6, z: wheel.position.z };
      vehicle.addWheel(connection, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.6, wheel.radius);
      const i = vehicle.numWheels() - 1;
      vehicle.setWheelSuspensionStiffness(i, 70);
      vehicle.setWheelSuspensionCompression(i, 12);
      vehicle.setWheelSuspensionRelaxation(i, 12);
      vehicle.setWheelMaxSuspensionTravel(i, 0.5);
      vehicle.setWheelMaxSuspensionForce(i, 2000);
      vehicle.setWheelFrictionSlip(i, 2.5);
      vehicle.setWheelSideFrictionStiffness(i, 1);
    }
    // Suspension rays provide grip; rounded tire shapes prevent side walls and
    // object edges from entering wheels outside the narrower chassis hull.
    const wheelColliders = setup.wheels.map((wheel) => {
      const radius = wheel.radius * 0.92;
      const halfWidth = wheel.halfWidth ?? wheel.radius * 0.35;
      const tire = RAPIER.ColliderDesc.roundCylinder(halfWidth, radius, Math.min(0.05, radius * 0.1))
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2))
        .setTranslation(wheel.position.x, wheel.position.y, wheel.position.z)
        .setMass(0).setFriction(0.05).setRestitution(0).setContactSkin(0.01).setCollisionGroups(TIRE_GROUPS);
      return this.world.createCollider(tire, body);
    });
    return { body, vehicle, setup, collider, wheelColliders, shapeOffset, safePose: null, embeddedTime: 0, blockedTime: 0, stackedTime: 0, driveIntent: false };
  }

  overlapsCar(car, position, rotation) {
    const center = car.shapeOffset.clone().applyQuaternion(rotation).add(position);
    const bodyCenter = car.setup.center.clone().applyQuaternion(rotation).add(position);
    if (this.terrain.projectPoint(bodyCenter, true).isInside) return true;
    const size=car.setup.halfExtents;
    const bottom=position.y-1,top=bodyCenter.y+size.y+0.05;
    const clearanceCenter=new THREE.Vector3(bodyCenter.x,(bottom+top)/2,bodyCenter.z);
    const clearanceShape=new RAPIER.Cuboid(size.x+0.4,(top-bottom)/2,size.z+0.4);
    if(this.world.intersectionWithShape(clearanceCenter,rotation,clearanceShape,RAPIER.QueryFilterFlags.EXCLUDE_FIXED|RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC|RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,car.collider,car.body)) return true;
    if (this.world.intersectionWithShape(center, rotation, car.collider.shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, car.collider, car.body)) return true;
    return car.wheelColliders.some((tire) => {
      const local = new THREE.Vector3().copy(tire.translationWrtParent());
      const tireCenter = local.applyQuaternion(rotation).add(position);
      const tireRotation = new THREE.Quaternion().copy(rotation).multiply(new THREE.Quaternion().copy(tire.rotationWrtParent()));
      return Boolean(this.world.intersectionWithShape(tireCenter, tireRotation, tire.shape,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, TIRE_GROUPS, tire, car.body));
    });
  }

  placeCar(car, requested, rotation) {
    const spacing = Math.max(4, car.setup.halfExtents.x * 2 + 1);
    const offsets = [new THREE.Vector3()];
    for (let ring = 1; ring <= 6; ring++) for (let i = 0; i < 8; i++) offsets.push(new THREE.Vector3(Math.sin(i * Math.PI / 4) * spacing * ring, 0, Math.cos(i * Math.PI / 4) * spacing * ring));
    for (const offset of offsets) {
      const position = requested.clone().add(offset);
      const floor = this.groundAt(position, 3, 40);
      if (floor === null) continue;
      const clearance = Math.max(0.8, car.setup.halfExtents.y - car.setup.center.y + 0.15);
      for (const lift of [0, 0.5, 1]) {
        position.y = floor + clearance + lift;
        if (this.overlapsCar(car, position, rotation)) continue;
        car.body.setTranslation(position, true); car.body.setRotation(rotation, true);
        car.body.setLinvel({ x: 0, y: 0, z: 0 }, true); car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.world.propagateModifiedBodyPositionsToColliders();
        car.safePose = { position: position.clone(), rotation: new THREE.Quaternion().copy(rotation) };
        car.embeddedTime = 0; car.blockedTime = 0; car.stackedTime=0;
        return true;
      }
    }
    return false;
  }

  parkCar(car) {
    const position=new THREE.Vector3().copy(car.body.translation()),rotation=new THREE.Quaternion().copy(car.body.rotation());
    const side=new THREE.Vector3(1,0,0).applyQuaternion(rotation);side.y=0;side.normalize();
    for(const distance of [24,-24,36,-36]) {
      if(this.placeCar(car,position.clone().addScaledVector(side,distance),rotation)) return true;
    }
    return false;
  }

  checkCar(car, dt, cars = []) {
    const position = new THREE.Vector3().copy(car.body.translation());
    const rotation = new THREE.Quaternion().copy(car.body.rotation());
    const velocity = car.body.linvel();
    if (![...position.toArray(), ...rotation.toArray(), velocity.x, velocity.y, velocity.z].every(Number.isFinite)) {
      if (car.safePose) this.placeCar(car, car.safePose.position, car.safePose.rotation);
      return;
    }
    const contacts = [
      car.collider.contactCollider(this.terrain, 0),
      ...(this.wheelObstacles ? car.wheelColliders.map((tire) => tire.contactCollider(this.wheelObstacles, 0)) : []),
    ].filter(Boolean);
    const contact = contacts.find((hit) => hit.distance < -0.2) ?? contacts[0];
    const obstacleContact = contacts.some((hit) => Math.abs(hit.normal1.y) < 0.65);
    const upright = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).y;
    const stationary = Math.hypot(velocity.x, velocity.z) < 2;
    car.blockedTime = stationary && (upright < 0.25 || (car.driveIntent && obstacleContact)) ? car.blockedTime + dt : 0;
    const stacked=cars.some(other=>{
      if(other===car||position.y-other.body.translation().y<1) return false;
      const support=car.collider.contactCollider(other.collider,0.03);
      return support&&support.distance<0.03&&support.normal1.y< -0.5;
    });
    car.stackedTime=stacked?car.stackedTime+dt:0;
    const bodyCenter = car.setup.center.clone().applyQuaternion(rotation).add(position);
    const deeplyEmbedded = (contact && contact.distance < -0.2) || this.terrain.projectPoint(bodyCenter, true).isInside;
    car.embeddedTime = deeplyEmbedded ? car.embeddedTime + dt : 0;
    if ((car.embeddedTime > 0.35 || car.blockedTime > 1.5 || car.stackedTime>0.75) && car.safePose) {
      this.placeCar(car, car.safePose.position, car.safePose.rotation);
      return;
    }
    // Keep a previously clear resting pose, not the latest position pressed into a wall.
    if (!car.collider.contactCollider(this.terrain, 0) && !obstacleContact && !deeplyEmbedded && upright > 0.7 && Math.hypot(velocity.x, velocity.z) > 2 && car.vehicle.numWheels() > 0 && Array.from({ length: car.vehicle.numWheels() }, (_, i) => car.vehicle.wheelIsInContact(i)).filter(Boolean).length >= 2) {
      car.safePose = { position, rotation };
    }
  }

  updateVehicle(car, dt, throttle, brake, steering, handbrake, traction = 1, steeringGain = 1) {
    const waterFraction = this.water?.applyCar(car, dt) ?? 0;
    car.driveIntent = Math.abs(throttle) > 0.1;
    const slippery = traction < 1;
    car.body.setAngularDamping(slippery ? 0.12 : 1.5);
    car.collider?.setFriction(slippery ? 0.015 : 0.3);
    const totalDriveRatio=car.setup.wheels.reduce((sum,wheel)=>sum+((wheel.powered??true)?(wheel.engineRatio??1):0),0);
    for (let i = 0; i < car.vehicle.numWheels(); i++) {
      const front = car.setup.wheels[i].position.z > 0;
      const wheel = car.setup.wheels[i];
      // Give player cars usable lock even when stock ratios are small (Cougar: 0.25).
      const steerRatio = steeringGain > 1 ? Math.max(0.45, wheel.steerRatio ?? 0.45) : (wheel.steerRatio ?? 0.45);
      const steeringLimit = steeringGain > 1 ? 1.05 : 0.8;
      car.vehicle.setWheelSteering(i, (wheel.turnable ?? front) ? THREE.MathUtils.clamp(steering * steerRatio * steeringGain, -steeringLimit, steeringLimit) : 0);
      car.vehicle.setWheelEngineForce(i, (wheel.powered ?? true) ? throttle * 360 * (1 - 0.65 * waterFraction) * (wheel.engineRatio??1) / Math.max(1,totalDriveRatio) : 0);
      car.vehicle.setWheelBrake(i, brake * 18 + (handbrake && !front ? 30 : 0));
      car.vehicle.setWheelFrictionSlip(i, (handbrake && !front ? 0.7 : 2.5) * traction * (1 - 0.6 * waterFraction));
      car.vehicle.setWheelSideFrictionStiffness(i, traction);
    }
    car.vehicle.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    car.wheelColliders.forEach((tire, i) => {
      const wheel = car.setup.wheels[i];
      const suspension = car.vehicle.wheelSuspensionLength(i) ?? 0.6;
      tire.setTranslationWrtParent({ x: wheel.position.x, y: wheel.position.y + 0.6 - suspension, z: wheel.position.z });
      const steeringRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.vehicle.wheelSteering(i) ?? 0);
      tire.setRotationWrtParent(steeringRotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)));
    });
  }

  step() { this.world.step(); }
  dispose() { this.world.free(); }
}
