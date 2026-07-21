// App shell — Phase C. Hash router over three pages, session catalogue,
// app-level wallet in the header. No router dependency: three routes
// don't need one.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { SlotDef } from './engine';
import { sound } from './sound/engine';
import { wallet } from './lib/wallet';
import { CatalogEntry, fetchCommunity, presetEntries } from './lib/catalog';
import { decodeSlot } from './lib/share';
import LobbyScene from './components/LobbyScene';
import { Build, Fairness, Lobby, Machine } from './pages/Pages';
import { fmt } from './components/Game';

function useHash(): string {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  const go = useCallback((h: string) => { location.hash = h; }, []);
  const balance = useSyncExternalStore(wallet.subscribe, wallet.get);
  const [muted, setMuted] = useState(false);
  const [session, setSession] = useState<CatalogEntry[]>([]);
  const [community, setCommunity] = useState<CatalogEntry[]>([]);
  const [fallbackIds, setFallbackIds] = useState<Set<string>>(new Set());
  const [heldIds, setHeldIds] = useState<Set<string>>(new Set());
  const [unlistedIds, setUnlistedIds] = useState<Set<string>>(new Set());

  useEffect(() => { void fetchCommunity().then(setCommunity); }, []);

  const entries = useMemo<CatalogEntry[]>(() => {
    const sessionNames = new Set(session.map((e) => e.slot.name));
    const house = community.filter((e) => e.source === 'house');
    const communityOnly = community.filter((e) => e.source === 'community' && !sessionNames.has(e.slot.name));
    // Presets are the fallback only when no house machines exist yet.
    return [
      ...session,
      ...house,
      ...communityOnly,
      ...(house.length === 0 ? presetEntries() : []),
    ];
  }, [session, community]);

  const [failReasons, setFailReasons] = useState<Map<string, string>>(new Map());
  const onBuilt = (slot: SlotDef, usedFallback: boolean, held: boolean, unlisted: boolean, failReason?: string) => {
    const id = `session-${Date.now()}`;
    setSession((s) => [{ id, slot, source: 'session' }, ...s]);
    if (usedFallback) setFallbackIds((f) => new Set(f).add(slot.name));
    if (failReason) setFailReasons((m) => new Map(m).set(slot.name, failReason));
    if (held) setHeldIds((h) => new Set(h).add(slot.name));
    if (unlisted && slot.artId) setUnlistedIds((u) => new Set(u).add(slot.artId!));
    if (!usedFallback && !held && !unlisted) void fetchCommunity().then(setCommunity);
  };

  // Route resolution. The decode MUST be memoized: an unstable slot
  // identity re-triggers useGame's new-machine reset on every app
  // re-render (e.g. the balance changing at spin start), which killed
  // the spin timeline the moment it began. Root cause of the
  // grid-just-changes bug.
  const decodedSlot = useMemo(
    () => (hash.startsWith('#/m/') ? decodeSlot(hash.slice(4)) : null),
    [hash],
  );

  let page: JSX.Element;
  if (hash.startsWith('#/m/')) {
    const slot = decodedSlot;
    page = slot
      ? <Machine
          slot={slot}
          note={heldIds.has(slot.name)
            ? 'Your machine is playable here and held from the public catalogue pending review.'
            : failReasons.get(slot.name) === 'rate_limited'
              ? 'The forge is cooling down: builds are limited per hour. This is a themed preset; try your build again shortly.'
              : fallbackIds.has(slot.name)
                ? 'Showing a themed preset. Live generation hit a server problem; try again in a minute.'
                : null}
          canPublish={Boolean(slot.artId && unlistedIds.has(slot.artId))}
          onPublished={() => {
            if (slot.artId) setUnlistedIds((u) => { const n = new Set(u); n.delete(slot.artId!); return n; });
            void fetchCommunity().then(setCommunity);
          }}
          go={go}
        />
      : (
        <div className="lobby"><section className="hero">
          <h2>Machine not found</h2>
          <p>That share link didn't decode into a valid machine.</p>
          <button className="btn-build hero-cta" onClick={() => go('#/')}>BACK TO LOBBY</button>
        </section></div>
      );
  } else if (hash.startsWith('#/fair')) {
    page = <Fairness go={go} />;
  } else if (hash.startsWith('#/build')) {
    page = <Build onBuilt={onBuilt} go={go} />;
  } else {
    page = <Lobby entries={entries} go={go} />;
  }

  return (
    <div className="shell">
      <LobbyScene />
      <header className="topbar">
        <button className="logo logo-btn" onClick={() => go('#/')} aria-label="Winsmyth lobby">
          <h1>WINSMYTH</h1>
          <div className="sub">Prompt · Forge · Play · <a className="fair-link" href="#/fair">Fair play</a></div>
        </button>
        <div className="wallet">
          <button className="mute" onClick={() => setMuted(sound.toggleMute())} aria-label="Toggle sound">
            {muted ? '🔇' : '🔊'}
          </button>
          <span className="gc">{fmt(balance)} GC</span>
        </div>
      </header>
      <main>{page}</main>
    </div>
  );
}
