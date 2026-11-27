import type { Army, GameState, Point, ProvinceId } from '@supremacy/sim';
import { useState } from 'react';
import { areHostile, armyKind, buildingLevel, isSeaProvince } from '@supremacy/sim';
import { ownerColor, shade } from '../colors';
import { formatCount } from '../format';
import { useLocale } from '../i18n';
import { buildingGlyph } from '../labels';
import { HUMAN_ID, type GameSession } from '../session';

interface MapViewProps {
  session: GameSession;
  state: GameState;
  /** Provinces in sight right now. The others are drawn under the fog. */
  visible: ReadonlySet<ProvinceId>;
  selectedProvince: ProvinceId | null;
  selectedArmy: string | null;
  /** Route of the order being previewed (provinces to visit, from the selected army). */
  previewPath: ProvinceId[];
  onSelectProvince: (id: ProvinceId | null) => void;
  onSelectArmy: (id: string) => void;
}

/** Text with a light outline, drawn as two layers so it works in every SVG renderer. */
function OutlinedText(props: { x: number; y: number; size: number; weight?: number; children: string }) {
  const { x, y, size, weight = 600, children } = props;
  const common = { x, y, fontSize: size, fontWeight: weight, fontFamily: 'system-ui, sans-serif', textAnchor: 'middle' as const };
  return (
    <>
      <text {...common} fill="#ffffff" stroke="#ffffff" strokeWidth={size * 0.28} strokeLinejoin="round">
        {children}
      </text>
      <text {...common} fill="#1c1c1c">
        {children}
      </text>
    </>
  );
}

const TOKEN_W = 26;
const TOKEN_H = 16;

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Where an army is drawn: at its province, or part of the way to the next one while marching. */
function armyPosition(session: GameSession, army: Army): Point {
  const base = session.anchors[army.location] ?? { x: 0, y: 0 };
  const next = army.order?.path[0];
  if (!army.order || next === undefined) return base;
  const target = session.anchors[next];
  const length = session.edgeDistance(army.location, next);
  if (!target || !length) return base;
  return lerp(base, target, Math.min(1, army.order.progress / length));
}

function totalUnits(army: Army): number {
  return Object.values(army.units).reduce((sum, n) => sum + n, 0);
}

/**
 * The map: provinces drawn with organic borders, army markers and movement orders.
 * Plain SVG attributes only (no CSS classes), so it also renders outside the browser.
 */
/** Marker in front of the unit count: ships and aircraft look different from land armies. */
const ARMY_GLYPH = { land: '', sea: '⚓ ', air: '✈ ' } as const;

