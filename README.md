# VROOM 🏎️

A little drivable car game built with [Three.js](https://threejs.org). Everything is made from simple shapes and plain JavaScript — no game engine, no magic. The whole point is that you can read every file, change a number, refresh, and see what happens.

**Controls:** WASD or arrow keys to drive · Space = handbrake (drift!) · T = telemetry · R = reset

## Run it on your computer

You need [Node.js](https://nodejs.org) installed. Then:

```bash
git clone <this-repo-url>
cd vroom
npm install
npm run dev
```

Open the link it prints (usually `http://localhost:5173`) and drive.

## How the code is organised

| File | What it does |
|---|---|
| `src/main.js` | Starts everything and runs the game loop |
| `src/car.js` | The car's shape and force-based driving model |
| `src/world.js` | The ground, track, cones, and trees |
| `src/camera.js` | The camera that chases the car |
| `src/input.js` | Turns key presses into actions |

## What the physics model teaches

The car uses a compact **four-corner 3D vehicle model**. Every wheel samples the
terrain beneath it, moves through its own spring and damper, and receives a
separate grip budget from its instantaneous normal load. The chassis responds
in heave, pitch, roll and yaw, so a bump is a physical input rather than a
camera effect.

- **Forces, mass, and acceleration:** engine and brake forces are measured in
  newtons; vehicle mass is in kilograms.
- **Independent suspension:** four springs and dampers turn terrain height and
  wheel velocity into individual tyre loads.
- **3D terrain contacts:** the visible rolling ground, kerbs, speed bumps and
  centre ramp come from the same height and normal sampler used by physics.
- **Jumps and landings:** tyres produce no force beyond full suspension droop;
  landing compression and damper velocity determine the impact force at each
  corner.
- **Slip angle:** each tyre creates cornering force when it points in a
  different direction from its contact-patch travel.
- **Friction circle:** braking, power and cornering requests are scaled together
  so using more of one leaves proportionally less of the others without
  completely removing steering authority.
- **Speed-sensitive steering:** full keyboard input targets a safe lateral
  acceleration, giving useful lock at parking speed without demanding
  impossible tyre angles at 100 km/h.
- **Weight transfer:** acceleration, braking, cornering and uneven ground move
  load between the four tyres through the sprung chassis.
- **Rotational inertia:** the car takes time to pitch, roll and yaw.
- **Aerodynamics:** drag increases with speed squared, while downforce gives the
  suspension—and therefore the tyres—more load at speed.
- **Surfaces:** tarmac and sand have different friction and rolling resistance.
- **Numerical integration:** physics runs at a fixed 120 updates per second, so
  a slow display does not change how the car handles.

Press **T** to hide or show the Physics Lab. It reports acceleration in g,
front/rear slip angle, vertical acceleration, live FL/FR/RL/RR loads, wheel
contact count, downforce, and peak tyre-grip use.

## Experiments to try

1. Change `frontSpringRate` and `rearSpringRate`, then compare pitch and landing
   balance.
2. Increase `frontDamperRate` and see whether the front tyres settle faster or
   skip over repeated bumps.
3. Double `cgHeight` and compare acceleration, braking and cornering load
   transfer.
4. Reduce `rearCorneringStiffness` to make oversteer easier.
5. Change `brakeBiasFront`. Too much rear bias should make braking less stable.
6. Increase `downforceArea`, then compare the four live loads at low and high
   speed.
7. Change the ramp dimensions in `src/world.js` and compare jump distance and
   landing loads.

Run the physics checks with:

```bash
npm test
```

## Where the simulation could go next

These would be valuable, but each is a substantial project rather than a tuning
change:

- **A combined-slip tyre curve:** replace the current linear stiffness plus
  friction-circle clamp with a Pacejka-style curve, including load sensitivity,
  temperature, pressure and wear.
- **Unsprung mass:** give each wheel its own vertical mass and velocity instead
  of using a massless suspension ray.
- **Powertrain simulation:** engine RPM, gears, differential, clutch, torque
  curve, wheel angular velocity, ABS and traction control.
- **Rigid-body collision physics:** barriers, car damage and cone impacts that
  exchange momentum and angular impulse instead of scripted reactions.
- **Arbitrary mesh contacts:** replace the analytic height field with triangle
  queries for bridges, tunnels and banked surfaces that can overlap vertically.
- **Track and race systems:** proper collision boundaries, checkpoints, lap
  timing, ghost replays and telemetry export for comparing two setups.

## How we work on it together

- Put each bug or development request in a GitHub Issue.
- Give accepted issues a priority and mark them `ready` when the expected result
  is clear.
- Keep the repository on `main`; do not create development branches.
- Run the relevant checks before committing or pushing `main`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the request forms, priority meanings,
and the complete workflow.

## Deploying

The site auto-deploys on [Vercel](https://vercel.com) from `main`. Push a commit, wait a minute, and the live site updates.
