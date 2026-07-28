import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

// input.js normally listens to the browser. Tests only need its shared state.
globalThis.window = { addEventListener() {} };

const { Car, PHYSICS, getSteeringLimit } = await import("../src/car.js");
const { input } = await import("../src/input.js");
const { World } = await import("../src/world.js");

const TARMAC = { name: "TARMAC", friction: 1.18, rollingResistance: 0 };
const SAND = { name: "SAND", friction: 0.58, rollingResistance: 760 };
const DT = 1 / 120;

function resetInput() {
  Object.assign(input, {
    forward: false,
    backward: false,
    left: false,
    right: false,
    handbrake: false,
    reset: false,
  });
}

function freshCar() {
  resetInput();
  return new Car(new THREE.Scene());
}

function simulate(car, seconds, surface = TARMAC) {
  const steps = Math.round(seconds / DT);
  for (let step = 0; step < steps; step++) car.update(DT, surface);
}

test("accelerates from rest using SI-scale forces", () => {
  const car = freshCar();
  input.forward = true;
  simulate(car, 3);

  assert.ok(car.speedKmh > 55, `expected >55 km/h, got ${car.speedKmh}`);
  assert.ok(car.telemetry.longitudinalG > 0);
  assert.ok(car.telemetry.gripUsed <= 1.000001);
});

test("sand reduces acceleration and adds rolling resistance", () => {
  const roadCar = freshCar();
  input.forward = true;
  simulate(roadCar, 2, TARMAC);
  const roadSpeed = roadCar.speedKmh;

  const sandCar = freshCar();
  input.forward = true;
  simulate(sandCar, 2, SAND);

  assert.ok(
    sandCar.speedKmh < roadSpeed * 0.65,
    `sand ${sandCar.speedKmh} km/h should be much slower than road ${roadSpeed} km/h`
  );
});

test("steering creates yaw and lateral acceleration", () => {
  const car = freshCar();
  input.forward = true;
  simulate(car, 2);
  const initialHeading = car.heading;
  const initialPosition = car.group.position.clone();
  const initialRight = new THREE.Vector3(
    Math.cos(initialHeading),
    0,
    -Math.sin(initialHeading)
  );

  input.right = true;
  simulate(car, 0.8);

  assert.ok(car.heading > initialHeading, "right steering should increase heading");
  assert.ok(
    car.group.position.clone().sub(initialPosition).dot(initialRight) > 0.2,
    "right steering should move the car towards its world-space right"
  );
  assert.ok(Math.abs(car.telemetry.lateralG) > 0.05);
  assert.ok(Math.abs(car.telemetry.frontSlipDeg) > 0.1);
});

test("steering yaw reverses correctly while travelling backwards", () => {
  const car = freshCar();
  car.heading = 0;
  car.group.rotation.set(0, 0, 0);
  car.velocity.set(0, 0, -20 / 3.6);
  input.right = true;
  simulate(car, 0.5);

  assert.ok(car.heading < 0, "right lock in reverse should produce negative yaw");
  assert.ok(car.yawRate < 0);
  assert.ok(car.telemetry.lateralG > 0);
});

test("speed-sensitive steering stays inside a controllable slip envelope", () => {
  for (const [speedKmh, maximumSteerDeg] of [
    [50, 10],
    [100, 3],
    [150, 1.5],
  ]) {
    const car = freshCar();
    car.heading = 0;
    car.group.rotation.set(0, 0, 0);
    const speed = speedKmh / 3.6;
    car.velocity.set(0, 0, speed);
    input.right = true;
    simulate(car, 0.5);

    assert.ok(
      Math.abs(THREE.MathUtils.radToDeg(car.steerAngle)) < maximumSteerDeg,
      `${speedKmh} km/h steering exceeded ${maximumSteerDeg}°`
    );
    assert.ok(
      Math.abs(car.telemetry.frontSlipDeg) < 7,
      `${speedKmh} km/h produced ${car.telemetry.frontSlipDeg}° front slip`
    );
    const currentForwardSpeed = car.velocity.dot(
      new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading))
    );
    assert.ok(
      Math.abs(car.steerAngle) <=
        getSteeringLimit(Math.abs(currentForwardSpeed)) + 1e-6
    );
  }
});

