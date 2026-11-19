import {
  baseRuleset,
  createGame,
  runMatch,
  duelMap,
  type GameEvent,
} from '../src';

const rules = baseRuleset;

// Red starts with a bigger army, so the match has a decisive outcome.
const initial = createGame({
  map: duelMap,
  rules,
  players: [
    { id: 'red', name: 'Red Empire' },
    { id: 'blue', name: 'Blue Republic' },
  ],
  owners: {
    rcap: 'red', riron: 'red', rwood: 'red', rcoal: 'red', rfront: 'red',
    bcap: 'blue', biron: 'blue', bwood: 'blue', bcoal: 'blue', bfront: 'blue',
  },
  armies: [
    { id: 'red-1', owner: 'red', location: 'rfront', units: { infantry: 12 } },
    { id: 'blue-1', owner: 'blue', location: 'bfront', units: { infantry: 6 } },
  ],
});

function describe(event: GameEvent): string | null {
  switch (event.type) {
    case 'battle':
      return null; // too noisy
    case 'army_arrived':
      return null; // too noisy
    case 'recruit_completed':
      return null; // too noisy
    case 'recruit_cancelled':
      return `recruit batch lost at ${event.provinceId}`;
    case 'army_destroyed':
      return `${event.armyId} destroyed at ${event.provinceId}`;
    case 'province_conquered':
      return `${event.provinceId}: ${event.from ?? 'neutral'} -> ${event.to}`;
    case 'player_eliminated':
      return `${event.playerId} eliminated`;
    case 'game_over':
      return `GAME OVER: ${event.winner ?? 'nobody'} wins by ${event.reason}`;
  }
}

const final = runMatch(initial, rules, {
  aiPlayers: ['red', 'blue'],
  maxTicks: 400,
  onTick: (state) => {
    for (const event of state.events) {
      const text = describe(event);
      if (text) console.log(`[tick ${String(state.tick).padStart(3)}] ${text}`);
    }
  },
});

console.log(`\nFinished at tick ${final.tick}.`);
console.log('Outcome:', final.outcome ?? 'none (tick limit reached)');
console.log('Owners:', final.provinces.map((p) => `${p.id}=${p.owner ?? 'neutral'}`).join(', '));
for (const army of final.armies) {
  const units = Object.entries(army.units).map(([t, n]) => `${n.toFixed(1)} ${t}`).join(', ');
  console.log(`  army ${army.id} (${army.owner}) at ${army.location}: ${units}`);
}
