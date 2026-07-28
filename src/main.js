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
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const scene = new THREE.Scene();
const world = new World(scene);
const car = new Car(scene);
const chaseCam = new ChaseCamera();

const speedEl = document.getElementById("speed");

const clock = new THREE.Clock();

function loop() {
  // cap dt so a background tab doesn't cause a physics explosion
  const dt = Math.min(clock.getDelta(), 0.05);

  car.update(dt);
  world.update(dt, car);
  chaseCam.update(dt, car);

  speedEl.textContent = car.speedKmh;

  renderer.render(scene, chaseCam.camera);
  requestAnimationFrame(loop);
}

loop();