test("power-on steering retains rear lateral authority", () => {
  const car = freshCar();
  input.forward = true;
  simulate(car, 2);
  input.right = true;
  let peakRearSlip = 0;

  for (let step = 0; step < 120; step++) {
    car.update(DT, TARMAC);
    peakRearSlip = Math.max(
      peakRearSlip,
      Math.abs(car.telemetry.rearSlipDeg)
    );
  }

  assert.ok(
    peakRearSlip < 8,
    `power-on rear slip reached ${peakRearSlip.toFixed(1)}°`
  );
  assert.ok(
    Math.abs(THREE.MathUtils.radToDeg(car.yawRate)) < 45,
    "power-on yaw should remain recoverable"
  );
  assert.ok(Math.min(...car.telemetry.wheelLoads) > 0);
});

test("the friction circle never reports more than 100% tyre capacity", () => {
  const car = freshCar();
  input.forward = true;
  simulate(car, 2);
  input.right = true;
  input.handbrake = true;

  for (let step = 0; step < 240; step++) {
    car.update(DT, TARMAC);
    assert.ok(car.telemetry.gripUsed <= 1.000001);
    assert.ok(Number.isFinite(car.heading));
    assert.ok(Number.isFinite(car.velocity.length()));
  }
});

test("longitudinal weight transfer unloads the front axle under power", () => {
  const car = freshCar();
  const staticFrontLoad = car.telemetry.weightFront;
  input.forward = true;
  simulate(car, 0.5);

  assert.ok(car.telemetry.weightFront < staticFrontLoad);
});

test("four independent springs support the stationary chassis", () => {
  const car = freshCar();
  simulate(car, 2);

  assert.equal(car.wheels.length, 4);
  assert.equal(car.telemetry.wheelLoads.length, 4);
  assert.equal(car.telemetry.wheelsGrounded, 4);
  const supportedWeight = car.telemetry.wheelLoads.reduce(
    (sum, load) => sum + load,
    0
  );
  assert.ok(
    Math.abs(supportedWeight - 920 * 9.81) < 20,
    `springs support ${supportedWeight} N instead of the car's weight`
  );
});

test("terrain-aware reset primes all four dampers without an impact spike", () => {
  resetInput();
  const slope = {
    sampleTerrain({ x, z }) {
      return {
        height: 0.006 * x - 0.003 * z,
        normal: new THREE.Vector3(-0.006, 1, 0.003).normalize(),
        surface: TARMAC,
      };
    },
  };
  const car = new Car(new THREE.Scene(), slope);
  car.update(DT, slope);
  const staticCornerLoad = (PHYSICS.mass * 9.81) / 4;

  assert.equal(car.telemetry.wheelsGrounded, 4);
  assert.ok(
    Math.max(...car.telemetry.wheelLoads) < staticCornerLoad * 1.2,
    `reset load spike: ${car.telemetry.wheelLoads.join(", ")} N`
  );
});

test("full throttle remains directionally stable on gentle 3D terrain", () => {
  resetInput();
  const slope = {
    sampleTerrain({ x, z }) {
      return {
        height: 0.006 * x - 0.003 * z,
        normal: new THREE.Vector3(-0.006, 1, 0.003).normalize(),
        surface: TARMAC,
      };
    },
  };
  const car = new Car(new THREE.Scene(), slope);
  const initialHeading = car.heading;
  input.forward = true;
  simulate(car, 3, slope);

  const headingDrift = Math.abs(
    THREE.MathUtils.radToDeg(car.heading - initialHeading)
  );
  assert.ok(
    headingDrift < 1,
    `uncommanded heading drift reached ${headingDrift.toFixed(2)}°`
  );
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(car.yawRate)) < 2);
  assert.equal(car.telemetry.wheelsGrounded, 4);
  assert.ok(Math.abs(car.telemetry.rearSlipDeg) < 1);
});

