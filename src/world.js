import * as THREE from "three";

// ---------------------------------------------------------------------------
// A continuous 3D driving surface.
//
// Visual meshes and physics contacts both use the same analytic height
// function. That keeps the tyres on what the player can see, including the
// rolling ground, raised kerbs, speed bumps and the centre test ramp.
// ---------------------------------------------------------------------------

const COLOURS = {
  sky: 0xf2ede3,
  ground: 0xe8ddc8,
  track: 0x39423f,
  stripe: 0xf2ede3,
  kerbRed: 0xd44d2e,
  kerbWhite: 0xf2ede3,
  ramp: 0x303936,
  rampEdge: 0xe7a257,
  cone: 0xd44d2e,
  coneBand: 0xf2ede3,
  trunk: 0x6b5642,
  leaves: 0x2a6f6f,
};

export const SURFACES = {
  tarmac: {
    name: "TARMAC",
    friction: 1.18,
    rollingResistance: 0,
  },
  sand: {
    name: "SAND",
    friction: 0.58,
    rollingResistance: 760,
  },
};

const TRACK_INNER_RADIUS = 28;
const TRACK_OUTER_RADIUS = 42;
const TRACK_CENTRE_RADIUS = (TRACK_INNER_RADIUS + TRACK_OUTER_RADIUS) / 2;
const RAMP = {
  halfWidth: 4.1,
  startZ: -12,
  topStartZ: -3.2,
  dropStartZ: 1.2,
  endZ: 2.25,
  height: 2.35,
};
const MAX_SKID_SEGMENTS = 1800;
const clamp = THREE.MathUtils.clamp;

function smootherStep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function cosineBump(distance, halfWidth) {
  if (Math.abs(distance) >= halfWidth) return 0;
  return 0.5 + 0.5 * Math.cos((Math.PI * distance) / halfWidth);
}

