import { useMemo, useState } from 'react';
import { useGame } from './hooks/useGame';
import { sound } from './sound/engine';
import { buildMachine } from './generation/client';
import {
  GameType, GridSym, ROWS, scatterMinHit, SlotDef, TYPE_PROFILES,
} from './engine';

const CHIPS = ['Pirate', 'Japanese', 'Deep space', 'Italian', 'Dragon', 'Luxury', 'Wizard', 'Safari', 'Rock', 'Fiesta'];
const fmt = (n: number) => n.toLocaleString('en-US');

function SymbolCell({ sym, hl, accent }: { sym: GridSym; hl?: boolean; accent: string }) {
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

function Reels({ slot, state }: { slot: SlotDef; state: ReturnType<typeof useGame>['state'] }) {
  const shown = state.view?.grid ?? state.grid;
  const loop = [...slot.symbols, ...slot.symbols.slice().reverse()];
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
                    {[...loop, ...loop].map((s, i) => (
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

function Paytable({ slot }: { slot: SlotDef }) {
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

function WinOverlay({ rollup, cascades, tier }: { rollup: number; cascades: number; tier: string }) {
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

export default function App() {
  const [slot, setSlot] = useState<SlotDef | null>(null);
  const [prompt, setPrompt] = useState('');
  const [reels, setReels] = useState(5);
  const [gameType, setGameType] = useState<GameType>('paylines');
  const [building, setBuilding] = useState(false);
  const [fallbackNote, setFallbackNote] = useState(false);
  const [muted, setMuted] = useState(false);
  const { state, bets, betIdx, setBetIdx, spin } = useGame(slot);

  const build = async () => {
    if (building || !prompt.trim()) return;
    setBuilding(true);
    const { slot: def, usedFallback } = await buildMachine({ prompt, reels, gameType });
    setSlot(def);
    setFallbackNote(usedFallback);
    setBuilding(false);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="logo">
          <h1>WINSMYTH</h1>
          <div className="sub">Social Casino · Free to Play</div>
        </div>
        <div className="wallet">
          <button className="mute" onClick={() => setMuted(sound.toggleMute())} aria-label="Toggle sound">
            {muted ? '🔇' : '🔊'}
          </button>
          <span className="gc">{fmt(state.balance)} GC</span>
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          <h2 className="panel-title">Design Your Machine</h2>
          <label className="pl" htmlFor="prompt">Describe any theme</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A Viking raid on a fjord monastery — longships, runes, ravens."
            rows={4}
          />
          <div className="chips">
            {CHIPS.map((c) => (
              <button key={c} className="chip" onClick={() => setPrompt(c)}>{c}</button>
            ))}
          </div>
          <div className="cfg-row">
            <div>
              <div className="pl">Reels</div>
              <select value={reels} onChange={(e) => setReels(Number(e.target.value))}>
                <option value={5}>5 Reels</option>
                <option value={3}>3 Reels</option>
              </select>
            </div>
            <div>
              <div className="pl">Game Type</div>
              <select value={gameType} onChange={(e) => setGameType(e.target.value as GameType)}>
                {(Object.keys(TYPE_PROFILES) as GameType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_PROFILES[t].label}</option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn-build" onClick={build} disabled={building}>
            {building ? 'BUILDING…' : 'BUILD & PLAY FREE'}
          </button>
          {fallbackNote && (
            <p className="fallback-note">Showing a themed preset — live generation needs the API key configured on the server.</p>
          )}
        </aside>

        <section className="stage">
          {!slot ? (
            <div className="empty">
              <div className="empty-icon">🎰</div>
              <h2>Your Machine Awaits</h2>
              <p>Describe any theme and watch your bespoke machine come to life in seconds. No purchase ever required — just your imagination.</p>
            </div>
          ) : (
            <div className="machine" style={{ borderColor: `${slot.color}90` }}>
              <div className="marque">
                <h2 style={{ color: slot.color }}>{slot.name}</h2>
                <div className="tagline">{slot.tagline}</div>
                <div className="type-tag">{TYPE_PROFILES[slot.gameType].label}</div>
              </div>
              {state.freeSpins > 0 && (
                <div className="fs-banner">FREE SPINS ×{state.freeSpins}{state.expandEmoji ? ` — ${state.expandEmoji} pays double` : ''}</div>
              )}
              <Reels slot={slot} state={state} />
              <div className="controls">
                <div className="bet">
                  <button onClick={() => setBetIdx(Math.max(0, betIdx - 1))} disabled={state.phase !== 'idle'}>−</button>
                  <span className="bet-val">{fmt(bets[betIdx])}</span>
                  <button onClick={() => setBetIdx(Math.min(bets.length - 1, betIdx + 1))} disabled={state.phase !== 'idle'}>+</button>
                </div>
                <button className="btn-spin" onClick={spin} disabled={state.phase !== 'idle' || (!state.freeSpins && state.balance < bets[betIdx])}>
                  {state.freeSpins > 0 ? 'FREE SPIN' : 'SPIN'}
                </button>
                <div className="last-win">{state.phase === 'celebrating' && state.rollup != null ? `+${fmt(state.rollup)}` : state.view ? `+${fmt(state.view.runningTotal)}` : state.lastWin > 0 ? `+${fmt(state.lastWin)}` : ''}</div>
              </div>
              <Paytable slot={slot} />
              {state.phase === 'celebrating' && state.outcome && state.tier && state.tier !== 'small' && (
                <WinOverlay rollup={state.rollup ?? state.outcome.totalWin} cascades={state.outcome.cascades} tier={state.tier} />
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