test("crossing the real track terrain does not trigger an uncommanded spin", () => {
  resetInput();
  const terrain = Object.create(World.prototype);
  const car = new Car(new THREE.Scene(), terrain);
  const initialHeading = car.heading;
  input.forward = true;
  simulate(car, 3, terrain);

  const headingDrift = Math.abs(
    THREE.MathUtils.radToDeg(car.heading - initialHeading)
  );
  assert.ok(
    headingDrift < 10,
    `track crossing caused ${headingDrift.toFixed(1)}° of uncommanded yaw`
  );
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(car.yawRate)) < 30);
});

test("a one-sided bump produces independent left and right tyre loads", () => {
  const car = freshCar();
  const splitBump = {
    sampleTerrain({ z }) {
      return {
        height: z > 35.2 ? 0.08 : 0,
        normal: new THREE.Vector3(0, 1, 0),
        surface: TARMAC,
      };
    },
  };

  car.update(DT, splitBump);
  const [frontLeft, frontRight, rearLeft, rearRight] =
    car.telemetry.wheelLoads;
  assert.ok(frontLeft > frontRight * 2);
  assert.ok(rearLeft > rearRight * 2);
  assert.ok(car.rollRate < 0, "a left bump should begin rolling the chassis right");
});

test("the car becomes airborne and its springs absorb a landing", () => {
  const car = freshCar();
  car.group.position.y += 2.5;
  let sawAir = false;
  let peakWheelLoad = 0;

  for (let step = 0; step < 300; step++) {
    car.update(DT, TARMAC);
    sawAir ||= car.telemetry.airborne;
    peakWheelLoad = Math.max(
      peakWheelLoad,
      ...car.telemetry.wheelLoads
    );
  }

  assert.ok(sawAir, "all four wheels should leave the ground");
  assert.ok(
    peakWheelLoad > (920 * 9.81) / 2,
    `landing peak of ${peakWheelLoad} N should exceed static corner load`
  );
  assert.ok(
    peakWheelLoad < ((PHYSICS.mass * 9.81) / 4) * 16,
    `landing peak of ${peakWheelLoad} N is implausibly severe`
  );
  assert.equal(car.telemetry.wheelsGrounded, 4);
  assert.ok(Number.isFinite(car.pitch));
  assert.ok(Number.isFinite(car.roll));
});

test("rendered terrain features share one continuous physics height field", () => {
  const terrain = Object.create(World.prototype);
  const rampTop =
    terrain.getHeightAt(0, 0) - terrain.baseHeightAt(0, 0);
  const innerKerbRadius = 28.18;
  const kerbTop =
    terrain.getHeightAt(innerKerbRadius, 0) -
    terrain.baseHeightAt(innerKerbRadius, 0);
  const sample = terrain.sampleTerrain({ x: 0, z: -7 });

  assert.ok(rampTop > 2.3, `ramp height was only ${rampTop} m`);
  assert.ok(kerbTop > 0.1, `kerb height was only ${kerbTop} m`);
  assert.ok(Math.abs(sample.normal.length() - 1) < 1e-9);
  assert.equal(sample.surface.name, "TARMAC");
});

test("the centre ramp can launch the car and return all four tyres to ground", () => {
  const terrain = Object.create(World.prototype);
  const car = new Car(new THREE.Scene(), terrain);
  car.heading = 0;
  car.group.rotation.set(0, 0, 0);
  car.group.position.set(
    0,
    terrain.getHeightAt(0, -14) + 0.77,
    -14
  );
  car.velocity.set(0, 0, 18);
  let sawAir = false;
  let landed = false;

  for (let step = 0; step < 360; step++) {
    car.update(DT, terrain);
    if (car.telemetry.airborne) sawAir = true;
    if (sawAir && car.telemetry.wheelsGrounded === 4) landed = true;
  }

  assert.ok(sawAir, "the ramp should unload all four tyres");
  assert.ok(landed, "the car should settle back onto all four tyres");
  assert.ok(car.group.position.z > 20, "the car should clear the ramp");
});
