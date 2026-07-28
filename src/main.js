import * as THREE from "three";
import { Car } from "./car.js";
import { World } from "./world.js";
import { ChaseCamera } from "./camera.js";
import "./input.js";

// ---------------------------------------------------------------
// Everything starts here. Scene setup, then the game loop:
// update the car, world, and camera, then draw a frame.
// ---------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("aria-label", "VROOM driving game");
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const scene = new THREE.Scene();
const world = new World(scene);
const car = new Car(scene, world);
const chaseCam = new ChaseCamera();

const speedEl = document.getElementById("speed");
const telemetryEl = document.getElementById("telemetry");
const telemetryEls = {
  surface: document.getElementById("surface"),
  longitudinalG: document.getElementById("long-g"),
  lateralG: document.getElementById("lat-g"),
  frontSlip: document.getElementById("front-slip"),
  rearSlip: document.getElementById("rear-slip"),
  frontLoad: document.getElementById("front-load"),
  verticalG: document.getElementById("vertical-g"),
  contact: document.getElementById("wheel-contact"),
  wheelLoads: [
    document.getElementById("load-fl"),
    document.getElementById("load-fr"),
    document.getElementById("load-rl"),
    document.getElementById("load-rr"),
  ],
  downforce: document.getElementById("downforce"),
  gripFill: document.getElementById("grip-fill"),
  gripValue: document.getElementById("grip-value"),
};

const clock = new THREE.Clock();
const PHYSICS_STEP = 1 / 120;
const MAX_PHYSICS_STEPS = 10;
let accumulator = 0;

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyT" && !event.repeat) {
    telemetryEl.classList.toggle("hidden");
  }
});

function signed(value, decimals = 2) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;
}

function updateTelemetry() {
  const data = car.telemetry;
  speedEl.textContent = data.speedKmh;
  telemetryEls.surface.textContent = data.surface;
  telemetryEls.surface.style.color = data.surface === "TARMAC" ? "#e7a257" : "#e3c995";
  telemetryEls.longitudinalG.textContent = signed(data.longitudinalG);
  telemetryEls.lateralG.textContent = signed(data.lateralG);
  telemetryEls.frontSlip.textContent = `${signed(data.frontSlipDeg, 1)}°`;
  telemetryEls.rearSlip.textContent = `${signed(data.rearSlipDeg, 1)}°`;
  telemetryEls.frontLoad.textContent = `${Math.round(data.weightFront)}%`;
  telemetryEls.verticalG.textContent = signed(data.verticalG);
  telemetryEls.contact.textContent = data.airborne
    ? "AIRBORNE"
    : `${data.wheelsGrounded}/4`;
  telemetryEls.contact.style.color = data.airborne ? "#d44d2e" : "";
  telemetryEls.wheelLoads.forEach((element, index) => {
    element.textContent = `${data.wheelLoads[index]} N`;
  });
  telemetryEls.downforce.textContent = `${Math.round(data.downforce)} N`;

  const gripPercent = Math.round(Math.min(data.gripUsed, 1) * 100);
  telemetryEls.gripValue.textContent = `${gripPercent}%`;
  telemetryEls.gripFill.style.width = `${gripPercent}%`;
  telemetryEls.gripFill.style.background = gripPercent > 94 ? "#d44d2e" : "#e7a257";
}

function loop() {
  // Rendering follows the monitor; physics always advances in identical 1/120 s
  // slices. This makes the force model stable on both fast and slow computers.
  const frameDt = Math.min(clock.getDelta(), 0.1);
  accumulator += frameDt;
  let steps = 0;
  while (accumulator >= PHYSICS_STEP && steps < MAX_PHYSICS_STEPS) {
    car.update(PHYSICS_STEP, world);
    world.update(PHYSICS_STEP, car);
    accumulator -= PHYSICS_STEP;
    steps += 1;
  }
  if (steps === MAX_PHYSICS_STEPS) accumulator = 0;

  chaseCam.update(frameDt, car);
  updateTelemetry();
  renderer.render(scene, chaseCam.camera);
  requestAnimationFrame(loop);
}

loop();
