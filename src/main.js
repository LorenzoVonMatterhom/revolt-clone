import "./styles.css";
import "./touch-controls.css";
import { createTouchControls } from "./touch-controls.js";
import { gameAssetUrl } from "./assets.js";
import * as THREE from "three";
import { installAudioLifecycle } from "./audio-lifecycle.js";
import { LEVELS } from "./levels.js";
import { loadLevel, loadCar, disposeLevel, RV_SCALE } from "./revolt.js";
import { initializePhysics, MeshPhysics, keyboardSteering, smoothPlayerSteering } from "./physics.js";
import { CarEngineAudio, engineProfile, setWheelPose, CarResetFade } from "./car-effects.js";
import { Showroom } from "./showroom.js";
import { PowerupSystem, POWERUPS } from "./powerups.js";
import { RaceAI, makeRaceRoute, makeAiRoute, findAiRecovery } from "./race-ai.js";
import { makeLapGates, LapProgress } from "./lap-progress.js";
import { SkidMarks, isSkidding } from "./skid-marks.js";

const canvas = document.querySelector("#scene");
const mapCanvas = document.querySelector("#map");
const mapCtx = mapCanvas.getContext("2d");
const startOverlay = document.querySelector("#start");
const startBtn = document.querySelector("#startBtn");
const levelSelect = document.querySelector("#levelSelect");
const cameraBtn = document.querySelector("#cameraBtn");
const resetBtn = document.querySelector("#resetBtn");
const flipBtn = document.querySelector("#flipBtn");
const nextLevelBtn = document.querySelector("#nextLevelBtn");
const muteBtn = document.querySelector("#muteBtn");
const speedEl = document.querySelector("#speed");
const lapEl = document.querySelector("#lap");
const placeEl = document.querySelector("#place");
const timeEl = document.querySelector("#time");
const carSelect = document.querySelector("#carSelect");
const menuTrack = document.querySelector("#menuTrack");
const powerBtn = document.querySelector("#powerBtn");
const powerIcon = document.querySelector("#powerIcon");
const powerName = document.querySelector("#powerName");
const powerStatus = document.querySelector("#powerStatus");
const debugPowerup = document.querySelector("#debugPowerup");
const debugStatus = document.querySelector("#debugStatus");
document.querySelector("#debugToggle").addEventListener("click", event => {
  const collapsed = document.querySelector("#debugPanel").classList.toggle("is-collapsed");
  event.currentTarget.textContent = collapsed ? "Show" : "Hide";
  event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
});
let lastPowerIcon;
let powerups;
let powerAssets;
let skidMarks;
let resetFade;
let showroom;
let selectedCarId = "rc";
let playerCarId = "rc";

const TOTAL_LAPS = 3;
const PHYSICS_STEP = 1 / 120;
let physicsAccumulator = 0;
const tempVec = new THREE.Vector3();
const clock = new THREE.Clock();

const keys = new Map();
let raceStarted = false;
const touchControls = createTouchControls({ enabled: () => raceStarted && !levelLoading, onFire: () => powerups.fire(player, racers), onFlip: flipPlayer });
let cameraMode = 0;
let muted = false;
let elapsedRace = 0;
let currentLevelIndex = 0;
let currentLevel = LEVELS[currentLevelIndex];

const scene = new THREE.Scene();
scene.background = new THREE.Color(currentLevel.palette.sky);
scene.fog = new THREE.Fog(currentLevel.palette.fog, 72, 260);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 520);
camera.position.set(0, 18, -28);

const listener = new THREE.AudioListener();
camera.add(listener);
const audioLifecycle = installAudioLifecycle(listener, window, document, () => muted);
const audioLoader = new THREE.AudioLoader();
const engineBuffers = new Map();

const ASSETS = {
  "/wavs/hit1.wav": new URL("../wavs/hit1.wav", import.meta.url).href,
  "/wavs/pickup.wav": new URL("../wavs/pickup.wav", import.meta.url).href,
  "/wavs/skid_normal.wav": new URL("../wavs/skid_normal.wav", import.meta.url).href,
  "/wavs/turbo.wav": new URL("../wavs/turbo.wav", import.meta.url).href,
};

const assetUrl = (path) => ASSETS[path] ?? gameAssetUrl(path);

const sounds = {
  pickup: new THREE.Audio(listener),
  skid: new THREE.Audio(listener),
  hit: new THREE.Audio(listener),
  scrape: new THREE.Audio(listener),
  turbo: new THREE.Audio(listener),
  ambience: new THREE.Audio(listener),
  carSwitch: new THREE.Audio(listener),
  splash: new THREE.Audio(listener),
};

function loadSound(name, url, volume, loop = false) {
  audioLoader.load(assetUrl(url), (buffer) => {
    sounds[name].setBuffer(buffer);
    sounds[name].setVolume(volume);
    sounds[name].setLoop(loop);
  });
}

