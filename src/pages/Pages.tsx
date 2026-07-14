// Phase C pages: Lobby (catalogue), Build (the flow as its own screen),
// Machine (the game, addressable by shareable URL).

import React, { useEffect, useRef, useState } from 'react';
import { GameType, SlotDef, TYPE_PROFILES } from '../engine';
import { buildMachine } from '../generation/client';
import { CatalogEntry } from '../lib/catalog';
import { encodeSlot } from '../lib/share';
import { consumeForgeIntent, setForgeIntent } from '../lib/forge';
import { useGame } from '../hooks/useGame';
import { ArtMap, fmt, Paytable, Reels, WinOverlay } from '../components/Game';
import { sound } from '../sound/engine';

const CHIPS = ['Pirate', 'Japanese', 'Deep space', 'Italian', 'Dragon', 'Luxury', 'Wizard', 'Safari', 'Rock', 'Fiesta'];

export function MachineCard({ entry, onPlay }: { entry: CatalogEntry; onPlay: () => void }) {
  const { slot } = entry;
  const preview = [...slot.symbols].reverse().slice(0, 3);
  return (
    <button className="mcard" style={{ '--mc': slot.color } as React.CSSProperties} onClick={onPlay}>
      <div className="mcard-name">{slot.name}</div>
      <div className="mcard-tag">{slot.tagline}</div>
      <div className="mcard-syms">{preview.map((s) => <span key={s.emoji}>{s.emoji}</span>)}</div>
      <div className="mcard-foot">
        <span className="type-tag">{TYPE_PROFILES[slot.gameType].label}</span>
        {entry.source === 'session' && <span className="type-tag mine">Your build</span>}
        {entry.source === 'community' && <span className="type-tag community">Community</span>}
        {entry.source === 'house' && <span className="type-tag house">Original</span>}
      </div>
    </button>
  );
}

