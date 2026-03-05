# Heliosphere — Project Plan

## What We're Building

A browser-based living solar system simulation in TypeScript + Babylon.js. The player
can view the inner solar system as a real-time orrery, zoom into any body to see its
3D globe with climate data, place and manage colonies, and move population and resources
between worlds via ships. A later scenario layer (MVP2) adds a Cold War Never Ended
setting where two factions compete to dominate the solar system.

The climate and planet-rendering pipeline is ported from **World Orogen** — a proven
procedural planet generator using Voronoi sphere meshing, tectonic simulation, Köppen
climate classification, and satellite biome coloring. Each solar body gets pre-configured
planetary parameters derived from real science, fed into that same pipeline.

---

## Guiding Principles

1. **Playability first** — the simulation should feel alive and reactive. A colony on Mars
   should feel different from one on the Moon. Decisions should have weight.
2. **Scientific flavour, not simulation** — orbits are real, climates are plausible, but
   we simplify ruthlessly when realism hurts fun or performance.
3. **Visual polish** — Babylon.js post-processing (bloom, depth of field, atmospheres)
   should make the solar system feel cinematic. Aesthetics matter.
4. **Progressive complexity** — MVP1 is a working colony manager. MVP2 adds faction AI.
   Each milestone must be fully playable before moving to the next.

---

## Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript 5.x | Strict mode. All game objects are typed. |
| 3D Engine | Babylon.js 7.x | via CDN import map, no build step initially |
| Build | `tsc --watch` + `npx serve` | TypeScript compiled to JS, served locally |
| Shaders | GLSL via Babylon ShaderMaterial | Atmosphere rim, planet surface, orbit lines |
| UI | Babylon GUI (AdvancedDynamicTexture) | In-scene panels, tooltips, colony cards |
| State | Plain TypeScript classes | No framework, no reactivity library |
| Climate math | Ported from World Orogen JS | Pure TS, engine-agnostic |

### Development setup
```bash
npm install typescript
npx tsc --init   # generates tsconfig.json
npx tsc --watch  # compiles src/ → dist/ on save
npx serve .      # serves project at localhost:3000
```

---

## Project Structure

```
heliosphere/
├── index.html              # Shell, import map, canvas
├── styles.css              # Layout, UI chrome, HUD
├── tsconfig.json           # TypeScript config
├── package.json            # Dev dependencies only
│
├── src/
│   ├── main.ts             # Entry point — init engine, view router
│   ├── state.ts            # Global sim state (time, colonies, ships, factions)
│   ├── types.ts            # Shared TypeScript interfaces and enums
│   │
│   ├── simulation/
│   │   ├── time.ts         # Game clock — compressed real time, tick system
│   │   ├── orbit.ts        # Kepler equation, body position(t), transfer costs
│   │   ├── solar-system.ts # All body definitions (orbital elements, physical data)
│   │   ├── colony.ts       # Colony data model, population, infrastructure tiers
│   │   ├── resources.ts    # Resource types, production rates, consumption
│   │   ├── ship.ts         # Ship data model, routing, cargo, ETA calculation
│   │   └── economy.ts      # Supply/demand, trade routes, colony growth
│   │
│   ├── views/
│   │   ├── system-view.ts  # 2D orrery — orthographic cam, orbiting bodies, ships
│   │   ├── body-view.ts    # 3D planet view — globe, colony markers, climate overlay
│   │   └── ui/
│   │       ├── hud.ts      # Top bar: date, time speed, faction resources
│   │       ├── body-panel.ts   # Side panel: selected body stats, colony list
│   │       ├── colony-panel.ts # Colony detail: pop, resources, build queue
│   │       ├── ship-panel.ts   # Ship detail: route, cargo, ETA
│   │       └── tooltip.ts  # Hover tooltips for bodies and colonies
│   │
│   ├── planet/             # Ported + adapted from World Orogen
│   │   ├── body-params.ts  # Maps real planetary data → climate sim parameters
│   │   ├── sphere-mesh.ts  # Fibonacci sphere, Delaunay, dual mesh
│   │   ├── plates.ts       # Tectonic plate generation
│   │   ├── ocean-land.ts   # Ocean/land assignment
│   │   ├── elevation.ts    # Elevation pipeline
│   │   ├── terrain-post.ts # Erosion, warping, smoothing
│   │   ├── wind.ts         # Seasonal wind simulation
│   │   ├── precipitation.ts# Precipitation simulation
│   │   ├── temperature.ts  # Temperature simulation
│   │   ├── koppen.ts       # Köppen climate classification (all 35 zones)
│   │   ├── color-map.ts    # Elevation + biome → RGB
│   │   ├── rng.ts          # Seeded PRNG (Park-Miller LCG)
│   │   └── simplex-noise.ts# 3D simplex noise with fBm
│   │
│   └── scenario/           # MVP2
│       ├── faction.ts      # Faction definition, priorities, relations
│       ├── ai.ts           # Faction AI — expansion decisions, ship orders
│       └── cold-war.ts     # Cold War scenario config and victory conditions
│
└── dist/                   # Compiled JS output (gitignored)
```

