// Game presentation components — extracted from App for the Phase C
// page split. Rendering only; the useGame hook owns the clock.

import { useMemo } from 'react';
import { useGame } from '../hooks/useGame';
import { GridSym, ROWS, scatterMinHit, SlotDef } from '../engine';

export const fmt = (n: number) => n.toLocaleString('en-US');

export function SymbolCell({ sym, hl, accent }: { sym: GridSym; hl?: boolean; accent: string }) {
  const tierCls = sym.isWild ? 'wild' : sym.isBonus ? 'scatter' : sym.tier ?? 'low';
  return (
    <div
      className={`cell plate-${tierCls}${hl ? ' hl' : ''}`}
      style={sym.isWild ? { boxShadow: `0 0 18px ${accent}` } : undefined}
    >
      <span className="cell-emoji">{sym.emoji}</span>
    </div>
  );
}

export function Reels({ slot, state }: { slot: SlotDef; state: ReturnType<typeof useGame>['state'] }) {
  const shown = state.view?.grid ?? state.grid;
  // Fixed 12-cell pattern, rendered twice: translateY(-50%) then equals
  // exactly one period, so the scroll loops seamlessly at any reel width.
  const base = [...slot.symbols, ...slot.symbols.slice().reverse()];
  const pattern = Array.from({ length: 12 }, (_, i) => base[i % base.length]);
  return (
    <div className="reels-area">
      {state.view?.badgeMult ? <div className="cascade-badge">CASCADE ×{state.view.badgeMult}</div> : null}
      <div className="reels" style={{ gridTemplateColumns: `repeat(${slot.reels}, 1fr)` }}>
        {Array.from({ length: slot.reels }, (_, reel) => {
          const rp = state.reelPhases[reel] ?? 'idle';
          const spinningNow = rp === 'spinning' || rp === 'anticipating';
          return (
            <div key={reel} className={`reel${rp === 'stopped' ? ' settled' : ''}`}>
              {Array.from({ length: ROWS }, (_, row) => {
                const cell = shown?.[reel]?.[row];
                const key = `${reel}:${row}`;
                const hl = !spinningNow && (state.view?.highlight.has(key) ?? false);
                const pop = !spinningNow && (state.view?.popping.has(key) ?? false);
                return cell
                  ? (
                    <div key={row} className={pop ? 'pop-wrap' : ''}>
                      <SymbolCell sym={cell.sym} hl={hl} accent={slot.color} />
                    </div>
                  )
                  : <div key={row} className="cell plate-low"><span className="cell-emoji">•</span></div>;
              })}
              {spinningNow && (
                <div className={`loop-overlay${rp === 'anticipating' ? ' anticipating' : ''}`}>
                  <div className="loop-track">
                    {[...pattern, ...pattern].map((s, i) => (
                      <div key={i} className="loop-cell"><span className="cell-emoji">{s.emoji}</span></div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Paytable({ slot }: { slot: SlotDef }) {
  const cols = useMemo(() => {
    if (slot.gameType === 'scatter') {
      const m0 = scatterMinHit(slot);
      return [
        { label: `${m0}-${m0 + 1}`, mf: 1 / 10 },
        { label: `${m0 + 2}-${m0 + 4}`, mf: 1 / 3 },
        { label: `${m0 + 5}+`, mf: 1 },
      ];
    }
    if (slot.gameType === 'cluster') {
      return [
        { label: '5', mf: 1 / 10 }, { label: '6', mf: 1 / 5 }, { label: '7', mf: 1 / 3 },
        { label: '8', mf: 1 / 2 }, { label: '9+', mf: 1 },
      ];
    }
    const u = slot.gameType === 'ways' ? 1 / 9 : 1;
    return [
      { label: '2×', mf: u / 30, premOnly: true }, { label: '3×', mf: u / 10 },
      { label: '4×', mf: u / 3 }, { label: '5×', mf: u },
    ];
  }, [slot]);

  const note = slot.gameType === 'ways'
    ? 'Wins pay left-to-right on adjacent reels in any row — all ways. Values shown are per way.'
    : slot.gameType === 'scatter'
      ? `No paylines: ${scatterMinHit(slot)}+ matching symbols anywhere pay. Wilds count toward every symbol.`
      : slot.gameType === 'cluster'
        ? 'No paylines: clusters of 5+ touching symbols pay. Wilds join any cluster.'
        : 'Wins pay left-to-right across 9 paylines. Values shown at a 2,500 bet.';

  return (
    <div className="paytable">
      <table>
        <thead>
          <tr><th>Symbol</th>{cols.map((c) => <th key={c.label}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {[...slot.symbols].reverse().map((s) => (
            <tr key={s.emoji}>
              <td className="pt-sym"><span>{s.emoji}</span> {s.name}</td>
              {cols.map((c) => (
                <td key={c.label} className="pt-val">
                  {('premOnly' in c && c.premOnly && s.tier !== 'premium')
                    ? '—'
                    : fmt(Math.floor(2500 * Math.max(1, Math.round(s.multiplier * c.mf)) * 0.6))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-note">{note}</p>
    </div>
  );
}

export function WinOverlay({ rollup, cascades, tier }: { rollup: number; cascades: number; tier: string }) {
  const label = tier === 'jackpot' ? 'JACKPOT!' : tier === 'mega' ? 'MEGA WIN!' : 'BIG WIN!';
  return (
    <div className="win-overlay">
      <div className="win-card">
        <div className="win-label">{label}</div>
        <div className="win-amount">+{fmt(rollup)} GC</div>
        <div className="win-sub">{cascades > 1 ? `${cascades} cascades` : ''}</div>
      </div>
    </div>
  );
}