export function Lobby({ entries, go }: { entries: CatalogEntry[]; go: (hash: string) => void }) {
  const session = entries.filter((e) => e.source === 'session');
  const house = entries.filter((e) => e.source === 'house');
  const community = entries.filter((e) => e.source === 'community');
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
      {house.length > 0 && (
        <section>
          <h3 className="row-title">Winsmyth Originals <span className="row-note">featured machines</span></h3>
          <div className="mgrid">
            {house.map((e) => <MachineCard key={e.id} entry={e} onPlay={() => go(`#/m/${encodeSlot(e.slot)}`)} />)}
          </div>
        </section>
      )}
      {community.length > 0 && (
        <section>
          <h3 className="row-title">Community machines <span className="row-note">built by players</span></h3>
          <div className="mgrid">
            {community.map((e) => <MachineCard key={e.id} entry={e} onPlay={() => go(`#/m/${encodeSlot(e.slot)}`)} />)}
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

export function Build({ onBuilt, go }: { onBuilt: (slot: SlotDef, fallback: boolean, held: boolean) => void; go: (hash: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [reels, setReels] = useState(5);
  const [gameType, setGameType] = useState<GameType>('paylines');
  const [building, setBuilding] = useState(false);
  const [rejectedMsg, setRejectedMsg] = useState(false);

  const build = async () => {
    if (building || !prompt.trim()) return;
    setBuilding(true);
    setRejectedMsg(false);
    const { slot, usedFallback, held, rejected } = await buildMachine({ prompt, reels, gameType });
    setBuilding(false);
    if (rejected) { setRejectedMsg(true); return; }
    onBuilt(slot, usedFallback, held);
    if (slot.artId) setForgeIntent();
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
        {rejectedMsg && (
          <p className="fallback-note">That theme couldn't be published. Try a different direction — the catalogue is family-friendly.</p>
        )}
      </div>
    </div>
  );
}

export function Machine({ slot, note, go }: { slot: SlotDef; note: string | null; go: (hash: string) => void }) {
  const { state, bets, betIdx, setBetIdx, spin, setTurbo, setAuto } = useGame(slot);
  const [copied, setCopied] = useState(false);
  const [artMap, setArtMap] = useState<ArtMap>({});
  const [artBusy, setArtBusy] = useState(false);
  const [forging, setForging] = useState(() => consumeForgeIntent() && Boolean(slot.artId));
  const [progress, setProgress] = useState({ completed: 0, total: 10 });
  const artAlive = useRef(true);

  // Give the machine its voice: theme-derived scale + timbre, and a
  // short welcome motif (no-ops silently if the audio context hasn't
  // been unlocked by a user gesture yet).
  useEffect(() => {
    sound.setMachine(slot);
    sound.welcome();
    return () => sound.setMachine(null);
  }, [slot]);

  // Layer 2 loop: step the art pipeline while this page is open. Each
  // call generates or critiques ONE asset server-side; symbols upgrade
  // from emoji as they pass the critic. Resumable — any visitor
  // continues an unfinished machine's art.
  useEffect(() => {
    artAlive.current = true;
    setArtMap({});
    if (!slot.artId) return;
    const id = slot.artId;
    let steps = 0;
    setArtBusy(true);
    // Forge never traps: released on completion, on any error, or at 90s.
    const failsafe = window.setTimeout(() => { if (artAlive.current) setForging(false); }, 90_000);
    (async () => {
      while (artAlive.current && steps < 30) {
        steps += 1;
        try {
          const res = await fetch('/api/art-step', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          });
          if (!res.ok) break; // unconfigured / ineligible / failed → emoji stays
          const d = await res.json();
          if (!artAlive.current) break;
          if (d.artMap) setArtMap(d.artMap);
          if (typeof d.completed === 'number' && typeof d.total === 'number') {
            setProgress({ completed: d.completed, total: d.total });
          }
          if (d.phase === 'done') break;
        } catch { break; }
      }
      if (artAlive.current) { setArtBusy(false); setForging(false); }
      window.clearTimeout(failsafe);
    })();
    return () => { artAlive.current = false; window.clearTimeout(failsafe); };
  }, [slot]);

  const share = async () => {
    const url = `${location.origin}${location.pathname}#/m/${encodeSlot(slot)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable; the URL is already in the bar */ }
  };

  if (forging) {
    const tiles = Object.values(artMap);
    return (
      <div className="machine-page">
        <div className="machine-nav">
          <button className="chip" onClick={() => go('#/')}>← Lobby</button>
          <button className="chip" onClick={() => setForging(false)}>Skip the wait</button>
        </div>
        <div className="forge-card" style={{ '--mc': slot.color } as React.CSSProperties}>
          <h2 className="chrome-text forge-title">{slot.name}</h2>
          <div className="tagline">Your machine is being forged…</div>
          <div className="forge-tray">
            {Array.from({ length: progress.total }, (_, i) => {
              const key = tiles[i];
              return key
                ? <img key={i} className="forge-tile" src={`/api/art-get?key=${encodeURIComponent(key)}`} alt="" />
                : <div key={i} className="forge-tile pending" style={{ animationDelay: `${i * 120}ms` }} />;
            })}
          </div>
          <div className="forge-bar"><div className="forge-fill" style={{ width: `${Math.round((progress.completed / Math.max(1, progress.total)) * 100)}%` }} /></div>
          <div className="forge-count">{progress.completed} / {progress.total} pieces forged</div>
        </div>
      </div>
    );
  }

  return (
    <div className="machine-page">
      {artMap.bg && (
        <div
          className="page-bg"
          style={{ backgroundImage: `url(/api/art-get?key=${encodeURIComponent(artMap.bg)})` }}
          aria-hidden="true"
        />
      )}
      <div className="machine-nav">
        <button className="chip" onClick={() => go('#/')}>← Lobby</button>
        <button className="chip" onClick={() => go('#/build')}>Build another</button>
        <button className="chip" onClick={share}>{copied ? 'Link copied!' : 'Share machine'}</button>
      </div>
      <div
        className="machine"
        style={{
          '--mc': slot.color,
          ...(artMap.bg ? {
            backgroundImage: `linear-gradient(rgba(18,8,38,.55), rgba(18,8,38,.78)), url(/api/art-get?key=${encodeURIComponent(artMap.bg)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {}),
        } as React.CSSProperties}
      >
        <div className="marque">
          {artMap.marque
            ? <img className="marque-art" src={`/api/art-get?key=${encodeURIComponent(artMap.marque)}`} alt={slot.name} />
            : <h2 className="chrome-text">{slot.name}</h2>}
          <div className="tagline">{slot.tagline}</div>
          <div className="type-tag">{TYPE_PROFILES[slot.gameType].label}</div>
        </div>
        {note && <p className="fallback-note center">{note}</p>}
        {artBusy && <p className="art-note">✦ Painting your machine's artwork…</p>}
        {state.freeSpins > 0 && (
          <div className="fs-banner">FREE SPINS ×{state.freeSpins}{state.expandEmoji ? ` — ${state.expandEmoji} pays double` : ''}</div>
        )}
        <Reels slot={slot} state={state} artMap={artMap} />
        <div className="controls">
          <div className="bet">
            <button onClick={() => setBetIdx(Math.max(0, betIdx - 1))} disabled={state.phase !== 'idle'}>−</button>
            <span className="bet-val">{fmt(bets[betIdx])}</span>
            <button onClick={() => setBetIdx(Math.min(bets.length - 1, betIdx + 1))} disabled={state.phase !== 'idle'}>+</button>
          </div>
          <button
            className={`btn-spin${state.auto ? ' stopping' : ''}`}
            onClick={state.auto ? () => setAuto(false) : spin}
            disabled={!state.auto && (state.phase !== 'idle' || (!state.freeSpins && state.balance < bets[betIdx]))}
          >
            {state.auto ? 'STOP' : state.freeSpins > 0 ? 'FREE SPIN' : 'SPIN'}
          </button>
          <div className="spin-mods">
            <button
              className={`chip mod${state.turbo ? ' on' : ''}`}
              onClick={() => setTurbo(!state.turbo)}
              title="Quick spin"
            >⚡ TURBO</button>
            <button
              className={`chip mod${state.auto ? ' on' : ''}`}
              onClick={() => setAuto(!state.auto)}
              title="Auto spin"
            >🔁 AUTO</button>
          </div>
          <div className="last-win">
            {state.phase === 'celebrating' && state.rollup != null
              ? `+${fmt(state.rollup)}`
              : state.view ? `+${fmt(state.view.runningTotal)}` : state.lastWin > 0 ? `+${fmt(state.lastWin)}` : ''}
          </div>
        </div>
        <Paytable slot={slot} artMap={artMap} bet={bets[betIdx]} />
        {state.phase === 'celebrating' && state.outcome && state.tier && state.tier !== 'small' && (
          <WinOverlay rollup={state.rollup ?? state.outcome.totalWin} cascades={state.outcome.cascades} tier={state.tier} />
        )}
      </div>
    </div>
  );
}