loadSound("pickup", "/wavs/pickup.wav", 0.36);
loadSound("skid", "/wavs/skid_normal.wav", 0.14, true);
loadSound("hit", "/wavs/hit1.wav", 0.25);
loadSound("scrape", "/wavs/scrape.wav", 0.2, true);
loadSound("turbo", "/wavs/turbo.wav", 0.18);
loadSound("carSwitch", "/wavs/menuleftright.wav", 0.4);
loadSound("splash", "/wavs/splash.wav", 0.35);

let carSwitchGeneration = 0;
function playCarSwitchSound() {
  const generation = ++carSwitchGeneration;
  const sound = sounds.carSwitch;
  if (muted || !sound.buffer) return;
  const play = () => {
    if (generation !== carSwitchGeneration || muted || raceStarted) return;
    if (sound.isPlaying) sound.stop();
    sound.play();
  };
  // Selection itself is a user gesture, so menu audio also works on phones.
  if (listener.context.state === "suspended") listener.context.resume().then(play).catch(console.warn);
  else if (listener.context.state === "running") play();
}

function loadAmbience(url) {
  if (sounds.ambience.isPlaying) sounds.ambience.stop();
  audioLoader.load(assetUrl(url), (buffer) => {
    sounds.ambience.setBuffer(buffer);
    sounds.ambience.setVolume(0.1);
    sounds.ambience.setLoop(true);
    if (raceStarted && !muted) sounds.ambience.play();
  });
}



const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-42, 74, -26);
sun.castShadow = true;
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xd9ecff, 0x516b43, 1.3));

const samples = 360;
let curve;
let centerline = [];
let tangents = [];
let normals = [];
let checkpoints = [];

let loadedLevel;
let levelLoading = true;
let loadGeneration = 0;
let physics;
const obstacleRay = new THREE.Raycaster();
obstacleRay.firstHitOnly = true;

async function buildLevel(level) {
  const generation = ++loadGeneration;
  levelLoading = true;
  raceStarted = false;
  startBtn.disabled = true;
  startBtn.textContent = "Loading map...";
  try {
    const loaded = await loadLevel(level, __REVOLT_FILES__);
    if (generation !== loadGeneration) { disposeLevel(loaded); return false; }
    powerups?.dispose([]);
    skidMarks?.dispose();
    if (loadedLevel) { scene.remove(loadedLevel.group); disposeLevel(loadedLevel); }
    loadedLevel = loaded;
    loaded.aiRoute = makeAiRoute(loaded.path, loaded.aiPath);
    currentLevel = level;
    scene.add(loaded.group);
    const rgb = loaded.info.FOGCOLOR ?? [128, 160, 192];
    scene.background = new THREE.Color().setRGB(...rgb.map((v) => v / 255), THREE.SRGBColorSpace);
    const far = (loaded.info.FARCLIP?.[0] ?? 24000) * RV_SCALE;
    scene.fog = new THREE.Fog(scene.background, (loaded.info.FOGSTART?.[0] ?? 20000) * RV_SCALE, far);
    camera.far = far;
    camera.updateProjectionMatrix();
    const path = loaded.path;
    if (path.length > 2) {
      curve = makeRaceRoute(path);
      centerline = Array.from({ length: samples }, (_, i) => curve.getPointAt(i / samples));
      tangents = Array.from({ length: samples }, (_, i) => curve.getTangentAt(i / samples).normalize());
      normals = tangents.map((t) => new THREE.Vector3(-t.z, 0, t.x).normalize());
      const heading = (loaded.info.STARTROT?.[0] ?? 0) * Math.PI * 2;
      checkpoints = makeLapGates(loaded.aiRoute, new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)), { corridor: loaded.aiTrack, nodes: loaded.aiNodes });
    } else {
      centerline = [];
      tangents = [];
      normals = [];
      checkpoints = [];
    }
    physics?.dispose();
    physics = new MeshPhysics(loaded.group, loaded.water);
    if (loaded.water) loaded.water.onSplash = () => {
      if (muted || !raceStarted || !sounds.splash.buffer) return;
      if (sounds.splash.isPlaying) sounds.splash.stop();
      sounds.splash.play();
    };
    skidMarks = new SkidMarks(scene);
    powerups = new PowerupSystem(scene, physics, loaded.group, loaded.objects, powerAssets, playPowerSound);

    window.revoltMap = { id: level.id, ...loaded.stats };
    loadAmbience(level.ambience);
    levelLoading = false;
    startBtn.disabled = false;
    startBtn.textContent = "Start Race";
    return true;
  } catch (error) {
    if (generation !== loadGeneration) return false;
    console.error(error);
    startBtn.textContent = "Map could not load";
    document.querySelector("#startDescription").textContent = error.message;
    return false;
  }
}

const powerSounds = new Map();
function playPowerSound(name, position) {
  if (muted || !raceStarted) return;
  const sound = powerSounds.get(name);
  if (!sound?.buffer) return;
  if (sound.isPlaying) sound.stop();
  sound.setVolume(Math.min(0.45, 12 / Math.max(25, position.distanceTo(camera.position))));
  sound.play();
}

