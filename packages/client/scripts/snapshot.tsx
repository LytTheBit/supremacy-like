import { writeFileSync, mkdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapView } from '../src/components/MapView';
import { GameSession, HUMAN_ID } from '../src/session';

// Renders the map view of a game in progress to out/map-view.svg (no browser needed).
// Usage: npx tsx scripts/snapshot.tsx [seed] [ticks]
const seed = Number(process.argv[2] ?? 7);
const ticks = Number(process.argv[3] ?? 12);

const session = new GameSession({ seed, provinces: 24, medals: [], organic: 0.6 });

// Give the player an order, then let the game run.
const first = session.getSnapshot().state;
const mine = first.armies.find((a) => a.owner === HUMAN_ID);
const target = first.provinces.find((p) => p.owner === null);
if (mine && target) session.moveArmy(mine.id, target.id);
for (let i = 0; i < ticks; i++) session.step();

const { state, visible } = session.getSnapshot();
const army = state.armies.find((a) => a.owner === HUMAN_ID);
const markup = renderToStaticMarkup(
  <MapView
    session={session}
    state={state}
    visible={new Set(visible)}
    selectedProvince={army?.location ?? null}
    selectedArmy={army?.id ?? null}
    previewPath={[]}
    onSelectProvince={() => {}}
    onSelectArmy={() => {}}
  />,
);

mkdirSync('out', { recursive: true });
const svg = markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="900" ');
writeFileSync('out/map-view.svg', svg);
console.log(`Rendered tick ${state.tick}: ${state.armies.length} armies, ${state.provinces.filter((p) => p.owner !== null).length} owned provinces -> out/map-view.svg`);
