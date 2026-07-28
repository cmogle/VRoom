# VROOM 🏎️

A little drivable car game built with [Three.js](https://threejs.org). Everything is made from simple shapes and plain JavaScript — no game engine, no magic. The whole point is that you can read every file, change a number, refresh, and see what happens.

**Controls:** WASD or arrow keys to drive · Space = handbrake (drift!) · R = reset

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
| `src/car.js` | The car's shape **and** how it drives — most of the fun numbers live here |
| `src/world.js` | The ground, track, cones, and trees |
| `src/camera.js` | The camera that chases the car |
| `src/input.js` | Turns key presses into actions |

## Things to try changing first

Easy wins, in rough order:

1. **Car colour** — `COLOURS` at the top of `src/car.js`
2. **Make it faster** — `maxSpeed` and `acceleration` in `TUNING` in `src/car.js`
3. **Maximum drift** — lower `grip` to something like `2`
4. **More cones** — add coordinates to `spots` in `src/world.js`
5. **A bigger track** — change the two radius numbers in `addTrack()`

## Ideas for later

- A lap timer that starts when you cross the stripe
- Ramps and jumps (the car has no vertical physics yet — that's the challenge)
- A drift score counter
- Sound effects (engine pitch tied to speed)
- A second car for split-keyboard two-player racing
- Touch controls so it works on a phone

## How we work on it together

- Put each bug or development request in a GitHub Issue.
- Give accepted issues a priority and mark them `ready` when the expected result
  is clear.
- Make every code change on a branch and review it in a pull request before
  merging it into `main`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the request forms, priority meanings,
and the complete workflow.

## Deploying

The site auto-deploys on [Vercel](https://vercel.com) from `main`. Push a commit, wait a minute, and the live site updates.