async function makeCar(id, name) {
  const root = await loadCar(id, name);
  const sample = engineProfile(root.userData.engineClass).sample;
  if (!engineBuffers.has(sample)) engineBuffers.set(sample, audioLoader.loadAsync(assetUrl(sample)));
  root.userData.engine = new CarEngineAudio(listener, root, await engineBuffers.get(sample));
  scene.add(root);
  return root;
}

function nearestTrackData(position) {
  if (!centerline.length) return { index: 0, lateral: 0 };
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < samples; i += 1) {
    const dist = position.distanceToSquared(centerline[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  const p = centerline[bestIndex];
  const n = normals[bestIndex];
  const lateral = tempVec.copy(position).sub(p).dot(n);
  return {
    index: bestIndex,
    center: p,
    tangent: tangents[bestIndex],
    normal: n,
    lateral,
    distance: Math.sqrt(bestDist),
  };
}

class CarController {
  constructor(mesh, options = {}) {
    this.mesh = mesh;
    this.name = mesh.name;
    this.isPlayer = options.isPlayer || false;
    this.position = mesh.position;
    this.velocity = new THREE.Vector3();
    this.heading = options.heading ?? 0;
    this.steer = 0;
    this.throttle = 0;
    this.airborne = false;
    this.sliding = false;
    this.bumpCooldown = 0;
    this.aiTargetOffset = options.aiTargetOffset || 0;
    this.aiSpeed = options.aiSpeed || 0.9;
    this.ai = new RaceAI(loadedLevel.aiRoute, this.aiSpeed, mesh.userData.physics);
    this.lap = 1;
    this.finished = false;
    this.nextCheckpoint = 1;
    this.progress = 0;
    this.lastTrackIndex = 0;
    this.placeScore = 0;
    this.lapTracker = new LapProgress(checkpoints, TOTAL_LAPS);
    this.resetTo(0, options.startOffset || 0, (samples - (options.startIndex || samples)) / 6);
  }

  resetTo(index, offset = 0, gridRow = 0) {
    if (this.isPlayer) {
      this.scrapeHold = 0;
      if (sounds.scrape.isPlaying) sounds.scrape.stop();
    }
    skidMarks?.previous.delete(this);
    this.sliding = false;
    if (this.physics !== physics) {
      this.physics = physics;
      this.car = physics.createCar(this.mesh, { autoRighting: !this.isPlayer });
    }
    const heading = index && tangents[index] ? Math.atan2(tangents[index].x, tangents[index].z) : (loadedLevel.info.STARTROT?.[0] ?? 0) * Math.PI * 2;
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const p = index && centerline[index] ? centerline[index].clone() : new THREE.Vector3();
    p.addScaledVector(right, offset).addScaledVector(forward, -gridRow * 20);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    let placed = physics.placeCar(this.car, p, rotation);
    if (!placed && this.car.safePose) placed = physics.placeCar(this.car, this.car.safePose.position, this.car.safePose.rotation);
    if (!placed) physics.placeCar(this.car, new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (loadedLevel.info.STARTROT?.[0] ?? 0) * Math.PI * 2));
    this.syncPhysics();
    this.lastTrackIndex = index;
    this.lapTracker?.relocate(this.position);
  }

  restart(index, offset = 0) {
    this.ai = new RaceAI(loadedLevel.aiRoute, this.aiSpeed, this.mesh.userData.physics);
    this.resetTo(0, offset, (samples - (index || samples)) / 6);
    this.lapTracker?.reset(checkpoints, this.position);
    this.lap = 1;
    this.finished = false;
    this.nextCheckpoint = 1;
    this.progress = 0;
    this.placeScore = 0;
    this.bumpCooldown = 0;
  }

  update(dt) {
    if (this.finished || dt === 0) return;
    if (this.isPlayer && resetFade?.active) {
      this.sliding = false; this.throttle = 0; this.steer = 0;
      physics.updateVehicle(this.car, dt, 0, 1, 0, false);
      return;
    }

    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const speed = this.velocity.dot(forward);
    let throttle = 0;
    let brake = 0;
    let steerInput = 0;
    let handbrake = false;

    if (this.isPlayer) {
      throttle = pressed("KeyW") || pressed("ArrowUp") ? 1 : 0;
      brake = pressed("KeyS") || pressed("ArrowDown") ? 1 : 0;
      steerInput = keyboardSteering(pressed("KeyA") || pressed("ArrowLeft"), pressed("KeyD") || pressed("ArrowRight"));
      handbrake = pressed("Space");
    } else if (centerline.length) {
      const controls = this.ai.update(dt, this.position, this.heading, this.velocity, {
        disabled: this.powerups?.disabled > 0,
        upsideDown: new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion).y < 0.25,
        halfExtents: this.car.setup.halfExtents,
        traffic: racers.filter(racer=>racer!==this).map(racer=>({position:racer.position,velocity:racer.velocity,heading:racer.heading,halfExtents:racer.car.setup.halfExtents})),
      });
      throttle = controls.throttle; brake = controls.brake; steerInput = controls.steering;
      if (controls.recovery) {
        const recovery = findAiRecovery(physics, this.ai, controls.recoveryDistance);
        if (recovery) {
          const placed = physics.placeCar(this.car, recovery.position, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), recovery.heading));
          if (placed) this.ai.acceptRecovery(recovery.distance);
          this.steer = 0; this.syncPhysics();
        }
      }
    }

    this.steer = this.isPlayer ? smoothPlayerSteering(this.steer, steerInput, dt) : THREE.MathUtils.lerp(this.steer, steerInput, 1 - Math.exp(-dt * 7.5));
    const trackData = nearestTrackData(this.position);
    const reversing = brake && speed < 2;
    this.throttle = throttle - (reversing ? brake : 0);
    if (this.powerups?.disabled > 0) this.throttle = 0;
    physics.updateVehicle(this.car, dt, this.throttle * (this.powerups?.boost > 0 ? 1.1 : 1), reversing ? 0 : brake, this.steer, handbrake, this.powerups?.slippery > 0 ? 0.025 : 1, this.isPlayer ? 2.1 : 1);
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);

    this.updateProgress(trackData);
    this.interact(speed, handbrake);
  }

  syncPhysics() {
    this.position.copy(this.car.body.translation());
    this.mesh.quaternion.copy(this.car.body.rotation());
    this.velocity.copy(this.car.body.linvel());
    if (this.isPlayer && this.car.impact > 1.5 && this.bumpCooldown === 0) {
      this.bumpCooldown = 0.18;
      if (!muted && raceStarted && sounds.hit.buffer) {
        if (sounds.hit.isPlaying) sounds.hit.stop();
        sounds.hit.setVolume(Math.min(0.65, 0.15 + this.car.impact * 0.025));
        sounds.hit.play();
      }
    }
    if (this.isPlayer) {
      this.scrapeHold = this.car.scrape > 1 ? 0.08 : Math.max(0, (this.scrapeHold ?? 0) - PHYSICS_STEP);
      if (!muted && raceStarted && this.scrapeHold > 0 && sounds.scrape.buffer) {
        sounds.scrape.setVolume(Math.min(0.5, 0.08 + this.car.scrape * 0.015));
        if (!sounds.scrape.isPlaying) sounds.scrape.play();
      } else if (sounds.scrape.isPlaying) sounds.scrape.stop();
    }
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    this.heading = Math.atan2(forward.x, forward.z);
    this.airborne = true;
    this.mesh.userData.wheels.forEach((wheel, i) => {
      const suspension = this.car.vehicle.wheelSuspensionLength(i) ?? 0.6;
      wheel.position.y = this.car.setup.wheels[i].position.y - wheel.parent.position.y + 0.6 - suspension;
      setWheelPose(wheel, this.car.vehicle.wheelSteering(i) ?? 0, this.car.vehicle.wheelRotation(i) ?? 0);
      if (this.car.vehicle.wheelIsInContact(i)) this.airborne = false;
    });
    if (this.position.y < physics.bounds.min.y - 50) this.resetTo(this.lastTrackIndex);
  }

  updateProgress(trackData) {
    if (!checkpoints.length) return;
    this.lapTracker.update(this.position);
    this.lap = this.lapTracker.lap;
    this.nextCheckpoint = this.lapTracker.nextCheckpoint;
    this.finished = this.lapTracker.finished;
    this.lastTrackIndex = trackData.index;
    this.progress = trackData.index / samples;
    this.placeScore = this.lapTracker.score(this.position);
    if (this.finished) physics.updateVehicle(this.car, PHYSICS_STEP, 0, 1, 0, false);
  }

  interact(speed, handbrake) {
    this.sliding = isSkidding({ speed, lateralSpeed: this.velocity.dot(new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading))), steer: this.steer, handbrake, airborne: this.airborne });
    if (this.isPlayer) {
      const sliding = this.sliding;
      if (sliding && sounds.skid.buffer && !sounds.skid.isPlaying && !muted) sounds.skid.play();
      if ((!sliding || muted) && sounds.skid.isPlaying) sounds.skid.stop();
    }
  }
}