---

## Bodies in Scope (MVP1)

### Inner Solar System

| Body | Parent | Type | Key Climate Params | Colonisable |
|------|--------|------|--------------------|-------------|
| Sun | — | Star | Visual anchor only | No |
| Mercury | Sun | Planet | No atmosphere, extreme thermal swing (−180/+430°C), airless cratering | Yes (subsurface) |
| Venus | Sun | Planet | Crushing CO₂ atmosphere, 465°C mean, Hellscape Köppen | Yes (floating/orbital) |
| Earth | Sun | Planet | Full World Orogen generation, baseline habitability | Yes (home world) |
| Moon | Earth | Moon | No atmosphere, low gravity (0.17g), airless cratering | Yes |
| Mars | Sun | Planet | Trace CO₂ atmosphere, −60°C mean, thin/arid | Yes |
| Phobos | Mars | Moon | No atmosphere, micro-gravity, rocky | Yes (station) |
| Deimos | Mars | Moon | No atmosphere, micro-gravity, rocky | Yes (station) |
| Asteroid Belt | Sun | Zone | Abstracted as resource nodes, not globes | Yes (mining) |

### Orbital Elements (J2000 epoch, inner planets)

These feed directly into `orbit.ts` Kepler solver:

| Body | Semi-major axis (AU) | Period (days) | Eccentricity | Inclination (°) |
|------|----------------------|---------------|--------------|-----------------|
| Mercury | 0.387 | 87.97 | 0.206 | 7.00 |
| Venus | 0.723 | 224.70 | 0.007 | 3.39 |
| Earth | 1.000 | 365.25 | 0.017 | 0.00 |
| Mars | 1.524 | 686.97 | 0.093 | 1.85 |
| Moon | 0.00257 (from Earth) | 27.32 | 0.055 | 5.14 |
| Phobos | 0.0000627 (from Mars) | 0.319 | 0.015 | 1.08 |
| Deimos | 0.000157 (from Mars) | 1.263 | 0.0002 | 1.79 |

---

## World Orogen Climate Port

### What ports unchanged (pure math, no Three.js dependency)
- `rng.ts` — Park-Miller LCG seeded PRNG
- `simplex-noise.ts` — 3D simplex with fBm and ridged fBm
- `sphere-mesh.ts` — Fibonacci sphere, Delaunay, dual mesh
- `plates.ts` — Tectonic plate generation
- `ocean-land.ts` — Ocean/land assignment
- `elevation.ts` — Full elevation pipeline
- `terrain-post.ts` — All erosion and post-processing
- `wind.ts` — Seasonal wind simulation
- `precipitation.ts` — Moisture advection + heuristic blend
- `temperature.ts` — Temperature simulation
- `koppen.ts` — Köppen classification with all 35 zones
- `color-map.ts` — Elevation and biome → RGB