function angularDistance(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function updateGeometryHeights(geometry, heightAt, yOffset = 0) {
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const z = position.getZ(index);
    position.setY(index, heightAt(x, z) + yOffset);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.cones = [];
    this.skidTimer = 0;
    this.previousSkidPoints = null;

    scene.background = new THREE.Color(COLOURS.sky);
    scene.fog = new THREE.Fog(COLOURS.sky, 90, 220);

    this.addLights();
    this.addGround();
    this.addTrack();
    this.addKerbs();
    this.addRampSurface();
    this.addCones();
    this.addTrees();
    this.addSkidMarks();
  }

  baseHeightAt(x, z) {
    // Broad, low-frequency undulations make the whole site genuinely 3D while
    // leaving the track readable and driveable.
    return (
      Math.sin(x * 0.031) * 0.15 +
      Math.cos(z * 0.038) * 0.11 +
      Math.sin((x + z) * 0.024) * 0.08
    );
  }

  rampHeightAt(x, z) {
    const absoluteX = Math.abs(x);
    if (
      absoluteX >= RAMP.halfWidth ||
      z <= RAMP.startZ ||
      z >= RAMP.endZ
    ) {
      return 0;
    }

    const lateralShape =
      1 -
      smootherStep(
        RAMP.halfWidth - 0.7,
        RAMP.halfWidth,
        absoluteX
      );
    let longitudinalShape = 0;
    if (z < RAMP.topStartZ) {
      longitudinalShape = smootherStep(
        RAMP.startZ,
        RAMP.topStartZ,
        z
      );
    } else if (z <= RAMP.dropStartZ) {
      longitudinalShape = 1;
    } else {
      // The short back face lets the suspension unload at speed and turns the
      // feature into a real jump instead of merely a hill.
      longitudinalShape =
        1 -
        smootherStep(RAMP.dropStartZ, RAMP.endZ, z);
    }
    return RAMP.height * lateralShape * longitudinalShape;
  }

  kerbHeightAt(x, z) {
    const radius = Math.hypot(x, z);
    const inner = cosineBump(radius - (TRACK_INNER_RADIUS + 0.18), 0.48);
    const outer = cosineBump(radius - (TRACK_OUTER_RADIUS - 0.18), 0.48);
    return Math.max(inner, outer) * 0.115;
  }

  bumpHeightAt(x, z) {
    const radius = Math.hypot(x, z);
    if (
      radius < TRACK_INNER_RADIUS + 0.7 ||
      radius > TRACK_OUTER_RADIUS - 0.7
    ) {
      return 0;
    }
    const angle = Math.atan2(z, x);
    const first = cosineBump(
      angularDistance(angle, -0.58) * TRACK_CENTRE_RADIUS,
      0.58
    );
    const second = cosineBump(
      angularDistance(angle, -0.64) * TRACK_CENTRE_RADIUS,
      0.58
    );
    return Math.max(first, second) * 0.075;
  }

  getHeightAt(x, z) {
    return (
      this.baseHeightAt(x, z) +
      this.kerbHeightAt(x, z) +
      this.bumpHeightAt(x, z) +
      this.rampHeightAt(x, z)
    );
  }

  isRampAt(x, z) {
    return (
      Math.abs(x) < RAMP.halfWidth &&
      z > RAMP.startZ &&
      z < RAMP.endZ &&
      this.rampHeightAt(x, z) > 0.012
    );
  }

  getSurfaceAt(position) {
    const radius = Math.hypot(position.x, position.z);
    return (
      (radius >= TRACK_INNER_RADIUS - 0.3 &&
        radius <= TRACK_OUTER_RADIUS + 0.3) ||
      this.isRampAt(position.x, position.z)
    )
      ? SURFACES.tarmac
      : SURFACES.sand;
  }

  sampleTerrain(position) {
    const x = position.x;
    const z = position.z;
    const epsilon = 0.08;
    const height = this.getHeightAt(x, z);
    const dx =
      (this.getHeightAt(x + epsilon, z) -
        this.getHeightAt(x - epsilon, z)) /
      (2 * epsilon);
    const dz =
      (this.getHeightAt(x, z + epsilon) -
        this.getHeightAt(x, z - epsilon)) /
      (2 * epsilon);
    return {
      height,
      normal: new THREE.Vector3(-dx, 1, -dz).normalize(),
      surface: this.getSurfaceAt(position),
    };
  }

  addLights() {
    const sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
    sun.position.set(40, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    this.scene.add(sun);

    const ambient = new THREE.AmbientLight(0xe8e4da, 1.1);
    this.scene.add(ambient);
  }

  addGround() {
    const geometry = new THREE.PlaneGeometry(500, 500, 180, 180);
    geometry.rotateX(-Math.PI / 2);
    updateGeometryHeights(
      geometry,
      // Sharp driveable features have their own dense overlays below. Keeping
      // the broad sand mesh to the base profile avoids coarse triangles
      // interpolating through a kerb and poking above the track.
      (x, z) => this.baseHeightAt(x, z)
    );
    const ground = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: COLOURS.ground,
        roughness: 1,
      })
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  addTrack() {
    const geometry = new THREE.RingGeometry(
      TRACK_INNER_RADIUS,
      TRACK_OUTER_RADIUS,
      256,
      18
    );
    geometry.rotateX(-Math.PI / 2);
    updateGeometryHeights(
      geometry,
      (x, z) => this.getHeightAt(x, z),
      0.018
    );
    const ring = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: COLOURS.track,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    ring.receiveShadow = true;
    this.scene.add(ring);

    const stripeGeometry = new THREE.PlaneGeometry(14, 1.6, 14, 3);
    stripeGeometry.rotateX(-Math.PI / 2);
    stripeGeometry.translate(0, 0, 35);
    updateGeometryHeights(
      stripeGeometry,
      (x, z) => this.getHeightAt(x, z),
      0.045
    );
    const stripe = new THREE.Mesh(
      stripeGeometry,
      new THREE.MeshStandardMaterial({
        color: COLOURS.stripe,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
    stripe.receiveShadow = true;
    this.scene.add(stripe);
  }

  createKerbGeometry(radius) {
    const segments = 128;
    const halfWidth = 0.36;
    const positions = [];
    const colours = [];
    const indices = [];
    const red = new THREE.Color(COLOURS.kerbRed);
    const white = new THREE.Color(COLOURS.kerbWhite);

    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const colour =
        Math.floor(segment / 4) % 2 === 0 ? red : white;
      for (const edgeRadius of [
        radius - halfWidth,
        radius + halfWidth,
      ]) {
        const x = Math.cos(angle) * edgeRadius;
        const z = Math.sin(angle) * edgeRadius;
        positions.push(x, this.getHeightAt(x, z) + 0.026, z);
        colours.push(colour.r, colour.g, colour.b);
      }
    }
    for (let segment = 0; segment < segments; segment++) {
      const start = segment * 2;
      indices.push(
        start,
        start + 2,
        start + 1,
        start + 2,
        start + 3,
        start + 1
      );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colours, 3)
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  addKerbs() {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    for (const radius of [
      TRACK_INNER_RADIUS + 0.18,
      TRACK_OUTER_RADIUS - 0.18,
    ]) {
      const kerb = new THREE.Mesh(
        this.createKerbGeometry(radius),
        material
      );
      kerb.receiveShadow = true;
      this.scene.add(kerb);
    }
  }

  addRampSurface() {
    const geometry = new THREE.PlaneGeometry(
      RAMP.halfWidth * 2,
      RAMP.endZ - RAMP.startZ,
      24,
      72
    );
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(
      0,
      0,
      (RAMP.startZ + RAMP.endZ) * 0.5
    );
    updateGeometryHeights(
      geometry,
      (x, z) => this.getHeightAt(x, z),
      0.022
    );
    const surface = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: COLOURS.ramp,
        roughness: 0.86,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
    surface.receiveShadow = true;
    this.scene.add(surface);

    // Bright edge rails make the launch direction legible from the chase cam.
    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: COLOURS.rampEdge,
      roughness: 0.7,
    });
    for (const x of [-RAMP.halfWidth + 0.13, RAMP.halfWidth - 0.13]) {
      const edgeGeometry = new THREE.PlaneGeometry(
        0.22,
        RAMP.endZ - RAMP.startZ,
        1,
        72
      );
      edgeGeometry.rotateX(-Math.PI / 2);
      edgeGeometry.translate(
        x,
        0,
        (RAMP.startZ + RAMP.endZ) * 0.5
      );
      updateGeometryHeights(
        edgeGeometry,
        (px, pz) => this.getHeightAt(px, pz),
        0.045
      );
      this.scene.add(new THREE.Mesh(edgeGeometry, edgeMaterial));
    }
  }

  addCones() {
    const coneGeo = new THREE.ConeGeometry(0.35, 0.9, 12);
    const coneMat = new THREE.MeshStandardMaterial({
      color: COLOURS.cone,
      roughness: 0.6,
    });
    const bandGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.14, 12);
    const bandMat = new THREE.MeshStandardMaterial({
      color: COLOURS.coneBand,
    });

    const spots = [];
    for (let i = -3; i <= 3; i++) {
      spots.push([i * 5, i % 2 === 0 ? 5 : -5]);
    }
    spots.push([-2, 30], [0, 29], [2, 30]);

    for (const [x, z] of spots) {
      const cone = new THREE.Group();
      const body = new THREE.Mesh(coneGeo, coneMat);
      body.position.y = 0.45;
      body.castShadow = true;
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.y = 0.5;
      cone.add(body, band);
      cone.position.set(x, this.getHeightAt(x, z), z);
      this.scene.add(cone);
      this.cones.push({
        group: cone,
        hit: false,
        vel: new THREE.Vector3(),
        spin: 0,
      });
    }
  }

  addTrees() {
    const trunkGeo = new THREE.BoxGeometry(0.6, 2.2, 0.6);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: COLOURS.trunk,
      roughness: 1,
    });
    const leafGeo = new THREE.BoxGeometry(2.4, 3.2, 2.4);
    const leafMat = new THREE.MeshStandardMaterial({
      color: COLOURS.leaves,
      roughness: 0.8,
    });

    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2;
      const radius = 55 + ((i * 37) % 40);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.y = 3.6;
      leaves.castShadow = true;
      tree.add(trunk, leaves);
      tree.position.set(x, this.getHeightAt(x, z), z);
      tree.rotation.y = i * 1.3;
      this.scene.add(tree);
    }
  }

  addSkidMarks() {
    this.skidPositions = new Float32Array(
      MAX_SKID_SEGMENTS * 2 * 3
    );
    this.skidGeometry = new THREE.BufferGeometry();
    this.skidGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.skidPositions, 3)
    );
    this.skidGeometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({
      color: 0x171918,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.skidLines = new THREE.LineSegments(
      this.skidGeometry,
      material
    );
    this.scene.add(this.skidLines);
    this.skidSegmentCount = 0;
  }

  updateSkidMarks(dt, car) {
    const rearSliding =
      Math.abs(car.telemetry.rearSlipDeg) > 7.5 &&
      car.telemetry.speedKmh > 24 &&
      car.telemetry.surface === "TARMAC" &&
      car.wheels
        .filter((wheel) => !wheel.front)
        .every((wheel) => wheel.grounded);

    if (!rearSliding) {
      this.previousSkidPoints = null;
      this.skidTimer = 0;
      return;
    }

    this.skidTimer += dt;
    if (this.skidTimer < 0.035) return;
    this.skidTimer = 0;

    const points = car.getRearContactPoints();
    if (this.previousSkidPoints) {
      for (let tyre = 0; tyre < 2; tyre++) {
        if (this.skidSegmentCount >= MAX_SKID_SEGMENTS) {
          this.skidSegmentCount = 0;
        }
        const offset = this.skidSegmentCount * 6;
        const from = this.previousSkidPoints[tyre];
        const to = points[tyre];
        this.skidPositions.set(
          [from.x, from.y, from.z, to.x, to.y, to.z],
          offset
        );
        this.skidSegmentCount += 1;
      }
      this.skidGeometry.attributes.position.needsUpdate = true;
      this.skidGeometry.setDrawRange(
        0,
        this.skidSegmentCount * 2
      );
      this.skidGeometry.computeBoundingSphere();
    }
    this.previousSkidPoints = points;
  }

  update(dt, car) {
    const carPos = car.group.position;
    for (const cone of this.cones) {
      if (!cone.hit) {
        const horizontalDistance = Math.hypot(
          cone.group.position.x - carPos.x,
          cone.group.position.z - carPos.z
        );
        if (horizontalDistance < 1.6 && car.velocity.length() > 2) {
          cone.hit = true;
          const away = cone.group.position
            .clone()
            .sub(carPos)
            .setY(0)
            .normalize();
          cone.vel
            .copy(away)
            .multiplyScalar(6)
            .addScaledVector(car.velocity, 0.5);
          cone.vel.y = 5;
          cone.spin = (Math.random() - 0.5) * 12;
        }
      } else {
        cone.vel.y -= 20 * dt;
        cone.group.position.addScaledVector(cone.vel, dt);
        cone.group.rotation.x += cone.spin * dt;
        cone.group.rotation.z += cone.spin * 0.7 * dt;
        const terrainHeight = this.getHeightAt(
          cone.group.position.x,
          cone.group.position.z
        );
        if (cone.group.position.y < terrainHeight) {
          cone.group.position.y = terrainHeight;
          cone.vel.set(0, 0, 0);
          cone.spin = 0;
        }
      }
    }
    this.updateSkidMarks(dt, car);
  }
}