await initializePhysics();
powerAssets = await PowerupSystem.loadAssets();
for (const name of new Set([...POWERUPS.map((p) => p.sound), "pickup", "firebang", "puttbang", "wbombhit"])) {
  const sound = new THREE.Audio(listener);
  powerSounds.set(name, sound);
  audioLoader.load(assetUrl(`/wavs/${name}.wav`), (buffer) => sound.setBuffer(buffer));
}
await buildLevel(currentLevel);

const playerMesh = await makeCar("rc", "RC Bandit");
const racers = [
  new CarController(playerMesh, { isPlayer: true, startIndex: 0, startOffset: -3.3 }),
  new CarController(await makeCar("volken", "Volken Turbo"), { startIndex: 354, startOffset: 3.2, aiTargetOffset: 1.2, aiSpeed: 0.92 }),
  new CarController(await makeCar("phat", "Phat Slug"), { startIndex: 348, startOffset: -1.4, aiTargetOffset: -2.2, aiSpeed: 0.88 }),
  new CarController(await makeCar("cougar", "Cougar"), { startIndex: 342, startOffset: 3.8, aiTargetOffset: 2.8, aiSpeed: 0.96 }),
];
let player = racers[0];
powerups.reset(racers);

for (const item of POWERUPS) {
  const option = document.createElement("option");
  option.value = item.id; option.textContent = item.name;
  debugPowerup.append(option);
}
function debugGivePowerup() {
  if (!raceStarted || levelLoading) return;
  powerups.debugGive(player, debugPowerup.value);
  updateHud();
}
debugPowerup.addEventListener("change", debugGivePowerup);
document.querySelector("#debugGive").addEventListener("click", debugGivePowerup);
document.querySelector("#debugUse").addEventListener("click", () => {
  if (raceStarted && !levelLoading) powerups.fire(player, racers);
});
document.querySelector("#debugClear").addEventListener("click", () => {
  if (raceStarted && !levelLoading) { powerups.debugClear(player); updateHud(); }
});

