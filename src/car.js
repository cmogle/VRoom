import * as THREE from "three";
import { input } from "./input.js";

// ---------------------------------------------------------------------------
// Four-corner vehicle model
//
// The chassis is a small 3D rigid body. Each wheel samples the terrain beneath
// it independently, supports the body through its own spring and damper, and
// gets a tyre-force budget from the resulting normal load. The model remains
// intentionally compact, but it now has the ingredients needed for kerbs,
// bumps, ramps, jumps, load transfer and asymmetric landings.
// ---------------------------------------------------------------------------

const GRAVITY = 9.81;
const AIR_DENSITY = 1.225;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

export const PHYSICS = {
  mass: 920, // kg
  yawInertia: 1450, // kg m²
  pitchInertia: 1720,
  rollInertia: 610,
  cgHeight: 0.52, // distance from the CG to a nominal contact patch
  cgToFrontAxle: 1.42,
  cgToRearAxle: 1.38,
  halfTrack: 0.85,

  wheelRadius: 0.42,
  suspensionRestLength: 0.46,
  suspensionMinLength: 0.19,
  suspensionMaxLength: 0.53,
  frontSpringRate: 19000, // N/m, per corner
  rearSpringRate: 19500,
  frontDamperRate: 3150, // N per m/s, per corner
  rearDamperRate: 3250,
  bumpStopRate: 72000,
  maxSuspensionForce: 65000,
  angularDamping: 0.72,

  maxSteerAngle: 0.48,
  steeringLateralG: 0.8,
  steeringResponse: 9,
  engineForce: 7900,
  reverseForce: 3900,
  enginePower: 178000,
  brakeForce: 12500,
  handbrakeForce: 5200,
  brakeBiasFront: 0.62,

  frontCorneringStiffness: 61000,
  rearCorneringStiffness: 66000,
  roadFriction: 1.18,
  handbrakeRearGrip: 0.36,

  dragArea: 0.72,
  downforceArea: 1.25,
  rollingResistance: 165,
};

const AVERAGE_SPRING_RATE =
  (PHYSICS.frontSpringRate + PHYSICS.rearSpringRate) * 0.5;
const STATIC_SPRING_COMPRESSION =
  (PHYSICS.mass * GRAVITY) / (4 * AVERAGE_SPRING_RATE);
const STATIC_RIDE_HEIGHT =
  PHYSICS.wheelRadius +
  PHYSICS.suspensionRestLength -
  STATIC_SPRING_COMPRESSION;

const FLAT_TARMAC = {
  name: "TARMAC",
  friction: PHYSICS.roadFriction,
  rollingResistance: 0,
};

const COLOURS = {
  body: 0xd44d2e,
  nose: 0xf2ede3,
  wing: 0x1c2321,
  wheel: 0x14100e,
  hub: 0xb8b2a6,
  driver: 0x2a6f6f,
  spring: 0xd7d1c5,
  loadedSpring: 0xe7a257,
};

function limitTyreForces(longitudinal, lateralRequest, capacity) {
  // Scale the complete force request onto the friction circle. Giving engine
  // force absolute priority used to leave a powered rear tyre with no lateral
  // authority, so tiny bumps rapidly became unrecoverable spins.
  if (capacity <= 0) {
    return { longitudinal: 0, lateral: 0, utilisation: 0 };
  }
  const requestedMagnitude = Math.hypot(longitudinal, lateralRequest);
  const forceScale =
    requestedMagnitude > capacity ? capacity / requestedMagnitude : 1;
  const fx = longitudinal * forceScale;
  const fy = lateralRequest * forceScale;
  return {
    longitudinal: fx,
    lateral: fy,
    utilisation: Math.hypot(fx, fy) / capacity,
  };
}

export function getSteeringLimit(speed) {
  const wheelbase = PHYSICS.cgToFrontAxle + PHYSICS.cgToRearAxle;
  const lateralAcceleration = PHYSICS.steeringLateralG * GRAVITY;
  const gripLimitedAngle = Math.atan(
    (lateralAcceleration * wheelbase) /
      Math.max(speed * speed, 0.5)
  );
  return Math.min(PHYSICS.maxSteerAngle, gripLimitedAngle);
}

