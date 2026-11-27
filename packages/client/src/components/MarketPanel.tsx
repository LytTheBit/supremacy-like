import { currencyOf, orderPrice, ordersOf, type GameState, type MarketOrder } from '@supremacy/sim';
import { useState } from 'react';
import { formatAmount, formatRatio } from '../format';
import { resourceIcon } from '../icons';
import { t, useLocale } from '../i18n';
import { errorText, formatCost, playerName, resourceName } from '../labels';
import { marketBook, totalFor, type BookLine } from '../market-view';
import { HUMAN_ID, type GameSession } from '../session';

interface MarketPanelProps {
  session: GameSession;
  state: GameState;
}

type Outcome = { ok: true } | { ok: false; error: string };

/**
 * The market. With money in the game it works like a stock board: pick a good, see who sells it
 * and who wants it (prices per 1k units), take an offer with a click or place your own. Bartering
 * one good for another stays available below. Your open offers are listed with a way to withdraw them.
 */
export function MarketPanel({ session, state }: MarketPanelProps) {
  useLocale();
  const rules = session.rules.market;
  const currency = currencyOf(session.rules);
  const goods = session.rules.resources.filter((r) => r !== currency);
  const [good, setGood] = useState(goods[0] ?? '');
  const [message, setMessage] = useState<string | null>(null);
  if (!rules) return null;

  const run = (result: Outcome) => setMessage(result.ok ? null : errorText(result.error));
  const mine = ordersOf(state, HUMAN_ID);
  const me = state.players.find((p) => p.id === HUMAN_ID);

  return (
    <div className="card">
      <h3>{t('market.title')}</h3>
      {currency !== null ? (
        <div className="balance">
          <span aria-hidden>{resourceIcon(currency)}</span> {t('market.balance', { amount: formatAmount(me?.stockpile[currency] ?? 0) })}
        </div>
      ) : null}
      <p className="muted small">{currency !== null ? t('market.hintMoney') : t('market.hint')}</p>

      {currency !== null ? (
        <MoneyBoard session={session} state={state} currency={currency} goods={goods} good={good} onGood={setGood} onResult={run} />
      ) : null}

      <h4>{t('market.yourOrders')}</h4>
      <p className="muted small">{t('market.count', { count: mine.length, max: rules.maxOrders })}</p>
      {mine.length === 0 ? <p className="muted small">{t('market.noOrders')}</p> : null}
      {mine.map((order) => (
        <OfferRow key={order.id} order={order} state={state} line="market.orderLine">
          <div className="chips">
            <button onClick={() => run(session.marketCancel(order.id))}>{t('market.cancel')}</button>
          </div>
        </OfferRow>
      ))}

      <details className="barter">
        <summary>{t('market.barter')}</summary>
        {state.market
          .filter((o) => o.owner !== HUMAN_ID && (currency === null || (o.give.resource !== currency && o.want.resource !== currency)))
          .map((order) => {
            const reason = session.checkMarketAccept(order.id);
            return (
              <OfferRow key={order.id} order={order} state={state} line="market.offerLine">
                <div className="chips">
                  <button className="primary" disabled={reason !== null} title={reason ? errorText(reason) : undefined} onClick={() => run(session.marketAccept(order.id))}>
                    {t('market.accept')}
                  </button>
                </div>
              </OfferRow>
            );
          })}
        <NewBarter session={session} onResult={run} />
      </details>
      {message ? <p className="error">{message}</p> : null}
    </div>
  );
}

/** The board for one good: its sellers and buyers, and the form to buy or sell it for money. */
function MoneyBoard(props: {
  session: GameSession;
  state: GameState;
  currency: string;
  goods: string[];
  good: string;
  onGood: (good: string) => void;
  onResult: (result: Outcome) => void;
}) {
  const { session, state, currency, goods, good, onGood, onResult } = props;
  const book = marketBook(state, good, currency, HUMAN_ID);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('2000');
  const [price, setPrice] = useState('1000');

  const amountValue = Number(amount);
  const priceValue = Number(price);
  const total = amountValue > 0 && priceValue > 0 ? totalFor(amountValue, priceValue) : 0;
  const best = side === 'buy' ? book.bestSale : book.bestBuy;

  const post = () => {
    if (!(amountValue > 0) || !(total > 0)) return onResult({ ok: false, error: 'invalid_amount' });
    onResult(
      side === 'buy'
        ? session.marketOffer(currency, total, good, amountValue)
        : session.marketOffer(good, amountValue, currency, total),
    );
  };

  return (
    <>
      <h4>{t('market.goods')}</h4>
      <div className="chips">
        {goods.map((resource) => (
          <button key={resource} className={`chip ${resource === good ? 'active' : ''}`} onClick={() => onGood(resource)}>
            <span aria-hidden>{resourceIcon(resource)}</span> {resourceName(resource)}
          </button>
        ))}
      </div>

      <div className="book">
        <BookColumn title={t('market.forSale')} empty={t('market.noneForSale')} lines={book.forSale} state={state} session={session} good={good} currency={currency} kind="sale" onResult={onResult} />
        <BookColumn title={t('market.wanted')} empty={t('market.noneWanted')} lines={book.wanted} state={state} session={session} good={good} currency={currency} kind="want" onResult={onResult} />
      </div>

      <div className="market-form">
        <div className="wide chips">
          {(['buy', 'sell'] as const).map((value) => (
            <button key={value} className={side === value ? 'active' : ''} onClick={() => setSide(value)}>
              {t(`market.mode.${value}`)}
            </button>
          ))}
        </div>
        <label>
          {t('market.amount')}
          <input type="number" min={0} step={500} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          {t('market.pricePerK')}
          <input type="number" min={0} step={50} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <div className="wide muted small">
          {t('market.total', { total: `${formatAmount(total)} ${resourceName(currency)}` })}
          {' · '}
          {best === null
            ? t('market.noPrices')
            : t(side === 'buy' ? 'market.bestSale' : 'market.bestBuy', { price: t('market.perK', { price: formatAmount(best) }) })}
        </div>
        <div className="wide">
          <button className="primary" onClick={post}>
            {side === 'buy' ? t('market.postBuy') : t('market.postSell')}
          </button>
        </div>
      </div>
    </>
  );
}

