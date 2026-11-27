import type { GameEvent, GameState, Ruleset } from '@supremacy/sim';
import { buildingLabel, buildingName, formatBundle, formatCost, playerName, unitName } from './labels';
import { t } from './i18n';

export interface LogEntry {
  id: number;
  tick: number;
  tone: 'info' | 'good' | 'bad';
  /**
   * The line, written when it is shown, not when it happened: a language change then translates
   * the whole log. (The log only lives in the interface; it is not part of the game state.)
   */
  text: () => string;
}

export interface LogContext {
  rules: Ruleset;
  /** Name of a province in the current language. */
  placeName: (id: string) => string;
  humanId: string;
  /** State before the tick that produced the events (armies and jobs that disappeared are found here). */
  previous: GameState;
  /** State after the tick. */
  next: GameState;
}

type Line = { tone: LogEntry['tone']; text: () => string };

/**
 * Turns a game event into a line for the event log, or null when it is not worth showing.
 * Battles are handled separately by the session (one line when a battle starts).
 *
 * Everything that depends on the language happens inside the `text` function.
 */
export function describeEvent(event: GameEvent, ctx: LogContext): Line | null {
  const place = (id: string) => ctx.placeName(id);
  const player = (id: string | null) => playerName(ctx.next.players, id);
  const provinceOwner = (id: string) => ctx.next.provinces.find((p) => p.id === id)?.owner ?? null;

  switch (event.type) {
    case 'army_arrived': {
      const army = ctx.next.armies.find((a) => a.id === event.armyId);
      if (army?.owner !== ctx.humanId) return null;
      return { tone: 'info', text: () => t('log.army_arrived', { army: event.armyId, place: place(event.provinceId) }) };
    }
    case 'army_landed': {
      const army = ctx.next.armies.find((a) => a.id === event.armyId);
      if (army?.owner !== ctx.humanId) return null;
      return { tone: 'good', text: () => t('log.army_landed', { army: event.armyId, place: place(event.provinceId) }) };
    }
    case 'coast_bombarded': {
      // Shelling goes on for many ticks: tell only when it starts.
      const already = ctx.previous.events.some(
        (e) => e.type === 'coast_bombarded' && e.armyId === event.armyId && e.provinceId === event.provinceId,
      );
      if (already) return null;
      const fleet = ctx.next.armies.find((a) => a.id === event.armyId);
      const ours = ctx.next.provinces.find((p) => p.id === event.provinceId)?.owner === ctx.humanId;
      if (fleet?.owner === ctx.humanId) {
        return { tone: 'good', text: () => t('log.coast_bombarded.ours', { army: event.armyId, place: place(event.provinceId) }) };
      }
      return ours ? { tone: 'bad', text: () => t('log.coast_bombarded.enemy', { place: place(event.provinceId) }) } : null;
    }
    case 'army_destroyed': {
      const army = ctx.previous.armies.find((a) => a.id === event.armyId);
      const ours = army?.owner === ctx.humanId;
      return {
        tone: ours ? 'bad' : 'good',
        text: () => t('log.army_destroyed', { army: event.armyId, place: place(event.provinceId) }),
      };
    }
    case 'province_conquered': {
      const tone = event.to === ctx.humanId ? 'good' : event.from === ctx.humanId ? 'bad' : 'info';
      return { tone, text: () => t('log.province_conquered', { player: player(event.to), place: place(event.provinceId) }) };
    }
    case 'recruit_completed': {
      if (provinceOwner(event.provinceId) !== ctx.humanId) return null;
      return {
        tone: 'good',
        text: () =>
          t('log.recruit_completed', {
            count: event.count,
            unit: unitName(ctx.rules, event.unitType),
            place: place(event.provinceId),
          }),
      };
    }
    case 'recruit_cancelled': {
      const job = ctx.previous.recruitQueue.find((j) => j.id === event.jobId);
      if (job?.owner !== ctx.humanId) return null;
      return { tone: 'bad', text: () => t('log.recruit_cancelled', { place: place(event.provinceId) }) };
    }
    case 'building_completed': {
      if (provinceOwner(event.provinceId) !== ctx.humanId) return null;
      return {
        tone: 'good',
        text: () =>
          t('log.building_completed', {
            building: buildingLabel(ctx.rules, event.buildingType, event.level ?? 1),
            place: place(event.provinceId),
          }),
      };
    }
    case 'building_cancelled': {
      const job = ctx.previous.constructionQueue.find((j) => j.id === event.jobId);
      if (job?.owner !== ctx.humanId) return null;
      return {
        tone: 'bad',
        text: () =>
          t('log.building_cancelled', { building: buildingName(ctx.rules, event.buildingType), place: place(event.provinceId) }),
      };
    }
    case 'player_eliminated':
      return {
        tone: event.playerId === ctx.humanId ? 'bad' : 'good',
        text: () => t('log.player_eliminated', { player: player(event.playerId) }),
      };
    case 'game_over':
      return {
        tone: event.winners.includes(ctx.humanId) ? 'good' : 'bad',
        text: () =>
          event.winners.length === 0
            ? t('log.game_over.none')
            : t('log.game_over.winners', {
                count: event.winners.length,
                names: event.winners.map((id) => player(id)).join(', '),
              }),
      };
    case 'proposal_made': {
      if (event.to !== ctx.humanId) return null;
      return { tone: 'info', text: () => t(`log.proposal_made.${event.kind}`, { player: player(event.from) }) };
    }
    case 'proposal_accepted': {
      if (event.from !== ctx.humanId) return null;
      return { tone: 'good', text: () => t(`log.proposal_accepted.${event.kind}`, { player: player(event.to) }) };
    }
    case 'proposal_rejected': {
      if (event.from !== ctx.humanId) return null;
      return { tone: 'bad', text: () => t(`log.proposal_rejected.${event.kind}`, { player: player(event.to) }) };
    }
    case 'proposal_expired': {
      if (event.from !== ctx.humanId && event.to !== ctx.humanId) return null;
      return { tone: 'info', text: () => t(`log.proposal_expired.${event.kind}`) };
    }
    case 'war_declared': {
      if (event.from !== ctx.humanId && event.to !== ctx.humanId) return null;
      const delayed = event.warAt > ctx.next.tick;
      return {
        tone: event.to === ctx.humanId ? 'bad' : 'info',
        text: () =>
          delayed
            ? t('log.war_declared.delayed', { from: player(event.from), to: player(event.to), tick: event.warAt })
            : t('log.war_declared', { from: player(event.from), to: player(event.to) }),
      };
    }
    case 'relation_changed': {
      if (event.a !== ctx.humanId && event.b !== ctx.humanId) return null;
      const other = event.a === ctx.humanId ? event.b : event.a;
      if (event.status === 'war') {
        return {
          tone: 'bad',
          text: () => t(event.reason === 'expired' ? 'log.relation.war.expired' : 'log.relation.war', { player: player(other) }),
        };
      }
      return { tone: 'good', text: () => t(`log.relation.${event.status}`, { player: player(other) }) };
    }
    case 'trade_offered':
      if (event.to !== ctx.humanId) return null;
      return { tone: 'info', text: () => t('log.trade_offered', { player: player(event.from) }) };
    case 'trade_accepted':
    case 'trade_rejected': {
      if (event.from !== ctx.humanId) return null;
      const accepted = event.type === 'trade_accepted';
      return { tone: accepted ? 'good' : 'bad', text: () => t(accepted ? 'log.trade_accepted' : 'log.trade_rejected', { player: player(event.to) }) };
    }
    case 'trade_cancelled':
      if (event.to !== ctx.humanId) return null;
      return { tone: 'info', text: () => t('log.trade_cancelled', { player: player(event.from) }) };
    case 'trade_expired': {
      const other = event.from === ctx.humanId ? event.to : event.from;
      return { tone: 'info', text: () => t('log.trade_expired', { player: player(other) }) };
    }
    case 'gift_sent': {
      const ours = event.from === ctx.humanId;
      return {
        tone: ours ? 'info' : 'good',
        text: () => {
          const what = formatBundle(event.give, ctx.placeName);
          return ours ? t('log.gift_sent', { player: player(event.to), what }) : t('log.gift_received', { player: player(event.from), what });
        },
      };
    }
    case 'province_transferred': {
      const involved = event.from === ctx.humanId || event.to === ctx.humanId;
      return {
        tone: involved ? (event.to === ctx.humanId ? 'good' : 'info') : 'info',
        text: () => t('log.province_transferred', { place: place(event.provinceId), from: player(event.from), to: player(event.to) }),
      };
    }
    case 'chat_intercepted': {
      // Many messages can be heard at once (the context when a spy arrives): one line per chat.
      const same = ctx.next.events.filter((e) => e.type === 'chat_intercepted' && e.chatId === event.chatId && e.owner === event.owner);
      if (same[0] !== event || event.owner !== ctx.humanId) return null;
      return {
        tone: 'good',
        text: () =>
          t('log.chat_intercepted', { count: same.length, players: event.participants.map((id) => player(id)).join(', ') }),
      };
    }
    case 'spy_in_place':
      if (event.owner !== ctx.humanId) return null;
      return { tone: 'good', text: () => t('log.spy_in_place', { place: place(event.provinceId) }) };
    case 'spy_removed': {
      if (event.owner === ctx.humanId) {
        const reason = event.reason;
        return {
          tone: reason === 'cover_blown' ? 'bad' : 'info',
          text: () =>
            t(reason === 'cover_blown' ? 'log.spy_removed.cover_blown.ours' : `log.spy_removed.${reason}`, {
              place: place(event.provinceId),
            }),
        };
      }
      // Somebody else's spy was caught in our land.
      return event.reason === 'cover_blown' && event.target === ctx.humanId
        ? { tone: 'good', text: () => t('log.spy_removed.cover_blown.theirs', { place: place(event.provinceId) }) }
        : null;
    }
    case 'spy_mission_failed':
      if (event.owner !== ctx.humanId) return null;
      return { tone: 'info', text: () => t('log.spy_mission_failed', { place: place(event.provinceId) }) };
    case 'building_sabotaged': {
      const ours = event.by === ctx.humanId;
      if (!ours && event.target !== ctx.humanId) return null;
      return {
        tone: ours ? 'good' : 'bad',
        text: () =>
          t(ours ? 'log.building_sabotaged.ours' : 'log.building_sabotaged.theirs', {
            building: buildingName(ctx.rules, event.buildingType),
            place: place(event.provinceId),
          }),
      };
    }
    case 'morale_sabotaged': {
      const ours = event.by === ctx.humanId;
      if (!ours && event.target !== ctx.humanId) return null;
      return {
        tone: ours ? 'good' : 'bad',
        text: () =>
          t(ours ? 'log.morale_sabotaged.ours' : 'log.morale_sabotaged.theirs', {
            place: place(event.provinceId),
            damage: Math.round(event.damage),
          }),
      };
    }
    case 'market_trade': {
      if (event.owner !== ctx.humanId) return null;
      return {
        tone: 'good',
        text: () =>
          t('log.market_trade', {
            gave: formatCost({ [event.gave.resource]: event.gave.amount }),
            got: formatCost({ [event.got.resource]: event.got.amount }),
          }),
      };
    }
    case 'market_order_expired': {
      if (event.owner !== ctx.humanId) return null;
      return {
        tone: 'info',
        text: () => t('log.market_order_expired', { refund: formatCost({ [event.refund.resource]: event.refund.amount }) }),
      };
    }
    case 'battle':
      return null;
  }
}
