import {
  areHostile,
  armySpeed,
  buildingLevel,
  buildingStep,
  canSpyOn,
  spyAt,
  commanderBonus,
  bombardPower,
  canDockAt,
  effectiveTrainingTicks,
  findArmyPath,
  hasLandUnits,
  hasNavalUnits,
  isSeaProvince,
  levelEffect,
  maxBuildingLevel,
  missingBuildingRequirement,
  missingUnitRequirement,
  moraleProductionFactor,
  productionMultiplier,
  type Army,
  type BuildingDef,
  type GameState,
  type Province,
  type ProvinceId,
  type Ruleset,
  type UnitDef,
} from '@supremacy/sim';
import { useState } from 'react';
import { ownerColor } from '../colors';
import { formatAmount, formatCount, formatPercent } from '../format';
import { t, useLocale } from '../i18n';
import { buildingLabel, buildingName, errorText, formatCost, playerName, resourceName, unitName } from '../labels';
import { HUMAN_ID, type GameSession } from '../session';

interface InspectorProps {
  session: GameSession;
  state: GameState;
  /** Provinces in sight right now. */
  visible: ReadonlySet<ProvinceId>;
  selectedProvince: ProvinceId | null;
  selectedArmy: string | null;
  onSelectArmy: (id: string) => void;
}

/** What a building does at a level: its effects, and the units that level newly unlocks. */
function describeBuilding(id: string, def: BuildingDef, level: number, rules: Ruleset): string {
  const parts: string[] = [];
  const production = levelEffect(def, level, 'productionMultiplier');
  if (production && production !== 1) {
    const percent = Math.round((production - 1) * 100);
    parts.push(t('building.effect.production', { percent: `${percent > 0 ? '+' : ''}${percent}` }));
  }
  const training = levelEffect(def, level, 'trainingTimeMultiplier');
  if (training && training !== 1) parts.push(t('building.effect.training', { factor: training }));
  const reduction = levelEffect(def, level, 'damageReduction');
  if (reduction) parts.push(t('building.effect.damageReduction', { percent: Math.round(reduction * 100) }));
  if (def.railSpeedFactor) parts.push(t('building.effect.railway', { factor: def.railSpeedFactor }));
  if (def.coastal) parts.push(t('building.effect.coastal'));
  if (def.harbor) parts.push(t('building.effect.harbor'));
  if (def.airbase) parts.push(t('building.effect.airbase'));
  // A unit is unlocked by the level it asks for.
  const unlocks = Object.entries(rules.units)
    .filter(([, unit]) => unit.requires?.[id] === level)
    .map(([unitId]) => unitName(rules, unitId));
  if (unlocks.length > 0) parts.push(t('building.effect.unlocks', { units: unlocks.join(', ') }));
  return parts.join(' · ');
}

function previewText(winner: string, hpLeft: number): string {
  switch (winner) {
    case 'attacker':
      return t('preview.attacker', { percent: formatPercent(hpLeft) });
    case 'defender':
      return t('preview.defender');
    case 'draw':
      return t('preview.draw');
    default:
      return t('preview.stalemate');
  }
}

export function Inspector({ session, state, visible, selectedProvince, selectedArmy, onSelectArmy }: InspectorProps) {
  useLocale();
  const army = state.armies.find((a) => a.id === selectedArmy) ?? null;
  const province = state.provinces.find((p) => p.id === selectedProvince) ?? null;

  if (!army && !province) {
    return (
      <div className="card">
        <h3>{t('help.title')}</h3>
        <p className="muted">{t('help.body')}</p>
      </div>
    );
  }

  return (
    <>
      {army ? <ArmyCard session={session} state={state} army={army} target={province} onSelectArmy={onSelectArmy} /> : null}
      {province ? (
        <ProvinceCard
          session={session}
          state={state}
          province={province}
          inSight={visible.has(province.id)}
          onSelectArmy={onSelectArmy}
        />
      ) : null}
    </>
  );
}

