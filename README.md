# Supremacy-like

A real-time grand strategy game inspired by Supremacy 1914, in two packages:

- `packages/sim`: the **simulation core**, a pure and deterministic TypeScript library with no graphics and no I/O.
- `packages/client`: the **web client** (React + Vite, map drawn as SVG) that plays a game against the AI.

## Getting started

```bash
npm install
npm run client    # web client: open the address it prints (http://localhost:5173)
npm run build:client   # production build of the client in packages/client/dist
npm test          # all tests (vitest), both packages
npm run typecheck # strict TypeScript check, both packages
npm run demo      # play a small battle on the tiny map
npm run match     # AI vs AI match on the 12-province duel map
npm run genmap -w @supremacy/sim -- --seed 7 --provinces 24 --organic 0.6   # generate a hex map, writes SVG + JSON to packages/sim/out/
npm run snapshot -w @supremacy/client   # render the client map mid-game to packages/client/out/map-view.svg
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
    orders.ts       player orders (orderMove, orderStop, orderRecruit, orderBuild), validated and pure
    diplomacy.ts    relations, proposals, declarations of war (orderPropose, orderRespond, orderDeclareWar)
    buildings.ts    effects of buildings (production, training time)
    morale.ts       province morale effects (production, recruitment)
    medals/         optional rules chosen when a game is created (generals)
    setup.ts        createSkirmish(): a ready-to-play game on a generated map
    tick.ts         tick(): diplomacy -> movement -> combat -> morale -> conquest -> training -> building -> merging -> production -> victory
    victory.ts      eliminations, last standing, domination
    ai.ts           runAi(): rule-based AI that plays through the normal orders
    match.ts        runMatch(): headless game loop (AI players, tick limit)
    hexmap/         hexagonal maps: generation, province graph, validation, organic borders, SVG preview
  scripts/demo.ts, scripts/match.ts, scripts/genmap.ts
examples/           sample generated maps (open the SVGs in a browser)
  test/

packages/client/
  src/
    session.ts      GameSession: map, ruleset, state, AI and player orders, with no React
    log.ts          turns game events into event-log lines
    components/     MapView (SVG), Inspector, DiplomacyPanel, TopBar, EventLog, NewGame
  scripts/snapshot.tsx
```

Planned: `server` (Node + WebSocket) for online multiplayer.

## Resource scale

Resource amounts (production, costs, stockpiles) are in thousands: a barracks costs 4000 wood and
2000 iron, a province makes 1000-3000 per tick. This leaves room for fractions and for resource
chains later. The client shows them as `12.3k`.

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
renderSvg(map, {organic})  ->  SVG preview
buildOrganicShapes(map)   ->  smooth irregular outlines (visual only)
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

### Organic borders (visual only)

`--roughness` changes the map itself: it decides which cell belongs to which province, so it
changes the game graph. **Organic borders do not.** They only change how borders are drawn, so
there are no straight lines and no hexagon steps, like on a real map.

`buildOrganicShapes(map, { strength, seed, size })` (`hexmap/organic.ts`) turns every border into a
smooth curve and returns, per province, SVG path data and flattened polygons (islands and enclaves
are separate loops: fill with the even-odd rule), plus the shared borders and coastlines. Both provinces
on each side of a border get exactly the same curve, so there are no gaps. `strength` goes from 0 to 1;
`renderSvg(map, { organic: 0.6 })` and `genmap --organic 0.6` use it (0 draws plain hexes).

Travel distance between provinces comes from the distance between their centers
(`distancePerHex`), so large provinces take longer to cross.

## Buildings

Defined in the ruleset (`buildings`), so eras and medals can change them. Base ruleset:

| Building | Cost | Build time | Effect |
|---|---|---|---|
| barracks | 4 wood, 2 iron | 3 ticks | training in the province takes half the time |
| factory | 6 wood, 4 iron, 2 coal | 5 ticks | required to train artillery (`requires` on the unit) |
| workshop | 5 wood, 1 coal | 4 ticks | +50% production of the province |

- `orderBuild` pays the full cost immediately; one building of each type per province.
- A construction lost to conquest before completion is not refunded. Completed buildings stay
  in the province and pass to the conqueror.
- Effects multiply (`productionMultiplier`, `trainingTimeMultiplier`); training never takes less than 1 tick.
- Starting buildings go in `createGame({ buildings })`.
- The AI finds building types from the ruleset data, not by name: training boosters first, then
  the buildings units require, then economy buildings in its most productive provinces (limit
  `maxEconomyBuildings`). One construction per turn.

## Morale

Every province has a morale from 0 to 100 (base game, not a medal).

