// Phase C pages: Lobby (catalogue), Build (the flow as its own screen),
// Machine (the game, addressable by shareable URL).

import { useState } from 'react';
import { GameType, SlotDef, TYPE_PROFILES } from '../engine';
import { buildMachine } from '../generation/client';
import { CatalogEntry } from '../lib/catalog';
import { encodeSlot } from '../lib/share';
import { useGame } from '../hooks/useGame';
import { fmt, Paytable, Reels, WinOverlay } from '../components/Game';

const CHIPS = ['Pirate', 'Japanese', 'Deep space', 'Italian', 'Dragon', 'Luxury', 'Wizard', 'Safari', 'Rock', 'Fiesta'];

export function MachineCard({ entry, onPlay }: { entry: CatalogEntry; onPlay: () => void }) {
  const { slot } = entry;
  const preview = [...slot.symbols].reverse().slice(0, 3);
  return (
    <button className="mcard" style={{ borderColor: `${slot.color}70` }} onClick={onPlay}>
      <div className="mcard-name" style={{ color: slot.color }}>{slot.name}</div>
      <div className="mcard-tag">{slot.tagline}</div>
      <div className="mcard-syms">{preview.map((s) => <span key={s.emoji}>{s.emoji}</span>)}</div>
      <div className="mcard-foot">
        <span className="type-tag">{TYPE_PROFILES[slot.gameType].label}</span>
        {entry.source === 'session' && <span className="type-tag mine">Your build</span>}
      </div>
    </button>
  );
}

export function Lobby({ entries, go }: { entries: CatalogEntry[]; go: (hash: string) => void }) {
  const session = entries.filter((e) => e.source === 'session');
  const presets = entries.filter((e) => e.source === 'preset');
  return (
    <div className="lobby">
      <section className="hero">
        <h2>Your Machine Awaits</h2>
        <p>Describe any theme and watch your bespoke machine come to life in seconds. No purchase ever required — just your imagination.</p>
        <button className="btn-build hero-cta" onClick={() => go('#/build')}>BUILD YOUR OWN</button>
      </section>
      {session.length > 0 && (
        <section>
          <h3 className="row-title">Your machines <span className="row-note">this session</span></h3>
          <div className="mgrid">
            {session.map((e) => <MachineCard key={e.id} entry={e} onPlay={() => go(`#/m/${encodeSlot(e.slot)}`)} />)}
          </div>
        </section>
      )}
      <section>
        <h3 className="row-title">House catalogue</h3>
        <div className="mgrid">
          {presets.map((e) => <MachineCard key={e.id} entry={e} onPlay={() => go(`#/m/${encodeSlot(e.slot)}`)} />)}
        </div>
      </section>
    </div>
  );
}

export function Build({ onBuilt, go }: { onBuilt: (slot: SlotDef, fallback: boolean) => void; go: (hash: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [reels, setReels] = useState(5);
  const [gameType, setGameType] = useState<GameType>('paylines');
  const [building, setBuilding] = useState(false);

  const build = async () => {
    if (building || !prompt.trim()) return;
    setBuilding(true);
    const { slot, usedFallback } = await buildMachine({ prompt, reels, gameType });
    onBuilt(slot, usedFallback);
    setBuilding(false);
    go(`#/m/${encodeSlot(slot)}`);
  };

  return (
    <div className="build-page">
      <div className="panel build-center">
        <h2 className="panel-title">Design Your Machine</h2>
        <label className="pl" htmlFor="prompt">Describe any theme</label>
        <textarea
          id="prompt" value={prompt} rows={4}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A Viking raid on a fjord monastery — longships, runes, ravens."
        />
        <div className="chips">
          {CHIPS.map((c) => <button key={c} className="chip" onClick={() => setPrompt(c)}>{c}</button>)}
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
      </div>
    </div>
  );
}

export function Machine({ slot, fallbackNote, go }: { slot: SlotDef; fallbackNote: boolean; go: (hash: string) => void }) {
  const { state, bets, betIdx, setBetIdx, spin } = useGame(slot);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${location.origin}${location.pathname}#/m/${encodeSlot(slot)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable; the URL is already in the bar */ }
  };

  return (
    <div className="machine-page">
      <div className="machine-nav">
        <button className="chip" onClick={() => go('#/')}>← Lobby</button>
        <button className="chip" onClick={() => go('#/build')}>Build another</button>
        <button className="chip" onClick={share}>{copied ? 'Link copied!' : 'Share machine'}</button>
      </div>
      <div className="machine" style={{ borderColor: `${slot.color}90` }}>
        <div className="marque">
          <h2 style={{ color: slot.color }}>{slot.name}</h2>
          <div className="tagline">{slot.tagline}</div>
          <div className="type-tag">{TYPE_PROFILES[slot.gameType].label}</div>
        </div>
        {fallbackNote && (
          <p className="fallback-note center">Showing a themed preset — live generation needs the API key configured on the server.</p>
        )}
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
          <div className="last-win">
            {state.phase === 'celebrating' && state.rollup != null
              ? `+${fmt(state.rollup)}`
              : state.view ? `+${fmt(state.view.runningTotal)}` : state.lastWin > 0 ? `+${fmt(state.lastWin)}` : ''}
          </div>
        </div>
        <Paytable slot={slot} />
        {state.phase === 'celebrating' && state.outcome && state.tier && state.tier !== 'small' && (
          <WinOverlay rollup={state.rollup ?? state.outcome.totalWin} cascades={state.outcome.cascades} tier={state.tier} />
        )}
      </div>
    </div>
  );
}