### What changes
- **`body-params.ts` (new)** — replaces the UI sliders from World Orogen. Instead of
  a user moving sliders, this module hard-codes the five planetary physics values
  (gravity, atmosphere, hydrosphere, baseTemp, axialTilt) for each solar body, derived
  from real planetary science. Mars gets `gravity=0.38, atmosphere=Trace, hydrosphere=None,
  baseTemp=-60, tilt=25`. Venus gets `gravity=0.91, atmosphere=Crushing, hydrosphere=None,
  baseTemp=465, tilt=2`. These feed directly into the same `planetary-params.ts` pipeline.
- **Rendering** — Three.js `SphereGeometry` + vertex colors replaced by Babylon.js
  `MeshBuilder.CreateSphere` + custom `VertexData` with the same color array output.
  The climate math output (a flat `Uint8Array` of RGB per cell) is identical.
- **Worker** — World Orogen runs climate in a Web Worker. Heliosphere does the same:
  one worker per body, bodies computed lazily when first visited.

### Per-body planetary params

```typescript
// src/planet/body-params.ts
export const BODY_PARAMS: Record<BodyId, PlanetaryPhysicsInput> = {
  mercury: { gravity: 0.38, atmosphere: 0, hydrosphere: 0, baseTemp: 167,  axialTilt: 0.03 },
  venus:   { gravity: 0.91, atmosphere: 5, hydrosphere: 0, baseTemp: 465,  axialTilt: 177  },
  earth:   { gravity: 1.00, atmosphere: 3, hydrosphere: 3, baseTemp: 15,   axialTilt: 23.4 },
  moon:    { gravity: 0.17, atmosphere: 0, hydrosphere: 0, baseTemp: -20,  axialTilt: 1.5  },
  mars:    { gravity: 0.38, atmosphere: 1, hydrosphere: 0, baseTemp: -60,  axialTilt: 25.2 },
  phobos:  { gravity: 0.001,atmosphere: 0, hydrosphere: 0, baseTemp: -40,  axialTilt: 0    },
  deimos:  { gravity: 0.001,atmosphere: 0, hydrosphere: 0, baseTemp: -40,  axialTilt: 0    },
};
```

---

## Core Systems

### 1. Time System (`simulation/time.ts`)

The game clock drives everything. Real orbital periods are used but compressed.

```typescript
interface GameClock {
  realStartMs: number;       // wall-clock start
  gameStartJD: number;       // Julian Date game epoch (e.g. 2451545.0 = J2000)
  speedMultiplier: number;   // 1 = 1 day/second, 30 = 1 month/second
  paused: boolean;
  currentJD: number;         // current Julian Date (updates each frame)
}

// Speed presets
const SPEEDS = [0, 1, 7, 30, 365]; // pause / 1 day/s / 1 week/s / 1 month/s / 1 year/s
```

Each frame: `currentJD += deltaSeconds * speedMultiplier`

### 2. Orbit Solver (`simulation/orbit.ts`)

Uses the standard Kepler equation. Positions are computed in the ecliptic plane then
projected into Babylon scene space (scale: 1 AU = 100 Babylon units for the system view).

```typescript
// Solve eccentric anomaly via Newton-Raphson (5 iterations is sufficient)
function solveKepler(M: number, e: number): number

// Return [x, y, z] position in AU at Julian Date jd
function bodyPosition(body: OrbitalElements, jd: number): Vector3

// Return travel time in days between two bodies at a given departure JD
// Uses simplified Hohmann transfer approximation for MVP1
function transferTime(from: BodyId, to: BodyId, departureJD: number): number
```

### 3. Colony System (`simulation/colony.ts`)

```typescript
interface Colony {
  id: string;
  bodyId: BodyId;
  lat: number;           // degrees
  lon: number;           // degrees
  name: string;
  population: number;    // people
  infrastructure: InfrastructureTier;
  resources: ResourceStore;
  productionRates: Partial<Record<ResourceType, number>>;  // per game-day
  consumptionRates: Partial<Record<ResourceType, number>>;
  habitability: number;  // 0–1, derived from body climate at this lat/lon
  factionId: string | null;
}

type InfrastructureTier = 'outpost' | 'settlement' | 'colony' | 'city' | 'megacity';

// Tier thresholds (population):
// outpost: 1–99, settlement: 100–9,999, colony: 10K–999K, city: 1M–99M, megacity: 100M+
```