function safeTerrainSample(terrain, x, z) {
  if (terrain && typeof terrain.sampleTerrain === "function") {
    const sample = terrain.sampleTerrain({ x, z });
    return {
      height: Number.isFinite(sample.height) ? sample.height : 0,
      normal:
        sample.normal instanceof THREE.Vector3
          ? sample.normal.clone().normalize()
          : new THREE.Vector3(0, 1, 0),
      surface: sample.surface ?? FLAT_TARMAC,
    };
  }

  // Passing a surface directly is kept as a useful, backwards-compatible way
  // to run the force model on an infinite flat test pad.
  const surface =
    terrain && Number.isFinite(terrain.friction) ? terrain : FLAT_TARMAC;
  return {
    height: 0,
    normal: new THREE.Vector3(0, 1, 0),
    surface,
  };
}

function dominantSurface(wheels, fallback) {
  const counts = new Map();
  for (const wheel of wheels) {
    if (!wheel.grounded) continue;
    const name = wheel.surface.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return wheels.every((wheel) => !wheel.grounded) ? "AIR" : fallback;
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export class Car {
  constructor(scene, terrain = null) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.rotation.order = "YXZ";
    this.bodyRoot = new THREE.Group();
    this.group.add(this.bodyRoot);

    // World-space linear state, plus the three rotations that matter to a car.
    // Heading zero points along +Z.
    this.velocity = new THREE.Vector3();
    this.heading = Math.PI / 2;
    this.yawRate = 0;
    this.pitch = 0;
    this.pitchRate = 0;
    this.roll = 0;
    this.rollRate = 0;
    this.steerAngle = 0;
    this.longitudinalAcceleration = 0;
    this.spawn = new THREE.Vector3(0, 0, 35);
    this.spawnHeading = Math.PI / 2;

    this.telemetry = {
      surface: "TARMAC",
      speedKmh: 0,
      longitudinalG: 0,
      lateralG: 0,
      verticalG: 0,
      frontSlipDeg: 0,
      rearSlipDeg: 0,
      gripUsed: 0,
      downforce: 0,
      weightFront: 49,
      weightRear: 51,
      wheelLoads: [0, 0, 0, 0],
      suspensionTravel: [0, 0, 0, 0],
      wheelsGrounded: 4,
      airborne: false,
      rideHeight: STATIC_RIDE_HEIGHT,
    };

    this.buildBody();
    scene.add(this.group);
    this.resetPosition();
  }

  buildBody() {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: COLOURS.body,
      roughness: 0.4,
    });
    const noseMat = new THREE.MeshStandardMaterial({
      color: COLOURS.nose,
      roughness: 0.5,
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: COLOURS.wing,
      roughness: 0.6,
    });
    const wheelMat = new THREE.MeshStandardMaterial({
      color: COLOURS.wheel,
      roughness: 0.9,
    });
    const hubMat = new THREE.MeshStandardMaterial({
      color: COLOURS.hub,
      metalness: 0.6,
      roughness: 0.3,
    });
    const driverMat = new THREE.MeshStandardMaterial({
      color: COLOURS.driver,
      roughness: 0.4,
    });
    const springMat = new THREE.MeshStandardMaterial({
      color: COLOURS.spring,
      metalness: 0.55,
      roughness: 0.28,
    });

    // The group origin is now the centre of mass rather than ground level.
    const yFromGround = (height) => height - STATIC_RIDE_HEIGHT;

    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 3.2), bodyMat);
    tub.position.y = yFromGround(0.45);
    tub.castShadow = true;
    this.bodyRoot.add(tub);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 1.1), noseMat);
    nose.position.set(0, yFromGround(0.42), 2.0);
    nose.castShadow = true;
    this.bodyRoot.add(nose);

    const frontWing = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.08, 0.5),
      wingMat
    );
    frontWing.position.set(0, yFromGround(0.28), 2.45);
    frontWing.castShadow = true;
    this.bodyRoot.add(frontWing);

    const rearWing = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.08, 0.45),
      wingMat
    );
    rearWing.position.set(0, yFromGround(1.05), -1.65);
    rearWing.castShadow = true;
    this.bodyRoot.add(rearWing);
    for (const x of [-0.5, 0.5]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.4, 0.08),
        wingMat
      );
      post.position.set(x, yFromGround(0.85), -1.65);
      this.bodyRoot.add(post);
    }

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 16, 12),
      driverMat
    );
    helmet.position.set(0, yFromGround(0.85), -0.35);
    helmet.castShadow = true;
    this.bodyRoot.add(helmet);

    this.wheels = [];
    this.frontWheels = [];
    const wheelGeo = new THREE.CylinderGeometry(
      PHYSICS.wheelRadius,
      PHYSICS.wheelRadius,
      0.4,
      20
    );
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const strutGeo = new THREE.CylinderGeometry(0.035, 0.045, 1, 8);

    const positions = [
      { name: "FL", x: -PHYSICS.halfTrack, z: PHYSICS.cgToFrontAxle, front: true },
      { name: "FR", x: PHYSICS.halfTrack, z: PHYSICS.cgToFrontAxle, front: true },
      { name: "RL", x: -PHYSICS.halfTrack, z: -PHYSICS.cgToRearAxle, front: false },
      { name: "RR", x: PHYSICS.halfTrack, z: -PHYSICS.cgToRearAxle, front: false },
    ];

    for (const position of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(
        position.x,
        -PHYSICS.suspensionRestLength,
        position.z
      );
      const tyre = new THREE.Mesh(wheelGeo, wheelMat);
      tyre.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat);
      pivot.add(tyre, hub);
      this.bodyRoot.add(pivot);

      const strut = new THREE.Mesh(strutGeo, springMat.clone());
      strut.position.set(
        position.x,
        -PHYSICS.suspensionRestLength * 0.5,
        position.z
      );
      strut.scale.y = PHYSICS.suspensionRestLength;
      strut.castShadow = true;
      this.bodyRoot.add(strut);

      const wheel = {
        ...position,
        localPosition: new THREE.Vector3(position.x, 0, position.z),
        pivot,
        tyre,
        hub,
        strut,
        springRate: position.front
          ? PHYSICS.frontSpringRate
          : PHYSICS.rearSpringRate,
        damperRate: position.front
          ? PHYSICS.frontDamperRate
          : PHYSICS.rearDamperRate,
        compression: STATIC_SPRING_COMPRESSION,
        previousCompression: STATIC_SPRING_COMPRESSION,
        suspensionLength:
          PHYSICS.suspensionRestLength - STATIC_SPRING_COMPRESSION,
        grounded: true,
        normalLoad: (PHYSICS.mass * GRAVITY) / 4,
        surface: FLAT_TARMAC,
        terrainNormal: new THREE.Vector3(0, 1, 0),
        contactPoint: new THREE.Vector3(),
        slipAngle: 0,
        gripUtilisation: 0,
        longitudinalSpeed: 0,
      };

      this.wheels.push(wheel);
      if (position.front) this.frontWheels.push(wheel);
    }
  }

  resetPosition() {
    const sample = safeTerrainSample(
      this.terrain,
      this.spawn.x,
      this.spawn.z
    );
    this.group.position.set(
      this.spawn.x,
      sample.height + STATIC_RIDE_HEIGHT,
      this.spawn.z
    );
    this.velocity.set(0, 0, 0);
    this.heading = this.spawnHeading;
    this.yawRate = 0;
    this.pitch = 0;
    this.pitchRate = 0;
    this.roll = 0;
    this.rollRate = 0;
    this.steerAngle = 0;
    this.longitudinalAcceleration = 0;
    this.group.rotation.set(0, this.heading, 0);
    this.bodyRoot.rotation.set(0, 0, 0);

    for (const wheel of this.wheels) {
      wheel.compression = STATIC_SPRING_COMPRESSION;
      wheel.previousCompression = STATIC_SPRING_COMPRESSION;
      wheel.slipAngle = 0;
      wheel.gripUtilisation = 0;
      wheel.longitudinalSpeed = 0;
    }

    // Prime every corner from its own terrain height. Without this, the first
    // physics step interpreted ordinary slope differences as enormous damper
    // velocities and could momentarily unload half the car.
    const forward = new THREE.Vector3(
      Math.sin(this.heading),
      0,
      Math.cos(this.heading)
    );
    const right = new THREE.Vector3(
      Math.cos(this.heading),
      0,
      -Math.sin(this.heading)
    );
    this.updateSuspension(
      1 / 120,
      this.terrain ?? FLAT_TARMAC,
      forward,
      right,
      true
    );
    this.updateWheelVisuals(0);
  }

  updateSuspension(dt, terrain, forward, right, prime = false) {
    for (const wheel of this.wheels) {
      const worldX =
        this.group.position.x +
        right.x * wheel.x +
        forward.x * wheel.z;
      const worldZ =
        this.group.position.z +
        right.z * wheel.x +
        forward.z * wheel.z;
      const sample = safeTerrainSample(terrain, worldX, worldZ);

      // Positive pitch lowers the nose; positive roll lifts the right side.
      const mountHeight =
        this.group.position.y -
        Math.sin(this.pitch) * wheel.z +
        Math.sin(this.roll) * wheel.x;
      const rawLength =
        mountHeight - (sample.height + PHYSICS.wheelRadius);
      const compression = PHYSICS.suspensionRestLength - rawLength;
      const grounded = rawLength <= PHYSICS.suspensionMaxLength;
      const compressionSpeed = prime
        ? 0
        : (compression - wheel.previousCompression) / Math.max(dt, 1e-4);

      let normalLoad = 0;
      if (grounded) {
        normalLoad =
          wheel.springRate * Math.max(compression, 0) +
          wheel.damperRate * compressionSpeed;
        if (rawLength < PHYSICS.suspensionMinLength) {
          normalLoad +=
            (PHYSICS.suspensionMinLength - rawLength) *
            PHYSICS.bumpStopRate;
        }
        normalLoad = clamp(normalLoad, 0, PHYSICS.maxSuspensionForce);
      }

      wheel.compression = compression;
      wheel.previousCompression = compression;
      wheel.suspensionLength = grounded
        ? clamp(
            rawLength,
            PHYSICS.suspensionMinLength * 0.55,
            PHYSICS.suspensionMaxLength
          )
        : PHYSICS.suspensionRestLength;
      wheel.grounded = grounded && normalLoad > 0;
      wheel.normalLoad = wheel.grounded ? normalLoad : 0;
      wheel.surface = sample.surface;
      wheel.terrainNormal.copy(sample.normal);
      wheel.contactPoint.set(
        worldX,
        sample.height + 0.025,
        worldZ
      );
    }
  }

  update(dt, terrain = this.terrain ?? FLAT_TARMAC) {
    if (input.reset) this.resetPosition();
    this.terrain =
      terrain && typeof terrain.sampleTerrain === "function"
        ? terrain
        : this.terrain;

    const forward = new THREE.Vector3(
      Math.sin(this.heading),
      0,
      Math.cos(this.heading)
    );
    const right = new THREE.Vector3(
      Math.cos(this.heading),
      0,
      -Math.sin(this.heading)
    );
    const horizontalVelocity = this.velocity.clone();
    horizontalVelocity.y = 0;
    const forwardSpeed = horizontalVelocity.dot(forward);
    const speed = horizontalVelocity.length();

    const steerInput = Number(input.right) - Number(input.left);
    const steerTarget = steerInput * getSteeringLimit(Math.abs(forwardSpeed));
    this.steerAngle = THREE.MathUtils.damp(
      this.steerAngle,
      steerTarget,
      PHYSICS.steeringResponse,
      dt
    );

    let throttle = 0;
    let brake = 0;
    if (input.forward) {
      if (forwardSpeed < -0.8) brake = 1;
      else throttle = 1;
    }
    if (input.backward) {
      if (forwardSpeed > 0.8) brake = 1;
      else throttle = -1;
    }

    this.updateSuspension(dt, terrain, forward, right);

    const downforce =
      0.5 * AIR_DENSITY * PHYSICS.downforceArea * speed * speed;
    const totalForce = new THREE.Vector3(
      0,
      -PHYSICS.mass * GRAVITY - downforce,
      0
    );
    let yawTorque = 0;
    let pitchTorque = 0;
    let rollTorque = 0;

    // The four terrain reactions are independent. This is where a single kerb
    // or one-wheel landing turns into body roll and pitch instead of a visual
    // animation applied after the fact.
    for (const wheel of this.wheels) {
      if (!wheel.grounded) continue;
      const supportForce = wheel.terrainNormal
        .clone()
        .multiplyScalar(wheel.normalLoad);
      totalForce.add(supportForce);
      const supportRight = supportForce.dot(right);
      const supportForward = supportForce.dot(forward);
      yawTorque +=
        wheel.z * supportRight - wheel.x * supportForward;
      pitchTorque +=
        -wheel.z * supportForce.y -
        PHYSICS.cgHeight * supportForward;
      rollTorque +=
        wheel.x * supportForce.y +
        PHYSICS.cgHeight * supportRight;
    }

    const engineLimit =
      throttle >= 0
        ? Math.min(
            PHYSICS.engineForce,
            PHYSICS.enginePower / Math.max(Math.abs(forwardSpeed), 7)
          )
        : PHYSICS.reverseForce;
    const rearDrivePerWheel = (throttle * engineLimit) / 2;
    const motionDirection =
      Math.abs(forwardSpeed) > 0.25
        ? Math.sign(forwardSpeed)
        : Math.sign(throttle || 1);
    const brakingForce =
      -motionDirection * brake * PHYSICS.brakeForce;
    const frontBrakePerWheel =
      (brakingForce * PHYSICS.brakeBiasFront) / 2;
    const rearBrakePerWheel =
      (brakingForce * (1 - PHYSICS.brakeBiasFront)) / 2;

    let maximumGripUse = 0;
    const lowSpeedBlend = clamp(
      (Math.abs(forwardSpeed) - 0.35) / 2.5,
      0,
      1
    );
    const staticCornerLoad = (PHYSICS.mass * GRAVITY) / 4;

    for (const wheel of this.wheels) {
      const steer = wheel.front ? this.steerAngle : 0;
      const desiredForward = forward
        .clone()
        .multiplyScalar(Math.cos(steer))
        .addScaledVector(right, Math.sin(steer));
      const wheelForward = desiredForward.projectOnPlane(
        wheel.terrainNormal
      );
      if (wheelForward.lengthSq() < 1e-8) wheelForward.copy(forward);
      wheelForward.normalize();
      const wheelRight = wheel.terrainNormal
        .clone()
        .cross(wheelForward)
        .normalize();

      const wheelVelocity = this.velocity.clone().add(
        new THREE.Vector3(
          this.yawRate * (right.x * wheel.z + forward.x * -wheel.x),
          0,
          this.yawRate * (right.z * wheel.z + forward.z * -wheel.x)
        )
      );
      const longitudinalSpeed = wheelVelocity.dot(wheelForward);
      const lateralSpeed = wheelVelocity.dot(wheelRight);
      wheel.longitudinalSpeed = longitudinalSpeed;
      const slipAngle = clamp(
        Math.atan2(
          lateralSpeed,
          Math.max(Math.abs(longitudinalSpeed), 1.2)
        ) * lowSpeedBlend,
        -0.65,
        0.65
      );
      // Velocity is already measured in the steered wheel's own frame, so the
      // resulting angle is the contact patch's complete slip angle.
      wheel.slipAngle = slipAngle;

      let longitudinalRequest = wheel.front
        ? frontBrakePerWheel
        : rearDrivePerWheel + rearBrakePerWheel;
      let gripMultiplier = 1;
      if (
        !wheel.front &&
        input.handbrake &&
        Math.abs(forwardSpeed) > 1
      ) {
        longitudinalRequest -=
          (motionDirection * PHYSICS.handbrakeForce) / 2;
        gripMultiplier = PHYSICS.handbrakeRearGrip;
      }

      const surfaceGrip = wheel.surface.friction;
      const stiffnessScale = clamp(
        surfaceGrip / PHYSICS.roadFriction,
        0.35,
        1
      );
      const loadStiffness = clamp(
        0.62 + 0.38 * (wheel.normalLoad / staticCornerLoad),
        0.3,
        1.35
      );
      const axleStiffness = wheel.front
        ? PHYSICS.frontCorneringStiffness
        : PHYSICS.rearCorneringStiffness;
      const lateralRequest =
        -(axleStiffness / 2) *
        stiffnessScale *
        loadStiffness *
        wheel.slipAngle;
      const capacity =
        surfaceGrip * wheel.normalLoad * gripMultiplier;
      const tyre = wheel.grounded
        ? limitTyreForces(
            longitudinalRequest,
            lateralRequest,
            capacity
          )
        : { longitudinal: 0, lateral: 0, utilisation: 0 };
      wheel.gripUtilisation = tyre.utilisation;
      maximumGripUse = Math.max(maximumGripUse, tyre.utilisation);

      const tyreForce = wheelForward
        .clone()
        .multiplyScalar(tyre.longitudinal)
        .addScaledVector(wheelRight, tyre.lateral);
      totalForce.add(tyreForce);
      const tyreRight = tyreForce.dot(right);
      const tyreForward = tyreForce.dot(forward);
      yawTorque += wheel.z * tyreRight - wheel.x * tyreForward;
      pitchTorque -= PHYSICS.cgHeight * tyreForward;
      rollTorque += PHYSICS.cgHeight * tyreRight;

      if (wheel.grounded && speed > 0.08) {
        const rollingMagnitude =
          (PHYSICS.rollingResistance +
            wheel.surface.rollingResistance) *
          (wheel.normalLoad / (PHYSICS.mass * GRAVITY));
        totalForce.addScaledVector(
          wheelForward,
          -Math.sign(longitudinalSpeed || forwardSpeed || 1) *
            rollingMagnitude
        );
      }
    }

    const aerodynamicDrag =
      -0.5 *
      AIR_DENSITY *
      PHYSICS.dragArea *
      forwardSpeed *
      Math.abs(forwardSpeed);
    totalForce.addScaledVector(forward, aerodynamicDrag);

    const totalLongitudinal = totalForce.dot(forward);
    const totalLateral = totalForce.dot(right);
    const acceleration = totalForce.multiplyScalar(1 / PHYSICS.mass);
    this.velocity.addScaledVector(acceleration, dt);

    this.yawRate += (yawTorque / PHYSICS.yawInertia) * dt;
    this.pitchRate += (pitchTorque / PHYSICS.pitchInertia) * dt;
    this.rollRate += (rollTorque / PHYSICS.rollInertia) * dt;
    const angularDecay = Math.exp(-PHYSICS.angularDamping * dt);
    this.yawRate *= Math.exp(-0.16 * dt);
    this.pitchRate *= angularDecay;
    this.rollRate *= angularDecay;

    this.heading += this.yawRate * dt;
    this.pitch += this.pitchRate * dt;
    this.roll += this.rollRate * dt;
    this.pitch = clamp(this.pitch, -0.68, 0.68);
    this.roll = clamp(this.roll, -0.78, 0.78);
    if (Math.abs(this.pitch) === 0.68) this.pitchRate *= -0.2;
    if (Math.abs(this.roll) === 0.78) this.rollRate *= -0.2;

    this.group.position.addScaledVector(this.velocity, dt);

    // A shallow chassis guard prevents numerical tunnelling after extreme
    // nose-first impacts; ordinary landings are resolved entirely by springs.
    const centreTerrain = safeTerrainSample(
      terrain,
      this.group.position.x,
      this.group.position.z
    );
    const minimumCgHeight = centreTerrain.height + 0.28;
    if (this.group.position.y < minimumCgHeight) {
      this.group.position.y = minimumCgHeight;
      if (this.velocity.y < 0) this.velocity.y *= -0.12;
      this.pitchRate *= 0.55;
      this.rollRate *= 0.55;
    }

    if (
      speed < 0.12 &&
      Math.abs(this.velocity.y) < 0.08 &&
      throttle === 0 &&
      brake === 0
    ) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.yawRate = 0;
    }

    this.group.rotation.set(this.pitch, this.heading, this.roll);
    this.longitudinalAcceleration = THREE.MathUtils.damp(
      this.longitudinalAcceleration,
      totalLongitudinal / PHYSICS.mass,
      8,
      dt
    );
    this.updateWheelVisuals(dt);

    const frontWheels = this.wheels.filter((wheel) => wheel.front);
    const rearWheels = this.wheels.filter((wheel) => !wheel.front);
    const frontNormalLoad = frontWheels.reduce(
      (sum, wheel) => sum + wheel.normalLoad,
      0
    );
    const rearNormalLoad = rearWheels.reduce(
      (sum, wheel) => sum + wheel.normalLoad,
      0
    );
    const combinedLoad = frontNormalLoad + rearNormalLoad;
    const averageSlip = (wheels) => {
      const loaded = wheels.filter((wheel) => wheel.grounded);
      if (loaded.length === 0) return 0;
      return (
        loaded.reduce((sum, wheel) => sum + wheel.slipAngle, 0) /
        loaded.length
      );
    };
    const wheelsGrounded = this.wheels.filter(
      (wheel) => wheel.grounded
    ).length;

    this.telemetry = {
      surface: dominantSurface(this.wheels, centreTerrain.surface.name),
      speedKmh: Math.round(speed * 3.6),
      longitudinalG: totalLongitudinal / (PHYSICS.mass * GRAVITY),
      lateralG: totalLateral / (PHYSICS.mass * GRAVITY),
      verticalG: acceleration.y / GRAVITY,
      frontSlipDeg: THREE.MathUtils.radToDeg(
        averageSlip(frontWheels)
      ),
      rearSlipDeg: THREE.MathUtils.radToDeg(
        averageSlip(rearWheels)
      ),
      gripUsed: maximumGripUse,
      downforce,
      weightFront:
        combinedLoad > 1
          ? (frontNormalLoad / combinedLoad) * 100
          : this.telemetry.weightFront,
      weightRear:
        combinedLoad > 1
          ? (rearNormalLoad / combinedLoad) * 100
          : this.telemetry.weightRear,
      wheelLoads: this.wheels.map((wheel) =>
        Math.round(wheel.normalLoad)
      ),
      suspensionTravel: this.wheels.map((wheel) =>
        Math.round(Math.max(0, wheel.compression) * 1000)
      ),
      wheelsGrounded,
      airborne: wheelsGrounded === 0,
      rideHeight: this.group.position.y - centreTerrain.height,
    };
  }

  updateWheelVisuals(dt) {
    for (const wheel of this.wheels) {
      const visualLength = clamp(
        wheel.suspensionLength,
        PHYSICS.suspensionMinLength * 0.55,
        PHYSICS.suspensionMaxLength
      );
      wheel.pivot.position.y = -visualLength;
      wheel.pivot.rotation.y = wheel.front ? this.steerAngle : 0;
      wheel.strut.position.y = -visualLength * 0.5;
      wheel.strut.scale.y = visualLength;
      const loadRatio = wheel.normalLoad / ((PHYSICS.mass * GRAVITY) / 4);
      wheel.strut.material.color.setHex(
        loadRatio > 1.35 ? COLOURS.loadedSpring : COLOURS.spring
      );

      if (dt > 0) {
        const wheelSpin =
          (wheel.longitudinalSpeed * dt) / PHYSICS.wheelRadius;
        wheel.tyre.rotation.x += wheelSpin;
        wheel.hub.rotation.x += wheelSpin;
      }
    }
  }

  getRearContactPoints() {
    return this.wheels
      .filter((wheel) => !wheel.front)
      .map((wheel) => wheel.contactPoint.clone());
  }

  get speedKmh() {
    return this.telemetry.speedKmh;
  }
}
