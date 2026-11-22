# Trawl

Trawl is a 3D survey game. You operate a small survey launch on Puget Sound. You tow a side-scan sonar and find targets on the seabed. You get points for each target that you log.

The large-scale shape of the sound comes from real bathymetry. Seeded noise adds the small-scale detail. Each seed gives a different seabed and different target positions.

The screen has two parts. The left part shows the 3D scene. The right part shows the live sonar record.

## Run the game

You must have Node.js 20 or later.

1. Install the dependencies:

   ```sh
   npm install
   ```

2. Start the development server:

   ```sh
   npm run dev
   ```

3. Open the URL that Vite shows (usually `http://localhost:5173`).

To set a seed, add it to the URL: `http://localhost:5173/?seed=12345`.

### Build

| Command | Result |
| --- | --- |
| `npm run build` | Type check and a production build in `dist/`. |
| `npm run build:single` | One self-contained HTML file in `dist-single/index.html`. It includes the base map. |
| `npm run typecheck` | Type check only. |

## Controls

| Input | Action |
| --- | --- |
| W / S or ↑ / ↓ | Increase or decrease the throttle. The throttle stays where you set it. |
| X | Set the throttle to zero. |
| A / D or ← / → | Steer. The rudder needs water flow, so turns are slow at low speed. |
| R / F | Pay out or haul in the tow cable. |
| [ / ] | Decrease or increase the sonar range. |
| Click on the sonar record | Log a target at that position. |
| Drag on the 3D view | Turn the camera. |
| Mouse wheel | Zoom the camera. |
| Double-click on the 3D view | Reset the camera. |
| M | Show or hide the chart. |
| L | Show or hide the survey log and the rumours. |
| H | Show or hide the help. |
| Esc | Close the open window. |

## How to survey

- Keep the towfish at 10–20% of the range above the seabed. The altitude readout is green in this band.
- More cable puts the fish deeper. More speed lifts the fish.
- When you slow down, the fish sinks. Haul in cable before you stop in shallow water. If the fish hits the seabed at speed, it gets damage.
- Survey at 3–6 kn. At more than approximately 9 kn, aeration noise covers the record.
- The dark band in the centre of the record is the water column. Targets show a bright face toward the fish and a dark acoustic shadow behind. A tall target has a long shadow.
- HF (900 kHz) gives a sharp record to 75 m. LF (400 kHz) gives a range of 150 m with less detail.
- Click a target on the record to log it. A correct pick gives points and puts a buoy above the target. A pick with no target is a false contact and costs 5 points.
- The orange area on the chart shows the seabed that you surveyed.

The game saves to `localStorage` every 20 seconds, after each find, and when you close the page.

## Targets

There are 47 targets in five categories. Natural features include glacial erratics, methane seeps, rock pinnacles, a drowned forest and octopus dens. Debris includes cars, containers and lost gear. There are also wrecks, oddities and legends. The survey log (L) gives rumours that point to the rarer targets.

## Project layout

| Path | Contents |
| --- | --- |
| `src/main.ts` | Start-up, game loop, contact picking, save and load. |
| `src/config.ts` | Scale, depth curve, boat, cable and sonar constants. |
| `src/world/bathymetry.ts` | Base-map grid, bicubic sampling, game ↔ latitude/longitude. |
| `src/world/terrain.ts` | Height and seabed material: coastline detail, sand waves, pockmarks, rock, boulders, hills, placed objects. |
| `src/world/chunks.ts` | Terrain meshes: far mesh and near chunks in two levels of detail, trees, boulders. |
| `src/world/materials.ts` | Underwater shader patch: absorption with depth, caustics, surf line. |
| `src/world/water.ts`, `sky.ts` | Water surface, sky, fog, lights, Mount Rainier and the Cascades backdrop. |
| `src/world/features.ts`, `models.ts` | Target catalogue, seeded placement, low-poly models, heightmap bake for the sonar. |
| `src/world/landmarks.ts` | Cities, lighthouses and the Tacoma Narrows bridge. |
| `src/vessel/` | Boat handling and grounding, towfish and cable, wake. |
| `src/sonar/` | Instrument interface and the side-scan model. |
| `src/ui/` | Waterfall display, charts, HUD, camera and keyboard input. |
| `tools/build_bathy.py` | Script that makes the base map from the source bathymetry. |

## Side-scan model

For each ping and each side, the model samples the seabed along the across-track line. For each sample it calculates:

1. The slant range from the transducer.
2. The visibility. A sample is in shadow if a closer sample is higher in the view from the fish.
3. The backscatter. This uses Lambert's law with the local slope and the seabed material.
4. The vertical beam pattern.

The model adds the samples into slant-range bins. Then it applies spreading loss, absorption and gamma speckle. The display applies gain and TVG. The record thus shows the real artefacts: the water column, the bright first return, acoustic shadows, the surface return and along-track compression at high speed.

Each placed target has a heightmap that comes from its 3D model. Thus the sonar sees the same shape as the 3D scene.

To add a new instrument (for example a multibeam or a magnetometer), implement the `Instrument` interface in `src/sonar/instrument.ts`.

## Base map

The base map is the SalishSeaCast NEMO bathymetry (`bathymetry_202411.nc`) from the UBC Department of Earth, Ocean and Atmospheric Sciences. Its licence is Apache-2.0. Source: <https://github.com/SalishSeaCast/grid>.

`tools/build_bathy.py` resamples the source grid (approximately 450 m × 500 m) to a regular 250 m grid from 47.02°N to 48.24°N and from 123.18°W to 122.18°W. The output is `src/data/puget_sound.bin` (Int16) and `src/data/puget_sound.json` (metadata).

To make the base map again:

```sh
pip install netCDF4 scipy numpy
python3 tools/build_bathy.py
```

The game compresses the sound 10:1 in the horizontal direction. It maps the real depth (0–260 m) to a game depth of 0–32 m with an exponent of 0.75. This keeps the water clear enough to see the seabed in the shallows.

Land elevation comes from the distance to the water plus seeded noise. Land elevation is not from survey data.