### 4. Resource System (`simulation/resources.ts`)

```typescript
type ResourceType =
  | 'food'         // produced by agriculture (needs water + warmth)
  | 'water'        // extracted from ice/regolith/atmosphere
  | 'oxygen'       // life support
  | 'power'        // solar/nuclear
  | 'metals'       // structural materials, mined
  | 'rareMetals'   // electronics, high-tech, rare asteroid minerals
  | 'fuel'         // reaction mass for ships
  | 'population';  // treated as a resource for transport purposes
```

Each body has a **resource profile** defining base extraction rates per colony tier:

| Body | Food | Water | Metals | Rare Metals | Fuel |
|------|------|-------|--------|-------------|------|
| Earth | High | High | Med | Low | Med |
| Moon | None | Low (ice poles) | High | Med | Low |
| Mars | Low (greenhouse) | Low | High | Med | Med |
| Venus | None | None | Med | Low | Low |
| Mercury | None | None | High | High | Low |
| Asteroids | None | Low | Very High | Very High | Low |

### 5. Ship System (`simulation/ship.ts`)

```typescript
interface Ship {
  id: string;
  name: string;
  factionId: string | null;
  origin: BodyId;
  destination: BodyId;
  departureJD: number;
  arrivalJD: number;
  cargo: Partial<Record<ResourceType, number>>;
  capacity: number;
  type: ShipType;
}

type ShipType = 'freighter' | 'colonist' | 'military' | 'probe';
```

Ships are point objects on the system view. Position is linearly interpolated between
origin and destination positions on departure/arrival date (not real orbital trajectory
for MVP1 — straight line in the display, but travel time is Hohmann-approximate).

---

## View Architecture

### System View (`views/system-view.ts`)

Babylon.js scene with orthographic camera looking down the Z axis.

**What's rendered:**
- Sun: emissive sphere, lens flare, bloom
- Planets: textured spheres scaled for visibility (not to scale — Mercury would be invisible)
  Each has an orbit line (dashed `LineSystem`), a label, and a glow ring if colonised
- Moons: smaller spheres on inner orbit lines (visible when zoomed in on parent)
- Ships: small triangle meshes moving along interpolated paths, colored by faction
- Asteroid belt: a particle ring between Mars and Jupiter orbits

**Camera:**
- Orthographic, looking down +Y
- Scroll-to-zoom (0.1 AU → 3 AU view range)
- Click + drag to pan
- Click a body to select it (shows body panel), double-click to zoom into Planet View

**Time controls (HUD):**
- Pause / Play / Speed buttons (×1 / ×7 / ×30 / ×365)
- Current date display (e.g. "14 March 2031")
- "Next event" indicator (next ship arrival, colony milestone)

### Planet View (`views/body-view.ts`)

Babylon.js scene with a perspective camera, showing the body as a 3D globe.

**Globe rendering:**
- `MeshBuilder.CreateSphere` with enough subdivisions to match detail level
- Custom `VertexData` with per-vertex colors from the climate pipeline
- `StandardMaterial` with emissive fallback for airless bodies
- Atmosphere rim via `ShaderMaterial` (Fresnel glow, color from atmosphere level)
- Water sphere slightly above terrain for ocean worlds
- Starfield backdrop (`ParticleSystem` or static skybox)

**Colony markers:**
- Billboard sprites at lat/lon positions (converted to 3D sphere surface point)
- Color coded by faction (blue = player, red = USSR, white = unclaimed)
- Click to open Colony Panel

**Overlays (tab switcher):**
- Terrain — elevation colour ramp
- Climate — Köppen zones (all 35 types)
- Satellite — biome colours
- Habitability — green (liveable) → red (hostile) heat map
- Resources — shows resource density for the selected type

