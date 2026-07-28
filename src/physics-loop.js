export const PHYSICS_STEP = 1 / 120;
export const MAX_FRAME_DT = 0.25;
export const MAX_PHYSICS_STEPS = Math.ceil(MAX_FRAME_DT / PHYSICS_STEP);

// Convert rendered frame time into stable physics slices without throwing
// away elapsed time on a slow frame. Dropping the accumulator made the entire
// game run in slow motion whenever rendering fell below roughly 12 fps.
export function advancePhysics(accumulator, frameDt, update) {
  const elapsed = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
  const availableTime = accumulator + elapsed;
  const stepCount = Math.min(
    Math.floor((availableTime + Number.EPSILON) / PHYSICS_STEP),
    MAX_PHYSICS_STEPS
  );

  for (let step = 0; step < stepCount; step++) update(PHYSICS_STEP);

  return Math.max(0, availableTime - stepCount * PHYSICS_STEP);
}