function BookColumn(props: {
  title: string;
  empty: string;
  lines: BookLine[];
  kind: 'sale' | 'want';
  state: GameState;
  session: GameSession;
  good: string;
  currency: string;
  onResult: (result: Outcome) => void;
}) {
  const { title, empty, lines, kind, state, session, good, currency, onResult } = props;
  return (
    <div>
      <div className="muted small">{title}</div>
      {lines.length === 0 ? <p className="muted small">{empty}</p> : null}
      {lines.map((line) => {
        const reason = line.mine ? null : session.checkMarketAccept(line.order.id);
        const who = line.mine ? t('chat.you') : playerName(state.players, line.order.owner);
        return (
          <div className={`book-line ${line.mine ? 'mine' : ''}`} key={line.order.id}>
            <div>
              {t(kind === 'sale' ? 'market.saleLine' : 'market.wantLine', {
                player: who,
                amount: `${formatAmount(line.amount)} ${resourceName(good)}`,
                total: `${formatAmount(line.total)} ${resourceName(currency)}`,
              })}
              <div className="muted small">{t('market.perK', { price: formatAmount(line.pricePerUnit) })}</div>
            </div>
            {line.mine ? null : (
              <button className="primary" disabled={reason !== null} title={reason ? errorText(reason) : undefined} onClick={() => onResult(session.marketAccept(line.order.id))}>
                {kind === 'sale' ? t('market.buy') : t('market.sellTo')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OfferRow(props: { order: MarketOrder; state: GameState; line: 'market.offerLine' | 'market.orderLine'; children: React.ReactNode }) {
  const { order, state, line, children } = props;
  const give = formatCost({ [order.give.resource]: order.give.amount });
  const want = formatCost({ [order.want.resource]: order.want.amount });
  return (
    <div className="rel">
      <div>{t(line, { player: playerName(state.players, order.owner), give, want })}</div>
      <div className="muted small">
        {t('market.price', { give: resourceName(order.give.resource), rate: formatRatio(orderPrice(order)), want: resourceName(order.want.resource) })}
        {' · '}
        {t('market.expires', { count: Math.max(0, order.expiresAt - state.tick) })}
      </div>
      {children}
    </div>
  );
}

/** Form for a barter offer (one good for another): what you give and what you want, with the resulting price. */
function NewBarter(props: { session: GameSession; onResult: (result: Outcome) => void }) {
  const { session, onResult } = props;
  const resources = session.rules.resources;
  const minAmount = session.rules.market?.minAmount ?? 0;
  const [give, setGive] = useState(resources[1] ?? resources[0] ?? '');
  const [want, setWant] = useState(resources[2] ?? resources[0] ?? '');
  const [giveAmount, setGiveAmount] = useState('2000');
  const [wantAmount, setWantAmount] = useState('2000');
  const giveValue = Number(giveAmount);
  const wantValue = Number(wantAmount);
  const price = giveValue > 0 && wantValue > 0 ? wantValue / giveValue : null;

  return (
    <>
      <h4>{t('market.new')}</h4>
      <div className="market-form">
        <label>
          {t('market.give')}
          <select value={give} onChange={(e) => setGive(e.target.value)}>
            {resources.map((r) => (
              <option key={r} value={r}>
                {resourceName(r)}
              </option>
            ))}
          </select>
          <input type="number" min={0} step={minAmount || 500} value={giveAmount} onChange={(e) => setGiveAmount(e.target.value)} />
        </label>
        <label>
          {t('market.want')}
          <select value={want} onChange={(e) => setWant(e.target.value)}>
            {resources.map((r) => (
              <option key={r} value={r}>
                {resourceName(r)}
              </option>
            ))}
          </select>
          <input type="number" min={0} step={minAmount || 500} value={wantAmount} onChange={(e) => setWantAmount(e.target.value)} />
        </label>
        <div className="wide muted small">
          {price !== null ? t('market.price', { give: resourceName(give), rate: formatRatio(price), want: resourceName(want) }) : null}{' '}
          {minAmount > 0 ? t('market.minAmount', { amount: formatAmount(minAmount) }) : null}
        </div>
        <div className="wide">
          <button className="primary" onClick={() => onResult(session.marketOffer(give, giveValue, want, wantValue))}>
            {t('market.post')}
          </button>
        </div>
      </div>
    </>
  );
}