for (const level of LEVELS) {
  const option = document.createElement("option");
  option.value = level.id;
  option.textContent = level.name;
  levelSelect.append(option);
  menuTrack.append(option.cloneNode(true));
}
levelSelect.value = currentLevel.id;
menuTrack.value = currentLevel.id;

showroom = await Showroom.create(renderer, __REVOLT_FILES__);
for (const [index, car] of showroom.cars.entries()) {
  const option = document.createElement("option");
  option.value = index; option.textContent = car.name; carSelect.append(option);
}
function selectCar(index) {
  const car = showroom.select(index);
  if (car.id !== selectedCarId) playCarSwitchSound();
  selectedCarId = car.id; carSelect.value = showroom.selected;
  document.querySelector("#carName").textContent = car.name;
  const stats = document.querySelector("#carStats");
  stats.replaceChildren();
  const entries = [["Class", car.engineClass === 1 ? "Glow / Petrol" : "Electric"], ["Rating", ["Rookie", "Amateur", "Advanced", "Semi-Pro", "Pro"][car.rating] ?? "Special"], ["Speed", `${car.speed.toFixed(1)} mph`], ["Acceleration", car.acceleration.toFixed(1)], ["Weight", `${car.weight.toFixed(2)} kg`], ["Transmission", ["4WD", "FWD", "RWD"][car.transmission] ?? "4WD"]];
  for (const [label, value] of entries) {
    const term = document.createElement("dt"), detail = document.createElement("dd");
    term.textContent = label; detail.textContent = value;
    if (["Speed", "Acceleration", "Weight"].includes(label)) {
      const meter = document.createElement("meter");
      meter.min = 0; meter.max = label === "Speed" ? 65 : label === "Acceleration" ? 15 : 3;
      meter.value = label === "Speed" ? car.speed : label === "Acceleration" ? car.acceleration : car.weight;
      meter.setAttribute("aria-label", label); detail.prepend(meter);
    }
    stats.append(term, detail);
  }
  canvas.dataset.selectedCar = car.id;
}
selectCar(0);
document.querySelector("#startDescription").textContent = "WASD to move · Drag with the mouse to look · Click a box to select a car";
carSelect.addEventListener("change", () => selectCar(Number(carSelect.value)));
document.querySelector("#prevCar").addEventListener("click", () => selectCar(showroom.selected - 1));
document.querySelector("#nextCar").addEventListener("click", () => selectCar(showroom.selected + 1));
let showroomDrag = null;
canvas.tabIndex = 0;
canvas.addEventListener("pointerdown", event => {
  if (raceStarted || levelLoading || event.button !== 0) return;
  canvas.focus({ preventScroll: true });
  showroomDrag = { x: event.clientX, y: event.clientY, distance: 0 };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (!showroomDrag || raceStarted || levelLoading) return;
  const dx = event.clientX - showroomDrag.x, dy = event.clientY - showroomDrag.y;
  showroomDrag.distance += Math.abs(dx) + Math.abs(dy);
  if (event.pointerType !== "touch") showroom.navigation.look(dx, dy);
  showroomDrag.x = event.clientX; showroomDrag.y = event.clientY;
});
canvas.addEventListener("pointerup", event => {
  const drag = showroomDrag; showroomDrag = null;
  if (!drag || drag.distance > 5 || raceStarted || levelLoading) return;
  const rect = canvas.getBoundingClientRect();
  const selected = showroom.pick((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  if (selected) selectCar(showroom.selected);
});
canvas.addEventListener("pointercancel", () => { showroomDrag = null; });
function openMenu() {
  resetFade?.cancel(); resetBtn.disabled = false;
  raceStarted = false; keys.clear(); touchControls.clear(); physicsAccumulator = 0;
  startOverlay.classList.remove("hidden");
  document.querySelector("#game").classList.add("menu-open");
  if (sounds.ambience.isPlaying) sounds.ambience.stop();
  if (sounds.skid.isPlaying) sounds.skid.stop();
  if (sounds.hit.isPlaying) sounds.hit.stop();
  if (sounds.scrape.isPlaying) sounds.scrape.stop();
  for (const sound of powerSounds.values()) if (sound.isPlaying) sound.stop();
}
document.querySelector("#menuBtn").addEventListener("click", openMenu);

async function switchLevel(nextIndex) {
  currentLevelIndex = (nextIndex + LEVELS.length) % LEVELS.length;
  currentLevel = LEVELS[currentLevelIndex];
  levelSelect.value = currentLevel.id;
  menuTrack.value = currentLevel.id;
  elapsedRace = 0;
  physicsAccumulator = 0;
  openMenu();
  const built = await buildLevel(currentLevel);
  if (!built) return;
  racers[0].restart(0, -3.3);
  racers[1].restart(354, 3.2);
  racers[2].restart(348, -1.4);
  racers[3].restart(342, 3.8);
  powerups.reset(racers);
  updateCamera(1);
  updateHud();
}

function pressed(code) {
  return keys.get(code) === true || touchControls.pressed(code);
}

function flipPlayer() {
  if (!raceStarted || levelLoading || resetFade?.active) return;
  if (!physics.flipCar(player.car)) return;
  keys.clear(); touchControls.clear();
  player.steer = 0; player.sliding = false; player.scrapeHold = 0;
  skidMarks.previous.delete(player);
  if (sounds.skid.isPlaying) sounds.skid.stop();
  if (sounds.scrape.isPlaying) sounds.scrape.stop();
  player.syncPhysics();
  player.lapTracker.relocate(player.position);
}

function resetPlayer() {
  if (!raceStarted || levelLoading || resetFade?.active) return;
  const back = Math.max(0, player.lastTrackIndex - 4);
  const offset = THREE.MathUtils.clamp(nearestTrackData(player.position).lateral, -4, 4);
  resetFade = new CarResetFade(player.mesh);
  resetFade.start(() => player.resetTo(back, offset));
  resetBtn.disabled = true; player.sliding = false;
  skidMarks.previous.delete(player);
  if (sounds.skid.isPlaying) sounds.skid.stop();
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function updateCamera(dt) {
  const forward = tempVec.set(Math.sin(player.heading), 0, Math.cos(player.heading));
  const speed = player.velocity.length();
  let desired;
  let lookAt;

  if (cameraMode === 0) {
    desired = player.position.clone().addScaledVector(forward, -16 - speed * 0.16).add(new THREE.Vector3(0, 7.5, 0));
    lookAt = player.position.clone().addScaledVector(forward, 11).add(new THREE.Vector3(0, 2.2, 0));
  } else if (cameraMode === 1) {
    desired = player.position.clone().add(new THREE.Vector3(0, 42, 0)).addScaledVector(forward, -4);
    lookAt = player.position.clone().addScaledVector(forward, 5);
  } else {
    desired = player.position.clone().addScaledVector(forward, 3.2).add(new THREE.Vector3(0, 2.2, 0));
    lookAt = player.position.clone().addScaledVector(forward, 28).add(new THREE.Vector3(0, 1.2, 0));
  }

  camera.position.lerp(desired, 1 - Math.exp(-dt * 6));
  if (loadedLevel && cameraMode === 0) {
    const target = player.position.clone().add(new THREE.Vector3(0, 2, 0));
    const direction = camera.position.clone().sub(target);
    obstacleRay.set(target, direction.clone().normalize());
    obstacleRay.far = direction.length();
    const hit = obstacleRay.intersectObject(loadedLevel.group, true)[0];
    if (hit) camera.position.copy(target).addScaledVector(obstacleRay.ray.direction, Math.max(1, hit.distance - 0.8));
  }
  camera.lookAt(lookAt);
}

function updateHud() {
  const speed = Math.round(player.velocity.length() * 2.7);
  const sorted = [...racers].sort((a, b) => b.placeScore - a.placeScore);
  const place = sorted.indexOf(player) + 1;
  speedEl.textContent = speed.toString();
  lapEl.textContent = `${Math.min(player.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;
  placeEl.textContent = `${place}/${racers.length}`;
  timeEl.textContent = formatTime(elapsedRace);
  const state = player.powerups;
  if (state) {
    const icon = state.rolling > 0 ? POWERUPS[Math.floor(elapsedRace * 12) % 10] : state.held;
    if (icon !== lastPowerIcon) { powerups.drawIcon(powerIcon, icon); lastPowerIcon = icon; }
    powerName.textContent = state.rolling > 0 ? "Selecting..." : state.held?.name ?? "No Pick Up";
    powerStatus.textContent = state.disabled > 0 ? `Power cut: ${state.disabled.toFixed(1)} s` : state.boost > 0 ? `Turbo: ${state.boost.toFixed(1)} s` : state.electro > 0 ? `Pulse: ${state.electro.toFixed(1)} s` : state.shots > 0 ? `${state.shots} / ${state.held.shots}` : "";
    powerBtn.disabled = !state.held || state.rolling > 0 || state.cooldown > 0 || !raceStarted;
    touchControls.setFireEnabled(!powerBtn.disabled);
    const debugLabel = `${powerName.textContent}${powerStatus.textContent ? ` - ${powerStatus.textContent}` : ""}`;
    if (debugStatus.textContent !== debugLabel) debugStatus.textContent = debugLabel;
    document.querySelector("#debugUse").disabled = powerBtn.disabled;
  }
}



function drawMinimap() {
  const w = mapCanvas.width;
  const h = mapCanvas.height;
  mapCtx.clearRect(0, 0, w, h);
  mapCtx.fillStyle = "rgba(8, 10, 13, 0.58)";
  mapCtx.fillRect(0, 0, w, h);
  mapCtx.save();
  mapCtx.translate(w / 2, h / 2);
  const bounds = centerline.length ? new THREE.Box3().setFromPoints(centerline) : physics.bounds;
  const center = bounds.getCenter(new THREE.Vector3());
  const span = bounds.getSize(new THREE.Vector3());
  const mapScale = Math.min(w / Math.max(span.x, 1), h / Math.max(span.z, 1)) * 0.8;
  mapCtx.scale(mapScale, mapScale);
  mapCtx.translate(-center.x, -center.z);
  mapCtx.lineWidth = 14;
  mapCtx.lineCap = "round";
  mapCtx.strokeStyle = "rgba(255,255,255,0.18)";
  mapCtx.beginPath();
  centerline.forEach((p, i) => {
    const x = p.x;
    const y = p.z;
    if (i === 0) mapCtx.moveTo(x, y);
    else mapCtx.lineTo(x, y);
  });
  mapCtx.closePath();
  mapCtx.stroke();
  mapCtx.lineWidth = 3;
  mapCtx.strokeStyle = "#f1c94b";
  mapCtx.stroke();
  for (const racer of racers) {
    mapCtx.fillStyle = racer.isPlayer ? "#ff3939" : "#ffffff";
    mapCtx.beginPath();
    mapCtx.arc(racer.position.x, racer.position.z, (racer.isPlayer ? 4 : 3) / mapScale, 0, Math.PI * 2);
    mapCtx.fill();
  }
  mapCtx.restore();
}

function stepRacePhysics() {
  for (const racer of racers) racer.update(PHYSICS_STEP);
  physics.step();
  for (const racer of racers) {
    const recovered = physics.checkCar(racer.car, PHYSICS_STEP, racers.map(other => other.car));
    racer.syncPhysics();
    if (recovered) racer.lapTracker?.relocate(racer.position);
    skidMarks.track(racer);
  }
  powerups.update(PHYSICS_STEP, racers);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  resetFade?.update(dt);
  resetBtn.disabled = resetFade?.active ?? false;
  const canFlip = raceStarted && !levelLoading && !resetFade?.active &&
    new THREE.Vector3(0, 1, 0).applyQuaternion(player.mesh.quaternion).y <= 0.7;
  flipBtn.disabled = !canFlip;
  touchControls.setFlipEnabled(canFlip);
  if (raceStarted && !player.finished) elapsedRace += dt;

  if (raceStarted && !levelLoading) {
    physicsAccumulator += dt;
    while (physicsAccumulator >= PHYSICS_STEP) {
      stepRacePhysics();
      physicsAccumulator -= PHYSICS_STEP;
    }
  }
  if (raceStarted && !levelLoading) skidMarks.update(dt);
  for (const racer of racers) racer.mesh.userData.engine.update(dt, {
    running: raceStarted && !levelLoading && !(racer.powerups?.disabled > 0),
    muted,
    speed: racer.velocity.length(),
    throttle: racer.finished ? 0 : racer.throttle,
    airborne: racer.airborne,
  });
  loadedLevel?.water?.update(dt, racers.map(racer => racer.car));
  for (const racer of racers) racer.mesh.userData.antenna?.update(dt);
  updateCamera(dt);
  updateHud();
  drawMinimap();

  if (!raceStarted && showroom) showroom.render(renderer, dt, camera.aspect, keys);
  else renderer.render(scene, camera);
  canvas.dataset.view = raceStarted ? "race" : "menu";
  canvas.dataset.physics = JSON.stringify({ position: player.position.toArray(), velocity: player.velocity.toArray(), airborne: player.airborne, steer: player.steer, triangleCount: physics.triangleCount });
  canvas.dataset.engines = JSON.stringify(racers.map((racer) => ({ name: racer.name, engineClass: racer.mesh.userData.engineClass, sample: racer.mesh.userData.engine.profile.sample, playing: racer.mesh.userData.engine.audio.isPlaying, pitch: racer.mesh.userData.engine.audio.getPlaybackRate(), volume: racer.mesh.userData.engine.audio.getVolume() })));
  canvas.dataset.powerups = JSON.stringify({ held: player.powerups.held?.id, shots: player.powerups.shots, bomb: player.powerups.bomb, boost: player.powerups.boost, pickups: powerups.pickups.map((p) => ({ position: p.position.toArray(), active: p.active, model: p.mesh.name })), projectiles: powerups.projectiles.length, hazards: powerups.hazards.length });
  canvas.dataset.opponents = JSON.stringify(racers.slice(1).map((racer) => ({ name: racer.name, position: racer.position.toArray(), lap: racer.lap, progress: racer.progress, speed: racer.velocity.length(), recoveries: racer.ai.recoveryCount })));
  canvas.dataset.skidMarks = skidMarks.count;
  canvas.dataset.resetOpacity = resetFade?.opacity ?? 1;
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (!raceStarted) {
    if (event.target.matches("select, input, textarea, button")) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) { event.preventDefault(); keys.set(event.code, true); }
    if (event.code === "ArrowLeft") { event.preventDefault(); selectCar(showroom.selected - 1); }
    if (event.code === "ArrowRight") { event.preventDefault(); selectCar(showroom.selected + 1); }
    if (event.code === "Enter") startBtn.click();
    return;
  }
  if (event.code === "Escape") { openMenu(); return; }
  if (event.target.matches("select, input, textarea")) return;
  if (["KeyF", "ControlLeft"].includes(event.code)) { event.preventDefault(); if (!event.repeat) powerups.fire(player, racers); }
  keys.set(event.code, true);
  if (event.code === "KeyV") { event.preventDefault(); if (!event.repeat) flipPlayer(); }
  if (event.code === "KeyR") resetPlayer();
  if (event.code === "KeyC") cameraMode = (cameraMode + 1) % 3;
});
window.addEventListener("keyup", (event) => keys.set(event.code, false));
window.addEventListener("blur", () => { keys.clear(); showroomDrag = null; });

startBtn.addEventListener("click", async () => {
  if (levelLoading) return;
  startBtn.disabled = true;
  if (listener.context.state === "suspended") listener.context.resume();
  try {
    if (playerCarId !== selectedCarId) {
      powerups.reset(racers);
      const choice = showroom.cars.find((car) => car.id === selectedCarId);
      const mesh = await makeCar(choice.id, choice.name);
      scene.remove(player.mesh);
      physics.removeCar(player.car);
      player.mesh.userData.engine.audio.disconnect();
      player.mesh.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
      racers[0] = player = new CarController(mesh, { isPlayer: true, startOffset: -3.3 });
      playerCarId = choice.id;
    }
    elapsedRace = 0;
    skidMarks.clear();
    racers.forEach((racer, i) => racer.restart(i ? 360 - i * 6 : 0, [-3.3, 3.2, -1.4, 3.8][i]));
    powerups.reset(racers);
  } catch (error) {
    console.error(error); document.querySelector("#startDescription").textContent = error.message;
    startBtn.disabled = false; return;
  }
  startBtn.disabled = false;
  keys.clear(); showroomDrag = null;
  raceStarted = true;
  startOverlay.classList.add("hidden");
  document.querySelector("#game").classList.remove("menu-open");
  updateCamera(1);
  if (sounds.ambience.buffer && !sounds.ambience.isPlaying && !muted) sounds.ambience.play();
});
levelSelect.addEventListener("change", () => {
  const next = LEVELS.findIndex((level) => level.id === levelSelect.value);
  if (next >= 0) switchLevel(next);
});
menuTrack.addEventListener("change", () => switchLevel(LEVELS.findIndex((level) => level.id === menuTrack.value)));
cameraBtn.addEventListener("click", () => {
  cameraMode = (cameraMode + 1) % 3;
});
resetBtn.addEventListener("click", resetPlayer);
flipBtn.addEventListener("click", flipPlayer);
powerBtn.addEventListener("click", () => { if (raceStarted && !levelLoading) powerups.fire(player, racers); });
nextLevelBtn.addEventListener("click", () => {
  switchLevel(currentLevelIndex + 1);
});
muteBtn.addEventListener("click", () => {
  muted = !muted;
  audioLifecycle.update();
  muteBtn.textContent = muted ? "Muted" : "Sound";
  if (muted && sounds.skid.isPlaying) sounds.skid.stop();
  if (muted && sounds.hit.isPlaying) sounds.hit.stop();
  if (muted && sounds.scrape.isPlaying) sounds.scrape.stop();
  if (muted && sounds.carSwitch.isPlaying) sounds.carSwitch.stop();
  if (muted && sounds.ambience.isPlaying) sounds.ambience.stop();
  if (muted) for (const sound of powerSounds.values()) if (sound.isPlaying) sound.stop();
  if (!muted && raceStarted && sounds.ambience.buffer && !sounds.ambience.isPlaying) sounds.ambience.play();
});

resize();
updateCamera(1);
animate();
