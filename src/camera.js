import * as THREE from "three";

// ---------------------------------------------------------------
// A chase camera that follows behind the car with a soft lag,
// which is what makes driving feel smooth instead of robotic.
// ---------------------------------------------------------------

export class ChaseCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );
    this.currentPos = new THREE.Vector3(0, 6, -12);
    this.initialized = false;
    this.camera.position.copy(this.currentPos);

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  update(dt, car) {
    // where the camera *wants* to be: behind and above the car
    const behind = new THREE.Vector3(
      -Math.sin(car.heading),
      0,
      -Math.cos(car.heading)
    );
    const target = car.group.position
      .clone()
      .addScaledVector(behind, 9)
      .add(new THREE.Vector3(0, 4.5, 0));

    // Start in the correct chase orientation, then retain a short, predictable
    // lag. Beginning from a fixed world-space point made left/right feel
    // inverted until the camera had travelled behind the car.
    if (!this.initialized) {
      this.currentPos.copy(target);
      this.initialized = true;
    } else {
      this.currentPos.lerp(target, 1 - Math.exp(-5.5 * dt));
    }
    this.camera.position.copy(this.currentPos);

    // Looking along the heading keeps screen-space steering aligned with the
    // car even while the camera is catching up through a fast direction change.
    const forward = new THREE.Vector3(
      Math.sin(car.heading),
      0,
      Math.cos(car.heading)
    );
    const lookAt = car.group.position
      .clone()
      .addScaledVector(forward, 2.5)
      .add(new THREE.Vector3(0, 0.8, 0));
    this.camera.lookAt(lookAt);
  }
}