function ArmyCard(props: {
  session: GameSession;
  state: GameState;
  army: Army;
  target: Province | null;
  onSelectArmy: (id: string) => void;
}) {
  const { session, state, army, target } = props;
  const rules = session.rules;
  const own = army.owner === HUMAN_ID;
  const ownerName = playerName(state.players, army.owner);
  const speed = armySpeed(rules, army.units);
  const bonus = commanderBonus(rules, army.units);
  const engaged = state.armies.some((a) => a.location === army.location && areHostile(state, army.owner, a.owner));
  const [message, setMessage] = useState<string | null>(null);

  const destination = army.order ? army.order.path[army.order.path.length - 1] : undefined;
  const route =
    own && target && target.id !== army.location ? findArmyPath(state, rules, army, target.id) : null;

  // Ships and land troops share a port without mixing: load and unload them explicitly.
  const idle = army.order === null && !engaged;
  const naval = hasNavalUnits(rules, army.units);
  const here = state.provinces.find((p) => p.id === army.location);
  const docked = here !== undefined && !isSeaProvince(here) && canDockAt(state, rules, army.owner, here);
  const boardable = state.armies.filter(
    (a) =>
      a.id !== army.id &&
      a.owner === army.owner &&
      a.location === army.location &&
      a.order === null &&
      hasNavalUnits(rules, a.units),
  );
  const canBoard = own && idle && docked && !naval && hasLandUnits(rules, army.units);
  const canUnload = own && idle && docked && naval && hasLandUnits(rules, army.units);
  const preview = route && target ? session.previewAttack(army.id, target.id) : null;

  return (
    <div className="card">
      <h3>
        <span className="dot" style={{ background: ownerColor(army.owner) }} /> {t('army.title', { id: army.id })}
      </h3>
      <p className="muted">
        {t('army.location', { owner: ownerName, place: session.provinceName(army.location) })}
      </p>
      <ul className="plain">
        {Object.entries(army.units)
          .filter(([, count]) => count > 0.001)
          .map(([type, count]) => (
            <li key={type}>
              {unitName(rules, type)} × {formatCount(Math.round(count * 10) / 10)}
              {naval && rules.units[type]?.domain !== 'sea' ? ` ${t('army.aboard')}` : ''}
            </li>
          ))}
      </ul>
      <p className="muted">
        {t('army.speed', { speed })}
        {bonus > 0 ? ` · ${t('army.commanders', { percent: Math.round(bonus * 100) })}` : ''}
      </p>
      <p>
        {engaged
          ? t('army.status.battle')
          : army.order && destination !== undefined
            ? t('army.status.marching', { place: session.provinceName(destination) })
            : t('army.status.idle')}
      </p>

      {own ? (
        <div className="actions">
          {army.order ? (
            <button
              onClick={() => {
                const result = session.stopArmy(army.id);
                setMessage(result.ok ? null : errorText(result.error));
              }}
            >
              {t('army.stop')}
            </button>
          ) : null}
          {canBoard
            ? boardable.map((fleet) => (
                <button
                  key={fleet.id}
                  onClick={() => {
                    const result = session.embark(army.id, fleet.id);
                    setMessage(result.ok ? null : errorText(result.error));
                  }}
                >
                  {t('army.embark', { fleet: fleet.id })}
                </button>
              ))
            : null}
          {own && bombardPower(rules, army.units) > 0 ? (
            <button
              onClick={() => {
                const result = session.holdFire(army.id, !army.holdFire);
                setMessage(result.ok ? null : errorText(result.error));
              }}
            >
              {army.holdFire ? t('army.openFire') : t('army.holdFire')}
            </button>
          ) : null}
          {canUnload ? (
            <button
              onClick={() => {
                const result = session.disembark(army.id);
                setMessage(result.ok ? null : errorText(result.error));
              }}
            >
              {t('army.unload')}
            </button>
          ) : null}
          {route && target ? (
            <div className="move">
              <p className="muted">
                {t('army.route', {
                  place: session.provinceName(target.id),
                  count: route.path.length,
                  ticks: Math.max(1, Math.ceil(route.distance / (speed || 1))),
                })}
              </p>
              {preview ? <p className="preview">{previewText(preview.winner, preview.attackerHpLeft)}</p> : null}
              <button
                className="primary"
                onClick={() => {
                  const result = session.moveArmy(army.id, target.id);
                  setMessage(result.ok ? null : errorText(result.error));
                }}
              >
                {t('army.move', { place: session.provinceName(target.id) })}
              </button>
            </div>
          ) : (
            <p className="muted">{t('army.clickToMove')}</p>
          )}
          {message ? <p className="error">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ProvinceCard(props: {
  session: GameSession;
  state: GameState;
  province: Province;
  inSight: boolean;
  onSelectArmy: (id: string) => void;
}) {
  const { session, state, province, inSight, onSelectArmy } = props;
  const rules = session.rules;
  const own = province.owner === HUMAN_ID;
  const ownerName = province.owner === null ? t('player.neutral') : playerName(state.players, province.owner);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<string | null>(null);

  const sea = isSeaProvince(province);
  const output = province.production * productionMultiplier(rules, province) * moraleProductionFactor(rules, province);
  const constructions = state.constructionQueue.filter((j) => j.provinceId === province.id);
  const training = state.recruitQueue.filter((j) => j.provinceId === province.id);
  const present = state.armies.filter((a) => a.location === province.id);
  const moraleShare = Math.max(0, Math.min(1, province.morale / 100));

  const builtNames = province.buildings.map((id) => buildingLabel(rules, id, buildingLevel(province, id)));
  // Every building that can still be built or raised to its next level here, with that level.
  const buildable = Object.entries(rules.buildings)
    .map(([id, def]) => ({ id, def, level: buildingLevel(province, id) + 1 }))
    .filter(({ id, def, level }) => level <= maxBuildingLevel(def) && !constructions.some((j) => j.buildingType === id));

  /** "Requires: Barracks level 2" for the first missing building, or the plain message for other errors. */
  const reasonFor = (code: string, missing?: [string, number] | null): string => {
    if (!missing || (code !== 'missing_building' && code !== 'missing_prerequisite')) return errorText(code);
    const [building, level] = missing;
    return level > 1
      ? t('province.requiresLevel', { building: buildingName(rules, building), level })
      : t('province.requires', { building: buildingName(rules, building) });
  };

  return (
    <div className="card">
      <h3>
        <span className="dot" style={{ background: ownerColor(province.owner) }} />{' '}
        {session.provinceName(province.id)}
      </h3>
      <p className="muted">{sea ? t('province.seaNote') : own ? t('province.yours') : ownerName}</p>
      {!inSight && session.rules.vision.fog ? <p className="muted small">{t('province.outOfSight')}</p> : null}

      {sea ? null : (
      <dl className="facts">
        <dt>{t('province.production')}</dt>
        <dd>
          {t('province.productionValue', { resource: resourceName(province.resource), amount: formatAmount(output) })}
          {output !== province.production ? (
            <span className="muted"> {t('province.productionBase', { amount: formatAmount(province.production) })}</span>
          ) : null}
        </dd>
        <dt>{t('province.morale')}</dt>
        <dd>
          <div className="bar" title={`${Math.round(province.morale)}/100`}>
            <div
              className="bar-fill"
              style={{ width: `${moraleShare * 100}%`, background: moraleShare < 0.5 ? '#d1673c' : '#5aa36b' }}
            />
          </div>
        </dd>
        <dt>{t('province.buildings')}</dt>
        <dd>{builtNames.length > 0 ? builtNames.join(', ') : '—'}</dd>
        {constructions.length > 0 ? (
          <>
            <dt>{t('province.constructing')}</dt>
            <dd>
              {constructions
                .map((j) => `${buildingLabel(rules, j.buildingType, j.level ?? 1)} (${j.ticksLeft})`)
                .join(', ')}
            </dd>
          </>
        ) : null}
        {training.length > 0 ? (
          <>
            <dt>{t('province.training')}</dt>
            <dd>
              {training
                .map((j) => `${j.count} × ${unitName(rules, j.unitType)} (${j.ticksLeft})`)
                .join(', ')}
            </dd>
          </>
        ) : null}
      </dl>
      )}

      {present.length > 0 ? (
        <div className="chips">
          {present.map((a) => (
            <button key={a.id} className="chip" style={{ borderColor: ownerColor(a.owner) }} onClick={() => onSelectArmy(a.id)}>
              {t('province.armyChip', { id: a.id })}
            </button>
          ))}
        </div>
      ) : null}

      {own && !sea ? (
        <>
          <h4>{t('province.recruit')}</h4>
          <label className="qty">
            {t('province.quantity')}{' '}
            <select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}>
              {[1, 2, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {Object.entries(rules.units).map(([type, def]) => {
            const error = session.checkRecruit(province.id, type, quantity);
            return (
              <div className="row" key={type}>
                <div>
                  <strong>{unitName(rules, type)}</strong>
                  <div className="muted small">
                    {unitDescription(def)} · {formatCost(def.cost)} ·{' '}
                    {t('unit.ticks', { count: effectiveTrainingTicks(rules, province, type) })}
                  </div>
                  {error ? (
                    <div className="small error">{reasonFor(error, missingUnitRequirement(province, def))}</div>
                  ) : null}
                </div>
                <button
                  disabled={error !== null}
                  onClick={() => {
                    const result = session.recruit(province.id, type, quantity);
                    setMessage(result.ok ? null : errorText(result.error));
                  }}
                >
                  {t('province.recruitButton')}
                </button>
              </div>
            );
          })}

          <h4>{t('province.build')}</h4>
          {buildable.length === 0 ? <p className="muted">{t('province.allBuilt')}</p> : null}
          {buildable.map(({ id, def, level }) => {
            const error = session.checkBuild(province.id, id);
            const step = buildingStep(def, level);
            const effect = describeBuilding(id, def, level, rules);
            const missing = step ? missingBuildingRequirement(province, step.requires) : null;
            return (
              <div className="row" key={id}>
                <div>
                  <strong>
                    {level > 1
                      ? t('building.upgradeTo', { building: buildingName(rules, id), level })
                      : buildingName(rules, id)}
                  </strong>
                  <div className="muted small">
                    {effect ? `${effect} · ` : ''}
                    {formatCost(step?.cost ?? def.cost)} · {t('unit.ticks', { count: step?.buildTicks ?? def.buildTicks })}
                  </div>
                  {error ? <div className="small error">{reasonFor(error, missing)}</div> : null}
                </div>
                <button
                  disabled={error !== null}
                  onClick={() => {
                    const result = session.build(province.id, id);
                    setMessage(result.ok ? null : errorText(result.error));
                  }}
                >
                  {level > 1 ? t('province.upgradeButton') : t('province.buildButton')}
                </button>
              </div>
            );
          })}
          {message ? <p className="error">{message}</p> : null}
        </>
      ) : null}

      {!own && !sea ? <SpyPanel session={session} state={state} province={province} /> : null}
    </div>
  );

  /** Combat numbers, or the commander bonus, of a unit type. */
  function unitDescription(def: UnitDef): string {
    if (def.commander) {
      return t('unit.commander', {
        bonus: Math.round(def.commander.bonus * 100),
        max: Math.round(def.commander.maxBonus * 100),
      });
    }
    const parts = [t('unit.stats', { attack: def.attack, defense: def.defense, hp: def.hp, speed: def.speed })];
    if (def.capacity) parts.push(t('unit.carries', { count: def.capacity }));
    if (def.range) parts.push(t('unit.range', { count: def.range }));
    if (def.bombard) parts.push(t('unit.bombards', { count: def.bombard }));
    if (def.railOnly) parts.push(t('unit.railOnly'));
    if (def.stealth) parts.push(t('unit.stealth'));
    return parts.join(' · ');
  }
}

/** Send a spy to a foreign province, follow it and give it a mission. */
function SpyPanel(props: { session: GameSession; state: GameState; province: Province }) {
  const { session, state, province } = props;
  const espionage = session.rules.espionage;
  const [message, setMessage] = useState<string | null>(null);
  if (!espionage || !canSpyOn(state, HUMAN_ID, province)) return null;

  const spy = spyAt(state, HUMAN_ID, province.id);
  const sent = state.spies.filter((s) => s.owner === HUMAN_ID).length;
  const run = (result: { ok: true } | { ok: false; error: string }) => setMessage(result.ok ? null : errorText(result.error));
  const mission = spy?.mission ?? null;
  const inPlace = spy !== undefined && spy.infiltrationLeft <= 0;

  let status: string | null = null;
  if (spy && !inPlace) status = t('spy.travelling', { count: spy.infiltrationLeft });
  else if (spy && mission?.kind === 'sabotage') {
    status = t('spy.mission.sabotage', {
      building: buildingName(session.rules, mission.buildingType),
      count: mission.ticksLeft,
    });
  } else if (spy && mission?.kind === 'disinformation') status = t('spy.mission.disinformation', { count: mission.ticksLeft });
  else if (spy) status = t('spy.inPlace', { count: spy.coverLeft });

  const sendError = spy ? null : session.checkSpy(province.id);
  const sabotageShort = spy !== undefined && spy.coverLeft < espionage.sabotage.ticks;
  const disinformationShort = spy !== undefined && spy.coverLeft < espionage.disinformation.ticks;

  return (
    <>
      <h4>{t('spy.title')}</h4>
      <p className="muted small">{t('spy.count', { count: sent, max: espionage.maxSpies })}</p>

      {status ? <p>{status}</p> : null}

      {!spy ? (
        <div className="row">
          <div>
            <div className="muted small">{t('spy.cost', { cost: formatCost(espionage.cost) })}</div>
            {sendError ? <div className="small error">{errorText(sendError)}</div> : null}
          </div>
          <button disabled={sendError !== null} onClick={() => run(session.spy(province.id))}>
            {t('spy.send')}
          </button>
        </div>
      ) : null}

      {spy && inPlace && !mission ? (
        <>
          {province.buildings.map((id) => (
            <div className="row" key={id}>
              <div>
                <strong>{buildingLabel(session.rules, id, buildingLevel(province, id))}</strong>
                <div className="muted small">{t('spy.sabotage.hint', { count: espionage.sabotage.ticks })}</div>
              </div>
              <button
                disabled={sabotageShort}
                onClick={() => run(session.spyMission(spy.id, { kind: 'sabotage', buildingType: id }))}
              >
                {t('spy.sabotage', { building: buildingName(session.rules, id) })}
              </button>
            </div>
          ))}
          {province.buildings.length === 0 ? <p className="muted small">{t('spy.noBuildings')}</p> : null}
          <div className="row">
            <div>
              <strong>{t('spy.disinformation')}</strong>
              <div className="muted small">
                {t('spy.disinformation.hint', {
                  damage: espionage.disinformation.moraleDamage,
                  ticks: espionage.disinformation.ticks,
                })}
              </div>
            </div>
            <button disabled={disinformationShort} onClick={() => run(session.spyMission(spy.id, { kind: 'disinformation' }))}>
              {t('spy.disinformation')}
            </button>
          </div>
          {sabotageShort || disinformationShort ? <p className="muted small">{t('spy.coverTooShort')}</p> : null}
        </>
      ) : null}

      {spy ? <button onClick={() => run(session.recallSpy(spy.id))}>{t('spy.recall')}</button> : null}
      {message ? <p className="error">{message}</p> : null}
    </>
  );
}