export function MapView(props: MapViewProps) {
  useLocale();
  const { session, state, visible, selectedProvince, selectedArmy, previewPath, onSelectProvince, onSelectArmy } = props;
  const fogOn = session.rules.vision.fog;
  const [hovered, setHovered] = useState<ProvinceId | null>(null);
  const { shapes, anchors, bounds } = session;
  const seaIds = new Set(state.provinces.filter(isSeaProvince).map((p) => p.id));

  // Armies standing at (almost) the same spot are laid out side by side.
  const stacks = new Map<string, Army[]>();
  for (const army of state.armies) {
    const p = armyPosition(session, army);
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    stacks.set(key, [...(stacks.get(key) ?? []), army]);
  }

  const selected = state.armies.find((a) => a.id === selectedArmy);
  const routeLine = (army: Army, path: ProvinceId[]): string => {
    const start = armyPosition(session, army);
    const points = [start, ...path.map((id) => anchors[id]).filter((p): p is Point => p !== undefined)];
    return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  };

  return (
    <svg
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
      style={{ width: '100%', height: '100%', display: 'block', background: '#cfe3f0' }}
      onClick={() => onSelectProvince(null)}
    >
      <rect x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} fill="#cfe3f0" />

      {state.provinces.map((province, index) => {
        const d = shapes.paths[province.id];
        if (!d) return null;
        const color = isSeaProvince(province)
          ? shade('#b9d6e8', (((index * 37) % 7) - 3) * 0.012)
          : shade(ownerColor(province.owner), (((index * 37) % 7) - 3) * 0.018);
        return (
          <path
            key={province.id}
            d={d}
            fill={color}
            fillRule="evenodd"
            stroke={color}
            strokeWidth={0.8}
            strokeLinejoin="round"
            style={{ cursor: 'pointer' }}
            onClick={(event) => {
              event.stopPropagation();
              onSelectProvince(province.id);
            }}
            onMouseEnter={() => setHovered(province.id)}
            onMouseLeave={() => setHovered((current) => (current === province.id ? null : current))}
          />
        );
      })}

      {hovered !== null && shapes.paths[hovered] ? (
        <path d={shapes.paths[hovered]} fill="#ffffff" fillOpacity={0.18} fillRule="evenodd" pointerEvents="none" />
      ) : null}

      {/* Fog of war: provinces out of sight are darkened. */}
      {fogOn
        ? state.provinces.map((province) => {
            const d = shapes.paths[province.id];
            if (!d || visible.has(province.id)) return null;
            return <path key={`fog-${province.id}`} d={d} fill="#10192b" fillOpacity={0.42} fillRule="evenodd" pointerEvents="none" />;
          })
        : null}

      {shapes.borders.map((border, i) => {
        // Coastlines (land next to sea or to nothing) are dark, borders between two seas are faint.
        const aSea = seaIds.has(border.a);
        const bSea = border.b !== null && seaIds.has(border.b);
        const coast = border.b === null || aSea !== bSea;
        const seaBorder = aSea && bSea;
        return (
          <path
            key={i}
            d={border.path}
            fill="none"
            stroke={coast ? '#3b4a54' : seaBorder ? '#8fb3cb' : '#ffffff'}
            strokeWidth={coast ? 1.5 : seaBorder ? 1 : 1.8}
            strokeDasharray={seaBorder ? '3 3' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        );
      })}

      {selectedProvince !== null && shapes.paths[selectedProvince] ? (
        <g pointerEvents="none">
          <path d={shapes.paths[selectedProvince]} fill="none" stroke="#1d1d1d" strokeWidth={5} fillRule="evenodd" />
          <path d={shapes.paths[selectedProvince]} fill="none" stroke="#ffe066" strokeWidth={2.6} fillRule="evenodd" />
        </g>
      ) : null}

      {/* Province names, with the first letter of each building underneath. */}
      {state.provinces.map((province) => {
        const p = anchors[province.id];
        if (!p) return null;
        if (isSeaProvince(province)) {
          return (
            <g key={province.id} pointerEvents="none" opacity={0.75}>
              <OutlinedText x={p.x} y={p.y - 3} size={8} weight={500}>
                {session.provinceName(province.id)}
              </OutlinedText>
            </g>
          );
        }
        const glyphs = province.buildings
          .map((b) => buildingGlyph(session.rules, b, buildingLevel(province, b)))
          .join(' ');
        return (
          <g key={province.id} pointerEvents="none">
            <OutlinedText x={p.x} y={p.y - 3} size={8.5}>
              {session.provinceName(province.id)}
            </OutlinedText>
            {glyphs ? (
              <g opacity={fogOn && !visible.has(province.id) && province.owner !== HUMAN_ID ? 0.55 : 1}>
                <OutlinedText x={p.x} y={p.y + 5.5} size={6.5} weight={500}>
                  {glyphs}
                </OutlinedText>
              </g>
            ) : null}
          </g>
        );
      })}

      {/* Movement orders of our armies, and of the selected one. */}
      {state.armies.map((army) =>
        army.order && (army.owner === HUMAN_ID || army.id === selectedArmy) ? (
          <polyline
            key={`order-${army.id}`}
            points={routeLine(army, army.order.path)}
            fill="none"
            stroke={shade(ownerColor(army.owner), -0.25)}
            strokeWidth={army.id === selectedArmy ? 2.6 : 1.6}
            strokeDasharray="6 4"
            strokeLinecap="round"
            pointerEvents="none"
          />
        ) : null,
      )}

      {selected && previewPath.length > 0 ? (
        <polyline
          points={routeLine(selected, previewPath)}
          fill="none"
          stroke="#ffe066"
          strokeWidth={3}
          strokeDasharray="2 5"
          strokeLinecap="round"
          pointerEvents="none"
        />
      ) : null}

      {/* Army markers. */}
      {[...stacks.values()].flatMap((stack) =>
        stack.map((army, i) => {
          const p = armyPosition(session, army);
          const x = p.x + (i - (stack.length - 1) / 2) * (TOKEN_W + 3);
          const y = p.y + 14;
          const isSelected = army.id === selectedArmy;
          const fighting = state.armies.some(
            (other) => other.location === army.location && areHostile(state, army.owner, other.owner),
          );
          return (
            <g
              key={army.id}
              transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
              style={{ cursor: 'pointer' }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectArmy(army.id);
              }}
            >
              <rect
                x={-TOKEN_W / 2}
                y={-TOKEN_H / 2}
                width={TOKEN_W}
                height={TOKEN_H}
                rx={4}
                fill={ownerColor(army.owner)}
                stroke={isSelected ? '#ffe066' : '#ffffff'}
                strokeWidth={isSelected ? 2.6 : 1.2}
              />
              <text
                x={0}
                y={3.6}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                fontFamily="system-ui, sans-serif"
                fill="#ffffff"
              >
                {ARMY_GLYPH[armyKind(session.rules, army.units)]}
                {formatCount(Math.round(totalUnits(army)))}
              </text>
              {fighting ? (
                <g>
                  <circle cx={TOKEN_W / 2} cy={-TOKEN_H / 2} r={5} fill="#ff3b30" stroke="#ffffff" strokeWidth={1} />
                  <text x={TOKEN_W / 2} y={-TOKEN_H / 2 + 3} textAnchor="middle" fontSize={8} fontWeight={800} fill="#ffffff">
                    !
                  </text>
                </g>
              ) : null}
            </g>
          );
        }),
      )}
    </svg>
  );
}