- A conquered province drops to 25 and regains 2 per tick.
- Production is scaled from 25% at morale 0 to 100% at morale 100.
- Troops cannot be trained below morale 50 (`low_morale`).

All numbers are in `ruleset.morale`.

## Diplomacy

Two players with no treaty are **at war** (every game starts like this). Only players at war fight
each other, block each other's recruiting and construction, and conquer each other's provinces.
Truce partners and allies can share a province and walk through each other's land.

| Treaty | Duration | Notes |
|---|---|---|
| truce | `diplomacy.truceTicks` (60) | the war resumes when it runs out; can be renewed with a new proposal |
| alliance | until someone declares war | allies together count for the coalition victory |

- `orderPropose(state, rules, from, to, 'truce' | 'alliance')` makes an offer; `orderRespond(..., proposalId, accept)`
  answers it. An unanswered offer is withdrawn after `diplomacy.proposalTicks` (30).
- `orderDeclareWar` breaks a treaty after `diplomacy.warNoticeTicks` (5); the treaty still protects both sides
  during the notice. With a notice of 0 the war starts at once.
- Treaties are stored in `GameState.relations`, and only treaties: a pair that is not listed is at war.
  Use `relationBetween`, `areHostile` and `areAllied` instead of reading the list.
- Events caused by orders (`proposal_made`, `war_declared`, ...) are stamped with the next tick and kept by `tick()`,
  so the interface sees them in the following tick together with the tick's own events.
- Combat: `resolveRound(rules, sides, hostile)` takes an optional hostility function; allies stand side by side,
  and a side's damage is split between the sides it fights. A province is only conquered by players at war with
  its owner, and never while a battle is going on in it.
- **Coalition victory**: allies that are all allied with each other win together when, as a group, they own
  `victory.provinceShare` of the provinces. Being allied is never enough on its own. `GameOutcome.winners` lists
  everyone who won (`winner` is the first).
- AI: accepts a truce from a player stronger than itself, accepts an alliance when both fight a common enemy,
  rejects the rest. Every 10 ticks it asks for a truce from a player much stronger than itself and offers an
  alliance to a truce partner that shares an enemy. It never declares war and never attacks a player it is not
  at war with.
- Shared vision between allies arrives with fog of war.

## Medals and generals

A medal (`medals/medal.ts`) is a ruleset modifier chosen **when a game is created**:
`rulesetWithMedals(baseRuleset, ['generals'])`. It checks eras, requirements and conflicts, never
modifies the base ruleset, and gives the result an id like `base+generals`. A game can only be
advanced with the ruleset it was created with (`tick` throws otherwise).

The **generals** medal adds the Military Academy and three commanders, trained like any unit
(the academy is required). Commanders do not fight: they raise the attack and defense of their army.

| Commander | Bonus each | Maximum |
|---|---|---|
| Major | +2% | +20% (10 of them) |
| Colonel | +5% | +20% (4 of them) |
| General | +20% | +20% |

Types add up: 10 majors, 4 colonels and a general give +60%. `commanders.maxAffectedTroops` can
limit how many troops benefit. Without the medal, these units and the building do not exist.

## Web client

`npm run client` starts a game against the AI. Pick the map seed, the number of provinces, the
medals and how organic the borders look (visual only). The game starts paused: use the speed
buttons (1 tick per second at 1x). Click a province to see it, recruit and build; click one of your
armies (the numbered box), then a destination province to move it. Attacks show a battle preview.

Everything about the game lives in `GameSession`; React only draws snapshots and calls its methods,
so the logic is tested without a browser.

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
- Diplomacy is basic: no messages, no trade, no demands, and nobody gets a say when an ally is attacked.
- Recruitment: the full cost is paid when ordering; a batch lost to conquest during training
  is not refunded; finished units join a stationary army of the owner or form a new one.
- Victory: a player is eliminated with no provinces, armies or batches in training. The last
  survivor wins, or whoever owns 60% of all provinces (domination), or a group of allies that together own it (coalition). A finished game is frozen
  and rejects orders.
- AI: sees the whole map (no fog of war), does not defend, and recruits only infantry and artillery.
  Two identical AIs from a symmetric start deadlock, which is expected.
- Balance: wood is not used by any unit yet (it will be needed by buildings), and iron is the
  bottleneck of the current economy.
- Hex maps: one resource per province (chosen by regional noise, so neighbors tend to share it);
  rivers, mountains and terrain types are not generated yet; sea routes are a single link, not a path.
- No terrain or fog of war yet. Buildings cannot be damaged, upgraded or demolished.
- The client plays one human against one AI (so the diplomacy panel has one row for now), and a game lives in the browser tab (no saving).
- The AI trains commanders only once it has an army, and does not use morale to choose targets.
