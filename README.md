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
    pathfinding.ts  Dijkstra on the province graph (optional rule for which steps are allowed)
    naval.ts        sea provinces, ships, ports, cargo, landings: movement rules per army
    combat.ts       simplified combat model + previewBattle() "calculator"
    world.ts        createGame(): builds and validates the initial state
    orders.ts       player orders (orderMove, orderStop, orderRecruit, orderBuild, orderEmbark, orderDisembark), validated and pure
    diplomacy.ts    relations, proposals, declarations of war (orderPropose, orderRespond, orderDeclareWar)
    espionage.ts    spies: orderSpy, orderSpyMission, orderRecallSpy, processEspionage (a phase of tick)
    market.ts       barter order book: orderMarketOffer, orderMarketAccept, orderMarketCancel, processMarket (a phase of tick)
    visibility.ts   fog of war: visibleProvinces, viewFor (the game as one player knows it)
    buildings.ts    effects of buildings (production, training time)
    morale.ts       province morale effects (production, recruitment)
    medals/         optional rules chosen when a game is created (generals)
    setup.ts        createSkirmish(): a ready-to-play game on a generated map
    tick.ts         tick(): diplomacy -> movement -> combat -> morale -> conquest -> training -> building -> espionage -> merging -> production -> victory -> market
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
    log.ts          turns game events into event-log lines (written when shown, so they follow the language)
    labels.ts       display names of units, buildings, resources, medals and players
    format.ts       numbers in the current language
    i18n/           translations: en.ts (reference), it.ts, locales.ts (the list of languages), index.ts (t, setLocale)
    components/     MapView (SVG), Inspector, DiplomacyPanel, MarketPanel, TopBar, EventLog, NewGame, LanguageSelect
  scripts/snapshot.tsx
