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

    // ease towards it — the 3.5 controls how "loose" the camera feels
    this.currentPos.lerp(target, Math.min(3.5 * dt, 1));
    this.camera.position.copy(this.currentPos);

    // look slightly ahead of the car
    const lookAt = car.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    this.camera.lookAt(lookAt);
  }
}
