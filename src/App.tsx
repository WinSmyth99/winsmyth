// App shell — Phase C. Hash router over three pages, session catalogue,
// app-level wallet in the header. No router dependency: three routes
// don't need one.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { SlotDef } from './engine';
import { sound } from './sound/engine';
import { wallet } from './lib/wallet';
import { CatalogEntry, presetEntries } from './lib/catalog';
import { decodeSlot } from './lib/share';
import { Build, Lobby, Machine } from './pages/Pages';
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
  const [fallbackIds, setFallbackIds] = useState<Set<string>>(new Set());

  const entries = useMemo<CatalogEntry[]>(() => [...session, ...presetEntries()], [session]);

  const onBuilt = (slot: SlotDef, usedFallback: boolean) => {
    const id = `session-${Date.now()}`;
    setSession((s) => [{ id, slot, source: 'session' }, ...s]);
    if (usedFallback) setFallbackIds((f) => new Set(f).add(slot.name));
  };

  // Route resolution
  let page: JSX.Element;
  if (hash.startsWith('#/m/')) {
    const slot = decodeSlot(hash.slice(4));
    page = slot
      ? <Machine slot={slot} fallbackNote={fallbackIds.has(slot.name)} go={go} />
      : (
        <div className="lobby"><section className="hero">
          <h2>Machine not found</h2>
          <p>That share link didn't decode into a valid machine.</p>
          <button className="btn-build hero-cta" onClick={() => go('#/')}>BACK TO LOBBY</button>
        </section></div>
      );
  } else if (hash.startsWith('#/build')) {
    page = <Build onBuilt={onBuilt} go={go} />;
  } else {
    page = <Lobby entries={entries} go={go} />;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="logo logo-btn" onClick={() => go('#/')} aria-label="Winsmyth lobby">
          <h1>WINSMYTH</h1>
          <div className="sub">Social Casino · Free to Play</div>
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
