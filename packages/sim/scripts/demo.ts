import {
  baseRuleset,
  createGame,
  orderMove,
  orderRecruit,
  previewBattle,
  tick,
  tinyMap,
  type GameEvent,
  type GameState,
} from '../src';

const rules = baseRuleset;

let state: GameState = createGame({
  map: tinyMap,
  rules,
  players: [
    { id: 'red', name: 'Red Empire' },
    { id: 'blue', name: 'Blue Republic' },
  ],
  owners: {
    redhaven: 'red',
    westmark: 'red',
    eastmark: 'blue',
    bluehaven: 'blue',
  },
  armies: [
    { id: 'red-1', owner: 'red', location: 'westmark', units: { infantry: 15 } },
    { id: 'blue-1', owner: 'blue', location: 'eastmark', units: { infantry: 10 } },
  ],
});

// The "calculator": predict the outcome before committing to the attack.
const preview = previewBattle(rules, { infantry: 15 }, { infantry: 10 });
console.log(
  `Preview: ${preview.winner} wins in ${preview.rounds} rounds, ` +
    `attacker keeps ${(preview.attackerHpLeft * 100).toFixed(0)}% of its strength.\n`,
);

const result = orderMove(state, 'red', 'red-1', 'eastmark');
if (!result.ok) throw new Error(`Order failed: ${result.error}`);
state = result.state;

function describe(event: GameEvent): string {
  switch (event.type) {
    case 'army_arrived':
      return `${event.armyId} arrived at ${event.provinceId}`;
    case 'recruit_completed':
      return `${event.count} ${event.unitType} trained at ${event.provinceId} -> ${event.armyId}`;
    case 'recruit_cancelled':
      return `recruit batch ${event.jobId} lost at ${event.provinceId}`;
    case 'player_eliminated':
      return `${event.playerId} eliminated`;
    case 'game_over':
      return `game over: ${event.winner ?? 'nobody'} wins by ${event.reason}`;
    case 'battle':
      return `battle at ${event.provinceId} (${event.owners.join(' vs ')})`;
    case 'army_destroyed':
      return `${event.armyId} destroyed at ${event.provinceId}`;
    case 'province_conquered':
      return `${event.provinceId} conquered: ${event.from ?? 'neutral'} -> ${event.to}`;
  }
}

for (let i = 0; i < 60; i++) {
  state = tick(state, rules);

  // After the first tick red has some resources: train reinforcements.
  if (state.tick === 1) {
    const recruit = orderRecruit(state, rules, 'red', 'redhaven', 'infantry', 1);
    if (recruit.ok) state = recruit.state;
    else console.log(`Recruit refused: ${recruit.error}`);
  }

  for (const event of state.events) {
    console.log(`[tick ${String(state.tick).padStart(2)}] ${describe(event)}`);
  }
  const fighting = state.armies.some((a) => a.owner === 'red') && state.armies.some((a) => a.owner === 'blue');
  if (!fighting && state.tick > 3) break;
}

console.log('\nFinal state');
for (const army of state.armies) {
  const units = Object.entries(army.units)
    .map(([type, count]) => `${count.toFixed(1)} ${type}`)
    .join(', ');
  console.log(`  army ${army.id} at ${army.location}: ${units}`);
}
for (const player of state.players) {
  console.log(`  ${player.name}: ${JSON.stringify(player.stockpile)}`);
}
console.log(
  '  owners:',
  state.provinces.map((p) => `${p.id}=${p.owner ?? 'neutral'}`).join(', '),
);
