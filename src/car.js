import * as THREE from "three";
import { input } from "./input.js";

// ---------------------------------------------------------------
// The car. Built entirely from boxes and cylinders so you can
// change its shape and colours by editing numbers below.
// Physics is "arcade" style: simple, fun, and readable.
// ---------------------------------------------------------------

const TUNING = {
  acceleration: 22,     // how hard it pushes forward
  reverseAccel: 12,     // reverse is weaker, like a real car
  maxSpeed: 38,         // metres per second (~137 km/h)
  maxReverse: 10,
  drag: 0.6,            // slows you gently all the time
  brakeDrag: 4.5,       // extra slowdown when reversing against motion
  steerStrength: 2.1,   // how fast the wheel turns the car
  grip: 6.0,            // high = sticks to the road, low = drifty
  handbrakeGrip: 1.2,   // grip while holding space (drift mode!)
};

const COLOURS = {
  body: 0xd44d2e,     // burnt orange
  nose: 0xf2ede3,     // paper white
  wing: 0x1c2321,     // near-black
  wheel: 0x14100e,
  hub: 0xb8b2a6,
  driver: 0x2a6f6f,   // teal helmet
};

export class Car {
  constructor(scene) {
    this.group = new THREE.Group();

    // --- state ---
    this.velocity = new THREE.Vector3();
    this.heading = 0;          // which way the car points (radians)
    this.steer = 0;            // current steering angle (smoothed)
    this.spawn = new THREE.Vector3(0, 0, 0);

    this.buildBody();
    scene.add(this.group);
    this.resetPosition();
  }

  buildBody() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: COLOURS.body, roughness: 0.4 });
    const noseMat = new THREE.MeshStandardMaterial({ color: COLOURS.nose, roughness: 0.5 });
    const wingMat = new THREE.MeshStandardMaterial({ color: COLOURS.wing, roughness: 0.6 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: COLOURS.wheel, roughness: 0.9 });
    const hubMat = new THREE.MeshStandardMaterial({ color: COLOURS.hub, metalness: 0.6, roughness: 0.3 });
    const driverMat = new THREE.MeshStandardMaterial({ color: COLOURS.driver, roughness: 0.4 });

    // main tub
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 3.2), bodyMat);
    tub.position.y = 0.45;
    tub.castShadow = true;
    this.group.add(tub);

    // nose cone
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 1.1), noseMat);
    nose.position.set(0, 0.42, 2.0);
    nose.castShadow = true;
    this.group.add(nose);

    // front wing
    const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.5), wingMat);
    frontWing.position.set(0, 0.28, 2.45);
    frontWing.castShadow = true;
    this.group.add(frontWing);

    // rear wing on two little posts
    const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.45), wingMat);
    rearWing.position.set(0, 1.05, -1.65);
    rearWing.castShadow = true;
    this.group.add(rearWing);
    for (const x of [-0.5, 0.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), wingMat);
      post.position.set(x, 0.85, -1.65);
      this.group.add(post);
    }

    // driver's helmet
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), driverMat);
    helmet.position.set(0, 0.85, -0.35);
    helmet.castShadow = true;
    this.group.add(helmet);

    // wheels — front two are stored so we can visually steer them
    this.wheels = [];
    this.frontWheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.4, 20);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 12);
    hubGeo.rotateZ(Math.PI / 2);

    const positions = [
      { x: -0.85, z: 1.45, front: true },
      { x: 0.85, z: 1.45, front: true },
      { x: -0.85, z: -1.35, front: false },
      { x: 0.85, z: -1.35, front: false },
    ];

    for (const p of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(p.x, 0.42, p.z);

      const tyre = new THREE.Mesh(wheelGeo, wheelMat);
      tyre.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat);
      pivot.add(tyre);
      pivot.add(hub);

      this.group.add(pivot);
      this.wheels.push({ pivot, tyre, hub });
      if (p.front) this.frontWheels.push(pivot);
    }
  }

  resetPosition() {
    this.group.position.copy(this.spawn);
    this.velocity.set(0, 0, 0);
    this.heading = 0;
    this.steer = 0;
  }

  update(dt) {
    if (input.reset) this.resetPosition();

    // --- work out forward direction from heading ---
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));

    // signed speed: positive = moving forwards, negative = reversing
    const speedAlongForward = this.velocity.dot(forward);

    // --- throttle & brake ---
    if (input.forward) {
      this.velocity.addScaledVector(forward, TUNING.acceleration * dt);
    }
    if (input.backward) {
      // pressing "down" brakes hard first, then reverses
      const braking = speedAlongForward > 0.5 ? TUNING.brakeDrag : 0;
      this.velocity.addScaledVector(forward, -(TUNING.reverseAccel + braking) * dt);
    }

    // natural drag so you coast to a stop
    this.velocity.multiplyScalar(Math.max(0, 1 - TUNING.drag * dt));

    // --- steering ---
    // target steering angle from keys, smoothed for feel
    let steerTarget = 0;
    if (input.left) steerTarget += 1;
    if (input.right) steerTarget -= 1;
    this.steer = THREE.MathUtils.lerp(this.steer, steerTarget, 8 * dt);

    // you can only turn while moving; reversing flips steering like a real car
    const speed = this.velocity.length();
    const steerEffect = Math.min(speed / 12, 1) * Math.sign(speedAlongForward || 1);
    this.heading += this.steer * TUNING.steerStrength * steerEffect * dt;

    // --- grip: velocity gradually swings to match where the car points ---
    // Low grip while handbraking = drift.
    const grip = input.handbrake ? TUNING.handbrakeGrip : TUNING.grip;
    const desired = forward.clone().multiplyScalar(speedAlongForward >= 0 ? speed : -speed);
    this.velocity.lerp(desired, Math.min(grip * dt, 1));

    // --- speed limits ---
    const newSpeedForward = this.velocity.dot(forward);
    if (newSpeedForward > TUNING.maxSpeed) {
      this.velocity.multiplyScalar(TUNING.maxSpeed / this.velocity.length());
    } else if (newSpeedForward < -TUNING.maxReverse) {
      this.velocity.multiplyScalar(TUNING.maxReverse / this.velocity.length());
    }

    // --- move & rotate the visible car ---
    this.group.position.addScaledVector(this.velocity, dt);
    this.group.rotation.y = this.heading;

    // spin the tyres based on speed, steer the front pivots
    const spin = speedAlongForward * dt / 0.42;
    for (const w of this.wheels) {
      w.tyre.rotation.x += spin;
      w.hub.rotation.x += spin;
    }
    for (const fw of this.frontWheels) {
      fw.rotation.y = this.steer * 0.45;
    }
  }

  get speedKmh() {
    return Math.round(this.velocity.length() * 3.6);
  }
}
