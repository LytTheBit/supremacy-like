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
    case 'army_landed':
    case 'coast_bombarded':
      return null; // too noisy
    case 'recruit_completed':
      return null; // too noisy
    case 'recruit_cancelled':
      return `recruit batch lost at ${event.provinceId}`;
    case 'army_destroyed':
      return `${event.armyId} destroyed at ${event.provinceId}`;
    case 'province_conquered':
      return `${event.provinceId}: ${event.from ?? 'neutral'} -> ${event.to}`;
    case 'building_completed':
      return `${event.buildingType} completed at ${event.provinceId}`;
    case 'building_cancelled':
      return `${event.buildingType} lost at ${event.provinceId}`;
    case 'player_eliminated':
      return `${event.playerId} eliminated`;
    case 'game_over':
      return `GAME OVER: ${event.winners.join(' + ') || 'nobody'} wins by ${event.reason}`;
    case 'proposal_made':
    case 'proposal_accepted':
    case 'proposal_rejected':
    case 'proposal_expired':
    case 'trade_offered':
    case 'trade_accepted':
    case 'trade_rejected':
    case 'trade_cancelled':
    case 'trade_expired':
    case 'gift_sent':
    case 'chat_intercepted':
      return null; // too noisy
    case 'province_transferred':
      return `${event.provinceId} passes from ${event.from} to ${event.to}`;
    case 'war_declared':
      return null; // too noisy
    case 'relation_changed':
      return `${event.a} and ${event.b}: ${event.status}`;
    case 'spy_in_place':
    case 'spy_mission_failed':
      return null; // too noisy
    case 'spy_removed':
      return event.reason === 'cover_blown' ? `${event.owner}'s spy caught at ${event.provinceId}` : null;
    case 'building_sabotaged':
      return `${event.buildingType} sabotaged at ${event.provinceId}`;
    case 'morale_sabotaged':
      return `morale at ${event.provinceId} lowered by ${event.damage}`;
    case 'market_trade':
    case 'market_order_expired':
      return null; // too noisy
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