```

## Sea and ships

Sea provinces are opt-in (`generateHexMap({ seaProvinceCount })`, or "Mari e flotte" in the client);
without them nothing changes. Sea provinces are never owned and produce nothing.

- **Port** (coastal only) trains ships and lets them dock. **Cruiser** fights; **Transport** carries 10 land units.
- A fleet sails through sea provinces; land troops ride along as cargo (`orderEmbark` in a port).
- Cargo does not fight at sea but dies with its ships. Fleets cannot enter enemy land.
- Landing: a fleet moving to a coastal land province drops its troops there as the last step; the ships stay at sea.
- Domination counts land provinces only.

- **Coastal bombardment:** ships with a `bombard` value (cruiser, battleship; not transports) shell the enemy armies on one
  adjacent coast per tick while at sea, one-sided (no return fire). `orderHoldFire` stops/restarts it per fleet.

## Air

- **Airfield** trains aircraft and is where they land (own or allied). **Fighter** and **Bomber** fly over land and sea,
  but never farther than their `range` from an airbase; an idle air army away from a base flies back on its own
  and is lost if no base is in reach. Aircraft can leave a fight, never conquer, and are cheap to lose to massed rifles.
- `UnitDef.vs` multiplies attack against land/sea/air targets (bombers beat ground and ships, fighters beat aircraft,
  artillery cannot shoot at aircraft). Without any `vs` combat is exactly as before.

## AI

Besides the land game the AI builds an airfield (from `minProvincesForAir` provinces), trains fighters and bombers and
raids visible enemy armies it would beat, flying home when it loses. When no target is left on foot and the map has seas
it builds a port, gathers troops there, trains transports and cruisers, embarks, sails, lands, and brings the ships
back. Switch parts off with `airForce: false` / `navy: false`.

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
(`distancePerHex`), so large provinces take longer to cross. Each link also has a `split`: where the
border between the two provinces lies on the road (a share of the distance, counted from `a`; computed
from the shared hex edges, so a big province owns more of the road; default 0.5).

An army on the road covers `speed x bonus` of it per tick, where the bonus is that of the province it is
inside at that point of the road (before the border: the province it left; after it: the one it enters).
The bonus is looked up again every tick, so a railway built or lost during a long march changes the rest
of the march at once.

## Buildings

Defined in the ruleset (`buildings`), so eras and medals can change them. A building def describes
level 1; `upgrades` lists the levels above it (cost, time, effects). Costs are in thousands and are
placeholders to balance. Base ruleset:

| Building | Needs (same province) | Levels | Cost of level 1 | Effect |
|---|---|---|---|---|
| recruitment office | nothing | 1 | 2 wood, 0.5 grain, 2 ticks | infantry can be trained here |
| barracks | office | 3 | 4 wood, 2 iron, 3 ticks | training time x0.5 / x0.4 / x0.33 |
| workshop | barracks | 3 | 5 wood, 1 coal, 4 ticks | production +50% / +60% / +70%; unlocks cavalry and armored cars (1), balloons (2) |
| factory | workshop 2 (levels 3-4: workshop 3) | 4 | 6 wood, 4 iron, 2 coal, 5 ticks | production +10% .. +25%; unlocks artillery (1), tanks (2), railway guns (3, with a railway), heavy tanks (4) |
| fortress | barracks | 5 | 3 wood, 3 iron, 4 ticks | stops 50% / 60% / 70% / 80% / 90% of the damage to the troops of the owner (and allies) in the province |
| railway | nothing | 1 | 5 wood, 2 iron, 3 ticks | production +10%; troops of the owner (and allies) are 2x faster while they are inside the province, wherever on the map; railway guns only move between two railways |
| port | coast | 1 | 6 wood, 3 iron, 4 ticks | ships are trained and dock here; submarines also need a factory 2 |
| airfield | nothing | 1 | 5 wood, 3 iron, 4 ticks | aircraft are trained and land here |

- `orderBuild` pays the full cost of the step at once. Ordering a building that already stands in the
  province upgrades it by one level (`already_built` at the top level); one construction per
  building type per province. The buildings it depends on must stand there at the needed level
  (`missing_prerequisite`).
- `Province.buildings` lists the buildings; `Province.buildingLevels` holds the levels above 1. Read
  them with `buildingLevel()`, `levelEffect()` and the other helpers of `buildings.ts`.
- A construction lost to conquest before completion is not refunded. Completed buildings (with their
  levels) stay in the province and pass to the conqueror. Sabotage takes away one level at a time.
- Effects multiply (`productionMultiplier`, `trainingTimeMultiplier`); training never takes less than 1 tick.
- Units say what they need in `UnitDef.requires`: `{ factory: 2 }` means a factory of level 2 or more.
- Starting buildings go in `createGame({ buildings })`; `rules.startingBuildings` (a recruitment
  office) stands in every province a player starts with in a skirmish.
- The AI finds building types from the ruleset data, not by name: training boosters first, then
  the buildings its units require (it walks up the whole chain in one province, one building per turn),
  then economy buildings that can be built right away, in its most productive provinces (limit
  `maxEconomyBuildings`). It trains only infantry, artillery and commanders on land, so it never
  builds the industry of the other units.

## Units

Costs, times, stats and requirements are in `rules.units`. New in this version: cavalry, armored car,
tank, heavy tank, railway gun, observation balloon and submarine. Special flags on `UnitDef`:

- `railOnly`: moves only between provinces that both have a railway of its owner (or an ally).
- `stealth`: enemies see it only from within `rules.vision.stealthRadius` (submarines); a mixed army is not hidden.

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
- Allies share their vision (see Fog of war).

## Fog of war

With `rules.vision.fog` on (the default) a player only knows what lies within their vision.

- **Vision** is a travel distance along the links between provinces. Owned provinces see
  `vision.provinceRadius` (2.5); an army sees as far as its best unit: `UnitDef.vision`, or
  `vision.unitRadius` (2) when a unit does not say (infantry 2.5, artillery 1.5). Allies share vision;
  truce partners do not.
- `visibleProvinces(state, rules, player)` gives the provinces in sight.
- `viewFor(state, rules, player, memory?)` gives the game as that player knows it: a copy of the state
  without enemy armies out of sight, without other players' stockpiles and queues, and with the events
  about unseen places removed. **Ownership of provinces stays public**, like treaties.
  Buildings and morale of provinces out of sight show what was last seen (`PlayerView.memory`; pass the
  previous memory back in), or nothing if never seen.
- The real state never changes because of fog: it only decides what each player knows.
- **AI**: it obeys the fog. It only knows enemy armies inside its own vision, and assumes a province it
  cannot see is empty when it plans an attack.
- **Client**: `GameSession` keeps the real state private; snapshots carry the player's view and the list of
  visible provinces. Provinces out of sight are darkened. The fog can be turned off when creating a game.

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

## Espionage

Implemented in `espionage.ts`; the numbers are in `rules.espionage` (omit it to play without spies).

- **Sending**: `orderSpy(state, rules, player, province)` sends a spy to a land province owned by a
  player who is not an ally (an enemy, or a truce partner). The cost (`cost`, grain and wood for now) is
  paid at once. At most one spy per province and `maxSpies` per player. The spy needs `infiltrateTicks`
  to get into place.
- **Watching**: a spy in place puts its province in sight (buildings, morale, armies), and also shows
  the jobs being trained or built there and the stockpile of the province's owner (`viewFor`).
  Allies share it like any other vision. Other players' spies are never in a view, fog or not.
- **Missions**: `orderSpyMission` gives a spy in place one mission, after which it goes home.
  *Sabotage* destroys a chosen building (`sabotage.ticks`); *disinformation* lowers the morale of the
  province by `disinformation.moraleDamage`. A building already gone makes the mission fail
  (the spy goes on watching).
- **Cover**: nothing is random. A spy in place is caught exactly `coverTicks` ticks later, so a mission
  must finish before that (the interface and the AI check it). The spy is also dropped when its province
  stops being foreign to it (conquered, or its owner became an ally) and when its owner is eliminated.
- **Events**: the owner hears about its spies. The victim of a sabotage hears about the damage, never
  about who did it (`by` is hidden in its view), and about a spy that was caught.
- **AI**: every few ticks, if it has resources to spare, it sends a spy to the nearest enemy province;
  a spy in place at war sabotages the most expensive building, or else spreads disinformation.
  It only watches truce partners.

## Market

Implemented in `market.ts`; the numbers are in `rules.market` (omit it to play without a market).
There is no money in the game, so the market is a **barter order book**: an offer says what you give and
what you want in return ("2000 grain for 1500 iron"). It works like a continuous exchange.

- **Placing an offer**: `orderMarketOffer(state, rules, player, give, giveAmount, want, wantAmount)`.
  What you offer leaves your stockpile at once and is held in the order, so the same resources can never
  be spent twice. At most `maxOrders` open offers per player, and each offer gives at least `minAmount`.
- **Matching**: the new offer is traded right away against the open offers of other players that give what it
  wants and want what it gives. The best price for the newcomer goes first (ties: the older offer), and every
  trade happens at the price of the **older** offer, so whoever posted first never gets less than they asked.
  Trades can be partial: an open offer keeps its price while it fills (both amounts shrink in the same
  proportion) and what is left stays open. Offers never cross while they rest on the book, and a player's own
  offers never trade with each other.
- **Taking an offer**: `orderMarketAccept` posts the mirror of somebody else's offer (the client's *Accept* button).
- **Closing**: `orderMarketCancel` returns what is left. An offer expires after `orderTicks` (what is left comes
  back and the owner hears about it). A leftover below `minAmount` is not kept on the book: it goes back to its
  owner. The offers of an eliminated player vanish.
- **Public book**: everybody sees every open offer, its owner and its price, fog of war or not. The trades
  themselves (`market_trade`, `market_order_expired`) are private: each side only hears about its own.
  Anyone can trade with anyone, even a player they are at war with.
- Resources are conserved: a trade only moves them (the tests check the totals after many trades).
- **AI**: every `marketInterval` ticks, after building and recruiting, it compares each resource with its average
  stock: far above is a surplus, far below a shortage. It takes an open offer that gives the shortage for the
  surplus if it gets at least `marketAcceptRate` per unit it gives; else it offers up to half of the excess for
  the shortage at `marketAskRate`. Switch it off with `market: false`.

## Languages

The interface speaks every language listed in `packages/client/src/i18n/locales.ts` (English and
Italian for now). The choice is saved in the browser; the first time the browser language is used,
else English. Code, comments and the game data stay in English: only what the player reads is translated.

- All texts are in a catalog: `en.ts` is the reference, `it.ts` the translation. A message is a string
  with `{placeholders}`, or `{ one, other, ... }` plural forms chosen by the language's own rules
  (`Intl.PluralRules`), with the number in `{count}`. Never build a sentence out of pieces.
- Names that come from the game data have keys made from their id (`unit.infantry`, `building.port`,
  `resource.iron`, `medal.generals.name`, `error.<code>` for failed orders). A missing one shows the
  English name from the rules, so new content never breaks the interface.
- The simulator has no texts at all: events and errors are codes, and the client writes the sentences.
  The event log keeps functions that write the line when it is shown, so changing language
  translates the log too.

**To add a language** (say German): copy `en.ts` to `de.ts`, type it `Catalog` and translate the values
(use `Partial<Catalog>` while it is unfinished: missing messages show in English), then add
`de: { name: 'Deutsch', messages: de }` to `LOCALES` (and `dir: 'rtl'` for a right-to-left language).
The selector, the saved choice and the browser detection pick it up. The tests check that every
key, every placeholder, every unit/building/resource/medal and every error code of the simulator is
translated in every complete language.

## Web client

`npm run client` starts a game against the AI. Pick the map seed, the number of provinces, the
medals and how organic the borders look (visual only). The game starts paused: use the speed
buttons (1 tick per second at 1x). Click a province to see it, recruit and build; the Market panel lists offers of others (Accept) and yours (Cancel) and posts new ones; click one of your
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
- Fog of war has no "last seen armies": an enemy army that leaves your sight simply disappears from the map.
- Diplomacy is basic: no messages, no demands, no direct deals between players (only the public market), and nobody gets a say when an ally is attacked.
- Espionage has no counter-espionage yet (the defender cannot hunt spies), spies cannot be sent to
  neutral provinces or the sea, and a spy cannot be moved: it is recalled and a new one is sent.
- Market: barter only (no money, fees or price history); trading is not limited by diplomacy or distance, and the AI does not judge who it trades with.
- Right-to-left languages set `dir="rtl"` on the page but the stylesheet is not mirrored yet.
- Recruitment: the full cost is paid when ordering; a batch lost to conquest during training
  is not refunded; finished units join a stationary army of the owner or form a new one.
- Victory: a player is eliminated with no provinces, armies or batches in training. The last
  survivor wins, or whoever owns 60% of all provinces (domination), or a group of allies that together own it (coalition). A finished game is frozen
  and rejects orders.
- AI: obeys the fog of war, does not defend, and recruits only infantry and artillery (it still fights
  armies made of any unit).
  Two identical AIs from a symmetric start deadlock, which is expected.
- Balance: wood is not used by any unit yet (it will be needed by buildings), and iron is the
  bottleneck of the current economy.
- Hex maps: one resource per province (chosen by regional noise, so neighbors tend to share it);
  rivers, mountains and terrain types are not generated yet; sea routes are a single link, not a path.
- Buildings cannot be damaged by bombing or demolished (sabotage lowers a level). Fortresses do not hide
  the composition of the troops; railway guns have no range beyond their province.
- The client plays one human against one AI (so the diplomacy panel has one row for now), and a game lives in the browser tab (no saving).
- The AI trains commanders only once it has an army, and does not use morale to choose targets.

## Chat, money and deals

- **Money** is a resource (`rules.economy.currency`): every owned land province earns `incomePerProvince` per tick (scaled by morale). Nothing costs money yet; add `money` to a unit/building/spy cost to make it a sink.
- **Chat** (`sim/src/chat.ts`): every conversation is a `Chat` (`direct` today, `group` ready for alliances). Messages are text, offer cards (treaties and trades, with their status), gifts or notices of war. Treaty offers now live in the chat.
- **Deals** (`sim/src/trade.ts`): `orderOfferTrade` / `orderRespondTrade` / `orderCancelTrade` swap resources, money and provinces; `orderGift` delivers at once. The AI accepts fair deals when not at war and never gives provinces away.
- **Spies** in place in a province read the chats of its owner from then on, plus the last `espionage.chatContext` messages before they arrived. Nobody in the chat learns about it.
- **Market**: shown as a money board per good (prices per 1k); barter stays available.
