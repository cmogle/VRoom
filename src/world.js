import * as THREE from "three";

// ---------------------------------------------------------------
// The world: a big sandy plain, a painted track ring, cones you
// can knock over, and some blocky trees for scenery.
// ---------------------------------------------------------------

const COLOURS = {
  sky: 0xf2ede3,
  ground: 0xe8ddc8,
  track: 0x39423f,
  stripe: 0xf2ede3,
  cone: 0xd44d2e,
  coneBand: 0xf2ede3,
  trunk: 0x6b5642,
  leaves: 0x2a6f6f,
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.cones = [];

    scene.background = new THREE.Color(COLOURS.sky);
    scene.fog = new THREE.Fog(COLOURS.sky, 90, 220);

    this.addLights();
    this.addGround();
    this.addTrack();
    this.addCones();
    this.addTrees();
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
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshStandardMaterial({ color: COLOURS.ground, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  addTrack() {
    // a flat painted ring — drive laps around it
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(28, 42, 64),
      new THREE.MeshStandardMaterial({ color: COLOURS.track, roughness: 0.9 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    ring.receiveShadow = true;
    this.scene.add(ring);

    // start/finish stripe
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 1.6),
      new THREE.MeshStandardMaterial({ color: COLOURS.stripe, roughness: 0.9 })
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.02, 35);
    this.scene.add(stripe);
  }

  addCones() {
    const coneGeo = new THREE.ConeGeometry(0.35, 0.9, 12);
    const coneMat = new THREE.MeshStandardMaterial({ color: COLOURS.cone, roughness: 0.6 });
    const bandGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.14, 12);
    const bandMat = new THREE.MeshStandardMaterial({ color: COLOURS.coneBand });

    // a slalom line of cones through the middle of the ring
    const spots = [];
    for (let i = -3; i <= 3; i++) {
      spots.push([i * 5, i % 2 === 0 ? 2 : -2]);
    }
    // and a cluster near the start line, begging to be hit
    spots.push([-2, 30], [0, 29], [2, 30]);

    for (const [x, z] of spots) {
      const cone = new THREE.Group();
      const body = new THREE.Mesh(coneGeo, coneMat);
      body.position.y = 0.45;
      body.castShadow = true;
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.y = 0.5;
      cone.add(body, band);
      cone.position.set(x, 0, z);
      this.scene.add(cone);
      this.cones.push({ group: cone, hit: false, vel: new THREE.Vector3(), spin: 0 });
    }
  }

  addTrees() {
    const trunkGeo = new THREE.BoxGeometry(0.6, 2.2, 0.6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: COLOURS.trunk, roughness: 1 });
    const leafGeo = new THREE.BoxGeometry(2.4, 3.2, 2.4);
    const leafMat = new THREE.MeshStandardMaterial({ color: COLOURS.leaves, roughness: 0.8 });

    // scattered around outside the track, deterministic so it looks
    // the same every visit
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2;
      const radius = 55 + ((i * 37) % 40);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.y = 3.6;
      leaves.castShadow = true;
      tree.add(trunk, leaves);
      tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      tree.rotation.y = i * 1.3;
      this.scene.add(tree);
    }
  }

  // Called every frame: cones get punted if the car touches them.
  update(dt, car) {
    const carPos = car.group.position;
    for (const cone of this.cones) {
      if (!cone.hit) {
        const dist = cone.group.position.distanceTo(carPos);
        if (dist < 1.6 && car.velocity.length() > 2) {
          cone.hit = true;
          // fly away from the car, plus inherit some of its speed
          const away = cone.group.position.clone().sub(carPos).normalize();
          cone.vel.copy(away).multiplyScalar(6).addScaledVector(car.velocity, 0.5);
          cone.vel.y = 5;
          cone.spin = (Math.random() - 0.5) * 12;
        }
      } else {
        // simple tumble physics
        cone.vel.y -= 20 * dt; // gravity
        cone.group.position.addScaledVector(cone.vel, dt);
        cone.group.rotation.x += cone.spin * dt;
        cone.group.rotation.z += cone.spin * 0.7 * dt;
        if (cone.group.position.y < 0) {
          cone.group.position.y = 0;
          cone.vel.set(0, 0, 0);
          cone.spin = 0;
        }
      }
    }
  }
}