**Back button:**
- Returns to System View, camera animates back out

---

## UI Design

### HUD (always visible)
```
[☀ Heliosphere]  [Date: 14 Mar 2031]  [⏸ ▶ ▶▶ ▶▶▶]  [Metals: 4,200] [Fuel: 890] [Pop: 12.4M]
```

### Body Panel (right sidebar, shown on body selection)
```
┌─────────────────────────┐
│ 🔴 MARS                 │
│ Terrestrial Planet      │
│ ─────────────────────── │
│ Temp: −60°C avg         │
│ Atmosphere: Trace CO₂   │
│ Gravity: 0.38g          │
│ Habitability: 12%       │
│ ─────────────────────── │
│ Colonies: 3             │
│ Population: 45,000      │
│ ─────────────────────── │
│ [View Globe]            │
│ [Found Colony]          │
└─────────────────────────┘
```

### Colony Panel (shown on colony selection)
```
┌─────────────────────────┐
│ Bradbury Station        │
│ Mars • Settlement       │
│ ─────────────────────── │
│ Population: 12,400      │
│ Habitability: 18%       │
│ ─────────────────────── │
│ PRODUCTION / CYCLE      │
│ Metals    +240          │
│ Food      −80  ⚠ low   │
│ Water     +12           │
│ ─────────────────────── │
│ BUILD QUEUE             │
│ [Greenhouse +1]         │
│ [Solar Array +1]        │
│ ─────────────────────── │
│ [Send Ship Here]        │
└─────────────────────────┘
```

---

## Build Milestones

### Milestone 1 — Foundation (start here)
**Goal:** A working Babylon.js project with TypeScript, all body data defined, game clock ticking.

Files to create:
- `index.html` — canvas, import map (Babylon.js CDN), script tag
- `tsconfig.json` — strict mode, target ES2020, module ESNext
- `src/types.ts` — all interfaces (BodyId, Colony, Ship, ResourceType, GameClock, OrbitalElements)
- `src/state.ts` — singleton GameState object
- `src/simulation/time.ts` — clock, tick, speed controls
- `src/simulation/solar-system.ts` — all body definitions (orbital elements + physical params + resource profiles)
- `src/simulation/orbit.ts` — Kepler solver, bodyPosition(), transferTime()

**Acceptance test:** Open browser, see canvas. Console.log current positions of all bodies at J2000.

---

### Milestone 2 — System View
**Goal:** See the solar system. Orbits moving in real compressed time.

Files to create:
- `src/main.ts` — engine init, scene setup, render loop
- `src/views/system-view.ts` — orthographic scene, body meshes, orbit lines
- `src/views/ui/hud.ts` — date display, speed controls

**Acceptance test:** Inner planets orbit the sun at correct relative speeds. Date advances. Speed controls work.

---

### Milestone 3 — Planet View (Climate Pipeline)
**Goal:** Click a body, zoom into its 3D globe with correct climate rendering.

Files to create/port:
- `src/planet/body-params.ts` — planetary physics per body
- Port all World Orogen climate files to TypeScript (see list above)
- `src/views/body-view.ts` — Babylon.js globe, climate overlay tabs, back button

**Acceptance test:** Click Mars → see a red/tan cratered globe with Trace atmosphere glow.
Click Earth → see a procedurally generated green/blue/white globe with full Köppen zones.
Click Venus → see an orange hellscape globe with thick haze.

---

### Milestone 4 — Colonies
**Goal:** Found colonies, see them on the globe and in the system view.

Files to create:
- `src/simulation/colony.ts` — Colony class, habitability calculation
- `src/simulation/resources.ts` — ResourceStore, production/consumption
- `src/simulation/economy.ts` — per-tick resource update
- `src/views/ui/body-panel.ts` — body stats + colony list
- `src/views/ui/colony-panel.ts` — colony detail, build queue

**Acceptance test:** Found a colony on Mars. See it as a dot on the globe. See its resources
ticking down (food/oxygen consumption). Build a greenhouse, see food production start.

---

