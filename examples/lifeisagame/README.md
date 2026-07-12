# Life is a Game — Mumbai

A GTA-style, third-person 2.5D game set in a neon Mumbai, built in **Three.js**. This is the first
district — **Marine Drive** — with the goal of a district-streamed city you traverse on foot, by car,
and by flying car.

## Run it

It's fully self-contained (Three.js is bundled into `game.js`). Serve this folder over HTTP:

```sh
node serve.mjs        # → http://127.0.0.1:5180
# or any static server, e.g.  npx serve .
```

Open the URL. (Loading `index.html` from `file://` won't work — GLB/texture fetches need HTTP.)

## Controls

- **WASD** — move · **SHIFT** — run · **Q/E** or **mouse** — turn the camera
- **F** — enter / exit the car · driving: **WASD** steer, camera auto-follows
- **SPACE** — take off · **X** — land (flying car)
- **T** — switch Night ↔ Day theme

## How it's built

- **World** is procedural (the curved Marine Drive boulevard, sea, promenade, Queen's-Necklace lamps,
  median, roads/lane-lines) — cheap geometry + a painted ground texture.
- **Art** is generated (Higgs): building **facade textures** (glass / apartment / colonial / art-deco),
  the **rooftop** texture, and the **character** + **car** as rigged/textured GLB models.
- **Themes** are data objects — swapping one re-skins sky, fog, lights, ground, buildings and props.
- **Collision** is a solid-footprint grid (buildings + sea); the flying car ignores it while airborne.

## Layout

- `index.html` — the page
- `game.js` — the bundled game (includes Three.js)
- `src/main.js` — the game source (edit this; rebuild with esbuild to regenerate `game.js`)
- `assets/` — generated textures (`.png`) and models (`.glb`)
- `serve.mjs` — a tiny static server

### Rebuilding `game.js`

```sh
npx esbuild src/main.js --bundle --format=esm --target=chrome111 --outfile=game.js
```

(needs `three` available — e.g. run from a checkout that has it installed.)
