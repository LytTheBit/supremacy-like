# Supremacy-like

A real-time grand strategy game inspired by Supremacy 1914. This repository starts with the
**simulation core**: a pure, deterministic TypeScript library with no graphics and no I/O.

## Getting started

```bash
npm install
npm test          # run the test suite (vitest)
npm run typecheck # strict TypeScript check
npm run demo      # play a small battle on the tiny map
npm run match     # AI vs AI match on the 12-province duel map
npm run genmap -w @supremacy/sim -- --seed 7 --provinces 24   # generate a hex map, writes SVG + JSON to packages/sim/out/
```

## Layout

```
packages/sim/
  src/
    types.ts        plain JSON data types (state, ruleset, map, events)
    rulesets/       static game data (units, resources, combat tuning)
    maps/           sample maps (tiny: 5 provinces, duel: 12 provinces, symmetric)
    pathfinding.ts  Dijkstra on the province graph
    combat.ts       simplified combat model + previewBattle() "calculator"
    world.ts        createGame(): builds and validates the initial state
    orders.ts       player orders (orderMove, orderRecruit), validated and pure
    tick.ts         tick(): movement -> combat -> conquest -> training -> merging -> production -> victory
    victory.ts      eliminations, last standing, domination
    ai.ts           runAi(): rule-based AI that plays through the normal orders
    match.ts        runMatch(): headless game loop (AI players, tick limit)
    hexmap/         hexagonal maps: generation, province graph, validation, SVG preview
  scripts/demo.ts, scripts/match.ts, scripts/genmap.ts
examples/           sample generated maps (open the SVGs in a browser)
  test/
```

Planned packages: `server` (Node + WebSocket) and `client` (React + PixiJS).

## Design rules

- **State is plain JSON.** No classes or Maps in the state: it can be saved, sent over the
  network and compared in tests.
- **`tick(state, rules)` is pure.** Same input, same output, no randomness. The input is never mutated.
- **Logic runs on a province graph.** Hexagons are only used to generate and draw province shapes.
- **Rules are data.** Eras and medals will be modifiers applied on top of the base `Ruleset`.

## Hex maps

Players never see hexes. They are used to shape provinces and to let anyone draw a map; the
game itself runs on the province graph (`MapDef`).

```
generateHexMap(options)   ->  HexMapData   (cells + provinces + manual links, plain JSON)
validateHexMap(map)       ->  list of issues (empty = valid)
toMapDef(map)             ->  MapDef       (what createGame() consumes)
renderSvg(map)            ->  SVG preview
```

`HexMapData` is also what a map editor edits: paint cells with a province id, then derive the
graph with `toMapDef()`. Provinces that share a hex edge are adjacent automatically; strait or
sea routes are added as manual `links`.

Generation (`hexmap/generate.ts`), all deterministic from a seed:

1. **Land/sea** from fractal noise with a falloff towards the edges, cut to the wanted `landRatio`.
   Tiny islands are dropped and tiny enclosed lakes are filled.
2. **Seeds** spread out with farthest-point sampling (every island gets at least one).
3. **Growth**: one flood fill from all seeds where entering a cell costs `1 + roughness * noise`.
   The noise makes borders ragged and natural, and the flood fill guarantees that every province
   is one connected piece.
4. **Islands** are linked with sea routes so the map stays connected (`connectIslands`).

Travel distance between provinces comes from the distance between their centers
(`distancePerHex`), so large provinces take longer to cross.

## Combat model

For a side X attacked by a side Y, per tick:

```
damage(Y -> X) = attack(Y)^2 / (attack(Y) + defense(X)) * damageScale
survival(X)    = 1 - damage / totalHp(X)
```

With several enemies the damage is split evenly. All units of a side lose the same share.
`previewBattle()` plays the whole fight and tells the UI who wins and how much is left.

## Known simplifications (next steps)

- Conquest is instant when a single hostile owner is alone in a province.
- Idle armies of the same owner in the same province merge automatically.
- No retreat: armies in a battle cannot leave.
- No diplomacy, so every other owner is an enemy.
- Recruitment: the full cost is paid when ordering; a batch lost to conquest during training
  is not refunded; finished units join a stationary army of the owner or form a new one.
- Victory: a player is eliminated with no provinces, armies or batches in training. The last
  survivor wins, or whoever owns 60% of all provinces (domination). A finished game is frozen
  and rejects orders.
- AI: sees the whole map (no fog of war), does not defend, and recruits only infantry and artillery.
  Two identical AIs from a symmetric start deadlock, which is expected.
- Balance: wood is not used by any unit yet (it will be needed by buildings), and iron is the
  bottleneck of the current economy.
- Hex maps: one resource per province (chosen by regional noise, so neighbors tend to share it);
  rivers, mountains and terrain types are not generated yet; sea routes are a single link, not a path.
- No buildings, morale, terrain or generals yet.