### Milestone 5 — Ships
**Goal:** Send ships between worlds, carrying cargo.

Files to create:
- `src/simulation/ship.ts` — Ship class, routing, ETA
- `src/views/ui/ship-panel.ts` — ship detail UI
- System view: ships visible as moving objects

**Acceptance test:** Dispatch a freighter from Earth to Mars carrying food. See it move across
the system view. See it arrive and the colony's food store increase.

---

### Milestone 6 — Polish Pass
**Goal:** Atmosphere shaders, bloom, depth of field, sound design hooks, save/load.

- Babylon.js post-processing pipeline (bloom for sun + colonies, depth of field in planet view)
- Atmosphere rim shaders per body (colored by atmosphere type)
- LocalStorage save/load for colony and ship state
- Tutorial overlay

---

### MVP2 — Cold War Scenario
**Goal:** Two factions (USA and USSR) competing to colonise the solar system.

New files:
- `src/scenario/faction.ts` — Faction class, territories, diplomatic state
- `src/scenario/ai.ts` — AI decision loop (claim bodies, send ships, build colonies)
- `src/scenario/cold-war.ts` — Starting conditions (1962 start date, Earth divided,
  both factions have early rocket tech), technology tree, victory conditions

**Starting conditions (Cold War scenario):**
- Date: 1 January 1962
- USA: 1 colony on Moon (Sea of Tranquility), early rocket tech
- USSR: 1 colony on Moon (Mare Imbrium), early rocket tech
- Both have rudimentary outposts, neither has reached Mars yet
- Victory: Control 60% of colonised bodies, or eliminate rival from space

**Technology tree (simplified):**
- Tier 1: Chemical rockets (slow, cheap) — available at start
- Tier 2: Nuclear thermal (2× speed) — unlocked after 5 years of research
- Tier 3: Ion drives (5× speed, long haul) — unlocked after 15 years
- Tier 4: Fusion torch (10× speed) — unlocked after 30 years
- Terraforming: Mars atmospheric seeding (50 year project, requires Tier 3)

---

## Terraforming (Long Term)

Terraforming is a multi-decade project that gradually shifts a body's planetary params,
re-runs the climate pipeline, and updates the globe rendering.

**Mars terraforming stages:**
1. Atmospheric seeding — raise atmosphere from Trace → Thin (20 years, requires 500 fuel/cycle)
2. Water release — raise hydrosphere from None → Partial (30 years)
3. Warming — raise baseTemp from −60°C → 0°C (greenhouse effect, 25 years)
4. Oxygenation — full breathable atmosphere (50 years, requires biotech research)

At each stage threshold, Mars is re-generated with the new params. The Köppen zones
visibly shift — Cryo-Deserts become Tundra, then Subarctic, then eventually temperate
zones appear near the equator. Habitability score rises, unlocking higher colony tiers.

**Venus terraforming** (much harder):
1. Solar shade deployment (orbital megastructure, requires Tier 4)
2. Atmospheric removal (centuries-long, speculative tech)

---

## Scale & Performance Notes

- Climate pipeline runs in a **Web Worker** per body, lazily on first visit
- Bodies are cached after first computation — revisiting is instant
- System view bodies are low-poly (sphere subdivisions = 16) for performance
- Planet view detail level is user-adjustable (same Detail slider concept as World Orogen)
- Mobile: system view works on touch (pinch-to-zoom, tap-to-select)
  Planet view is desktop-primary for MVP1

---

## Key Decisions to Revisit During Build

1. **Ship routing** — MVP1 uses straight-line interpolation + Hohmann time approximation.
   A later pass could add proper Hohmann arc rendering in the system view.
2. **Asteroid belt** — MVP1 treats it as abstract resource nodes. A later pass adds
   individual named asteroids (Ceres, Vesta, Pallas) as proper bodies.
3. **Save format** — LocalStorage JSON for MVP1. Consider URL-encoded state (like World
   Orogen's planet codes) for shareable game states.
4. **Sound** — hooks defined in Milestone 6 but no audio assets needed for MVP1.
