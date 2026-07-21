// Phase C pages: Lobby (catalogue), Build (the flow as its own screen),
// Machine (the game, addressable by shareable URL).

import React, { useEffect, useRef, useState } from 'react';
import { GameType, SlotDef, TYPE_PROFILES } from '../engine';
import { buildMachine } from '../generation/client';
import { CatalogEntry } from '../lib/catalog';
import { ART_STYLES } from '../lib/artStyles';
import { encodeSlot } from '../lib/share';
import { consumeForgeIntent, setForgeIntent } from '../lib/forge';
import { useGame } from '../hooks/useGame';
import { ArtMap, fmt, Paytable, Reels, WinOverlay } from '../components/Game';
import { sound } from '../sound/engine';

const CHIPS = ['Pirate', 'Japanese', 'Deep space', 'Italian', 'Dragon', 'Luxury', 'Wizard', 'Safari', 'Rock', 'Fiesta'];

export function MachineCard({ entry, onPlay }: { entry: CatalogEntry; onPlay: () => void }) {
  const { slot } = entry;
  const preview = [...slot.symbols].reverse().slice(0, 3);
  // Catalog-served entries (community/house) arrive with art. Session
  // builds don't — fetch their persisted art map lazily so "Your
  // machines" shows real art without requiring a publish.
  const [fetched, setFetched] = useState<{ bg?: string; symbols?: string[] } | undefined>();
  useEffect(() => {
    if (entry.art || !slot.artId) return;
    let alive = true;
    fetch(`/api/art-map?id=${encodeURIComponent(slot.artId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.artMap) return;
        const m = d.artMap as Record<string, string>;
        const symbols: string[] = [];
        for (let i = 7; i >= 0 && symbols.length < 3; i--) if (m[`s${i}`]) symbols.push(m[`s${i}`]);
        if (symbols.length || m.bg) setFetched({ ...(m.bg ? { bg: m.bg } : {}), symbols });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [entry.art, slot.artId]);
  const art = entry.art ?? fetched;
  const hasThumbs = Boolean(art?.symbols?.length);
  return (
    <button
      className={art?.bg || hasThumbs ? 'mcard mcard-art' : 'mcard'}
      style={{
        '--mc': slot.color,
        ...(art?.bg ? {
          backgroundImage: `linear-gradient(180deg, rgba(9,4,22,.66) 0%, rgba(9,4,22,.9) 78%), url(/api/art-get?key=${encodeURIComponent(art.bg)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : {}),
      } as React.CSSProperties}
      onClick={onPlay}
    >
      <div className="mcard-name">{slot.name}</div>
      <div className="mcard-tag">{slot.tagline}</div>
      <div className="mcard-syms">
        {hasThumbs
          ? art!.symbols!.map((k) => (
            <img key={k} className="mcard-thumb" src={`/api/art-get?key=${encodeURIComponent(k)}`} alt="" loading="lazy" />
          ))
          : preview.map((s) => <span key={s.emoji}>{s.emoji}</span>)}
      </div>
      <div className="mcard-foot">
        <span className="type-tag">{TYPE_PROFILES[slot.gameType].label}</span>
        {entry.source === 'session' && <span className="type-tag mine">Your build</span>}
        {entry.source === 'community' && <span className="type-tag community">Community</span>}
        {entry.source === 'house' && <span className="type-tag house">Original</span>}
        {typeof entry.plays === 'number' && entry.plays > 0 && (
          <span className="play-count">▶ {entry.plays.toLocaleString()}</span>
        )}
      </div>
    </button>
  );
}

export function Lobby({ entries, go }: { entries: CatalogEntry[]; go: (hash: string) => void }) {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [themeFilter, setThemeFilter] = useState<string>('all');
  const themes = Array.from(new Set(entries.map((e) => e.slot.themeStyle))).sort();
  const match = (e: CatalogEntry) =>
    (typeFilter === 'all' || e.slot.gameType === typeFilter)
    && (themeFilter === 'all' || e.slot.themeStyle === themeFilter);
  const session = entries.filter((e) => e.source === 'session' && match(e));
  const house = entries.filter((e) => e.source === 'house' && match(e));
  const community = entries.filter((e) => e.source === 'community' && match(e));
  const nothingToShow = session.length === 0 && house.length === 0 && community.length === 0;
  return (
    <div className="lobby">
      <div className="lobby-wordmark"><span>WINSMYTH</span></div>
      <section className="hero">
        <h2>Your Machine Awaits</h2>
        <p>Describe any theme and watch your bespoke machine come to life in seconds.</p>
        <button className="btn-build hero-cta" onClick={() => go('#/build')}>BUILD YOUR OWN</button>
      </section>
      <div className="filter-bar">
        <span className="filter-label">Mechanic</span>
        {['all', 'paylines', 'ways', 'scatter', 'cluster'].map((t) => (
          <button key={t} className={`chip filt${typeFilter === t ? ' on' : ''}`} onClick={() => setTypeFilter(t)}>{t === 'all' ? 'All' : t}</button>
        ))}
        {themes.length > 1 && <span className="filter-label sep">Theme</span>}
        {themes.length > 1 && ['all', ...themes].map((t) => (
          <button key={t} className={`chip filt${themeFilter === t ? ' on' : ''}`} onClick={() => setThemeFilter(t)}>{t === 'all' ? 'All' : t}</button>
        ))}
      </div>
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
      {nothingToShow && (
        <section className="lobby-empty">
          <p>No machines yet. Press <strong>Build your own</strong> to create the first one.</p>
        </section>
      )}
    </div>
  );
}

export function Build({ onBuilt, go }: { onBuilt: (slot: SlotDef, fallback: boolean, held: boolean, unlisted: boolean, failReason?: string) => void; go: (hash: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [reels, setReels] = useState(5);
  const [artStyle, setArtStyle] = useState('synthwave');
  const [gameType, setGameType] = useState<GameType>('paylines');
  const [building, setBuilding] = useState(false);
  const [rejectedMsg, setRejectedMsg] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);

  // Voice prompts: browser speech-to-text into the theme box. Feature-
  // detected; the mic button simply doesn't render where unsupported.
  const SR = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown });
  const SpeechRec = (SR.SpeechRecognition ?? SR.webkitSpeechRecognition) as (new () => {
    lang: string; interimResults: boolean; maxAlternatives: number;
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
    onend: () => void; onerror: () => void; start: () => void; stop: () => void;
  }) | undefined;

  const toggleVoice = () => {
    if (listening) { recRef.current?.stop(); return; }
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.lang = 'en-GB';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const t = e.results[0]?.[0]?.transcript ?? '';
      if (t) setPrompt((p) => (p ? `${p} ${t}` : t));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const build = async () => {
    if (building || !prompt.trim()) return;
    setBuilding(true);
    setRejectedMsg(false);
    const { slot, usedFallback, held, rejected, unlisted, failReason } = await buildMachine({ prompt, reels, gameType, artStyle });
    setBuilding(false);
    if (rejected) { setRejectedMsg(true); return; }
    onBuilt(slot, usedFallback, held, unlisted, failReason);
    if (slot.artId) setForgeIntent();
    go(`#/m/${encodeSlot(slot)}`);
  };

  return (
    <div className="build-page">
      <div className="panel build-center">
        <h2 className="panel-title">Design Your Machine</h2>
        <label className="pl" htmlFor="prompt">Describe any theme</label>
        <div className="prompt-wrap">
          <textarea
            id="prompt" value={prompt} rows={4}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A Viking raid on a fjord monastery — longships, runes, ravens."
          />
          {SpeechRec && (
            <button
              className={`mic-btn${listening ? ' live' : ''}`}
              onClick={toggleVoice}
              title={listening ? 'Stop listening' : 'Speak your theme'}
              type="button"
            >{listening ? '◉' : '🎤'}</button>
          )}
        </div>
        <div className="chips">
          {CHIPS.map((c) => <button key={c} className="chip" onClick={() => setPrompt(c)}>{c}</button>)}
        </div>
        <div className="cfg-row style-row">
          <label className="cfg-label" htmlFor="artstyle">Art style</label>
          <select id="artstyle" value={artStyle} onChange={(e) => setArtStyle(e.target.value)}>
            {ART_STYLES.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
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

export function Machine({ slot, note, canPublish, onPublished, go }: { slot: SlotDef; note: string | null; canPublish?: boolean; onPublished?: () => void; go: (hash: string) => void }) {
  const { state, bets, betIdx, setBetIdx, spin, setTurbo, setAuto } = useGame(slot);
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  // Real play counts: fire-and-forget ping when a machine opens.
  useEffect(() => {
    if (slot.artId) void fetch('/api/play-count', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: slot.artId }),
    }).catch(() => undefined);
  }, [slot]);

  const publish = async () => {
    if (!slot.artId || publishing) return;
    setPublishing(true);
    try {
      const r = await fetch('/api/publish', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: slot.artId }),
      });
      if (r.ok) { setPublished(true); onPublished?.(); }
    } catch { /* stays unpublished */ }
    setPublishing(false);
  };
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
    // Rehydrate first: a finished machine reopened from the lobby has its
    // art persisted on the row. Seed the map so background, marque and
    // symbols show at once, rather than blank until a full re-forge (which
    // may never complete within the step budget — bg is generated last).
    (async () => {
      try {
        const r = await fetch(`/api/art-map?id=${encodeURIComponent(id)}`);
        if (r.ok && artAlive.current) {
          const d = await r.json();
          if (d.artMap && Object.keys(d.artMap).length) setArtMap(d.artMap);
        }
      } catch { /* fall through to live forge */ }
    })();
    let steps = 0;
    setArtBusy(true);
    // Budget scales with the machine's asset count. Each asset costs up to
    // ~4 steps (generate, critique, one regenerate, re-critique) now that
    // the critic actually runs and rejects scenes. A fixed 30-step / 90s
    // cap (sized for the old no-critic pipeline) cut large machines off
    // mid-forge, leaving later symbols as emoji. We instead loop until the
    // server reports 'done', with generous ceilings derived from the real
    // asset total the server sends back.
    const symbolCount = slot.symbols.length + 2; // + wild + scatter
    const assetTotal = symbolCount + 2; // + marque + bg
    const stepCeiling = assetTotal * 5 + 10; // ample headroom for retries
    const timeCeiling = Math.min(300_000, assetTotal * 12_000 + 30_000); // ~12s/asset, capped at 5 min
    const failsafe = window.setTimeout(() => { if (artAlive.current) setForging(false); }, timeCeiling);
    (async () => {
      while (artAlive.current && steps < stepCeiling) {
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
          if (d.artMap) setArtMap((prev) => ({ ...prev, ...d.artMap }));
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
      <div
        className="page-bg"
        style={artMap.bg
          ? { backgroundImage: `url(/api/art-get?key=${encodeURIComponent(artMap.bg)})` }
          : { background: 'transparent' }}
        aria-hidden="true"
      />
      <div className="machine-nav">
        <button className="chip" onClick={() => go('#/')}>← Lobby</button>
        <button className="chip" onClick={() => go('#/build')}>Build another</button>
        <button className="chip" onClick={share}>{copied ? 'Link copied!' : 'Share machine'}</button>
      </div>
      <div
        className="machine"
        style={{ '--mc': slot.color } as React.CSSProperties}
      >
        <div className="marque">
          {artMap.marque
            ? <img className="marque-art" src={`/api/art-get?key=${encodeURIComponent(artMap.marque)}`} alt={slot.name} />
            : <h2 className="chrome-text">{slot.name}</h2>}
          <div className="tagline">{slot.tagline}</div>
          <div className="type-tag">{TYPE_PROFILES[slot.gameType].label}</div>
        </div>
        {note && <p className="fallback-note center">{note}</p>}
        {canPublish && !published && (
          <p className="publish-row">
            Your machine is approved and private.{' '}
            <button className="chip publish-btn" onClick={publish} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish to community'}
            </button>
          </p>
        )}
        {published && <p className="publish-row done">✦ Published — it's live in the community catalogue.</p>}
        {artBusy && <p className="art-note">✦ Painting your machine's artwork…</p>}
        {state.freeSpins > 0 && (
          <div className="fs-banner">FREE SPINS ×{state.freeSpins}{state.expandEmoji ? ` — ${state.expandEmoji} pays double` : ''}</div>
        )}
        <Reels slot={slot} state={state} artMap={artMap} />
        <div className="controls">
          <div className="bet">
            {/* Bet locks while free spins remain: free spins pay at the
                stake that triggered them, not a raised one. */}
            <button onClick={() => setBetIdx(Math.max(0, betIdx - 1))} disabled={state.phase !== 'idle' || state.freeSpins > 0}>−</button>
            <span className="bet-val">{fmt(bets[betIdx])}</span>
            <button onClick={() => setBetIdx(Math.min(bets.length - 1, betIdx + 1))} disabled={state.phase !== 'idle' || state.freeSpins > 0}>+</button>
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


export function Fairness({ go }: { go: (hash: string) => void }) {
  return (
    <div className="fair-page">
      <button className="chip" onClick={() => go('#/')}>← Lobby</button>
      <h2 className="chrome-text">How Winsmyth plays fair</h2>
      <div className="fair-body">
        <h3>The maths is the maths</h3>
        <p>Every machine's paytable computes the exact same expression as the award engine, at every stake — verified by automated tests on every deployment. What you read is what you're paid.</p>
        <h3>Capped wins</h3>
        <p>The maximum award on any single spin, including cascades and free spins, is 5,000× your bet.</p>
        <h3>Free to play</h3>
        <p>Winsmyth is a social casino. Gold Coins have no cash value; play is for entertainment. There is nothing to buy and nothing to withdraw.</p>
        <h3>Reviewed before published</h3>
        <p>Every player-built machine passes an automatic content review before it can appear in the public catalogue, and anything uncertain is held for human review. The public floor is family-friendly by policy.</p>
        <h3>An honest prototype</h3>
        <p>Winsmyth is a working prototype. Spins are resolved by in-browser random number generation for demonstration purposes; the production platform moves outcome generation server-side under a certified maths model.</p>
      </div>
    </div>
  );
}
