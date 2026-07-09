// Session wallet — a tiny external store so the balance survives
// navigation between pages (useGame instances mount per machine page).
// Session-only by design; the ledger replaces this at the money milestone.

type Listener = () => void;

let balance = 2_250_000;
const listeners = new Set<Listener>();

export const wallet = {
  get: () => balance,
  set: (n: number) => {
    balance = n;
    listeners.forEach((l) => l());
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
