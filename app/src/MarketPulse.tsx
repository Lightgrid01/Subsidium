import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// dreamDEX markets, powered by the public dreamDEX HTTP API.
// Endpoints used: GET /v0/markets and GET /v0/markets/{symbol}/tickers
// Closed by default as a small corner button, so it never covers the dashboard.
const API =
  (import.meta.env.VITE_DREAMDEX_API as string | undefined) ||
  "https://stg.api.dreamdex.io";

type Market = { symbol: string };
type Ticker = {
  symbol: string;
  open: string;
  close: string;
  volume: string;
  lastTradeAt: number | null;
};
type Row = {
  symbol: string;
  price: number;
  change: number | null;
  idle: boolean;
};

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function loadRows(signal: AbortSignal): Promise<Row[]> {
  const { markets } = await getJson<{ markets: Market[] }>("/v0/markets", signal);
  const top = (markets || []).slice(0, 6);
  return Promise.all(
    top.map(async (m): Promise<Row> => {
      try {
        const t = await getJson<{ symbols: Ticker[] }>(
          `/v0/markets/${m.symbol}/tickers`,
          signal
        );
        const k = t.symbols?.[0];
        const open = Number(k?.open ?? 0);
        const close = Number(k?.close ?? 0);
        return {
          symbol: m.symbol,
          price: close,
          change: open > 0 && close > 0 ? ((close - open) / open) * 100 : null,
          idle: !k || close === 0,
        };
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        return { symbol: m.symbol, price: 0, change: null, idle: true };
      }
    })
  );
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(5);
}

const CSS = `
.mp{position:fixed;right:16px;bottom:16px;z-index:30;color:#fff;font-family:inherit;font-size:13px;line-height:1.4}
.mp-btn{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;
  height:40px;min-width:40px;padding:0 11px;border-radius:20px;cursor:pointer;font-weight:500;
  background:#173404;border:1px solid rgba(255,255,255,.3);color:#fff}
.mp-btn:focus-visible,.mp-x:focus-visible{outline:2px solid #fff;outline-offset:2px}
.mp-lbl{display:none}
.mp-pop{position:absolute;right:0;bottom:48px;width:min(300px,calc(100vw - 32px));box-sizing:border-box;
  padding:10px 16px 12px;border-radius:16px;background:#173404;border:1px solid rgba(255,255,255,.3)}
.mp-top{display:flex;align-items:center;gap:8px;padding-bottom:8px;font-weight:500}
.mp-dot{width:8px;height:8px;border-radius:50%;background:#7dffa0}
.mp-x{all:unset;margin-left:auto;cursor:pointer;opacity:.75;padding:2px 6px}
.mp-row{display:flex;align-items:baseline;gap:8px;padding:7px 0;border-top:1px solid rgba(255,255,255,.16)}
.mp-sym{flex:1;font-weight:500}
.mp-price,.mp-chg{font-variant-numeric:tabular-nums}
.mp-chg{min-width:58px;text-align:right}
.mp-up{color:#8dffae}
.mp-down{color:#ffb0a8}
.mp-flat{opacity:.65}
.mp-note{margin:6px 0;opacity:.8}
.mp-src{margin:8px 0 0;font-size:11px;opacity:.65}
@media (min-width:900px){.mp-lbl{display:inline}.mp-btn{padding:0 14px}}
`;

function MarketPulse() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const next = await loadRows(ctrl.signal);
        if (alive) {
          setRows(next);
          setError(false);
        }
      } catch (e) {
        if (alive && (e as Error).name !== "AbortError") setError(true);
      }
    };
    run();
    const id = window.setInterval(run, 30000);
    return () => {
      alive = false;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div className="mp" ref={box}>
      <style>{CSS}</style>
      {open && (
        <div className="mp-pop" role="dialog" aria-label="dreamDEX markets">
          <div className="mp-top">
            <span className="mp-dot" />
            <span>dreamDEX markets</span>
            <button className="mp-x" onClick={() => setOpen(false)} aria-label="Close markets">
              Close
            </button>
          </div>
          {!rows && error && (
            <p className="mp-note">The dreamDEX API is not reachable right now.</p>
          )}
          {!rows && !error && <p className="mp-note">Loading markets</p>}
          {rows && rows.length === 0 && <p className="mp-note">No markets returned.</p>}
          {rows &&
            rows.map((r) => {
              const dir =
                r.change === null || r.change === 0
                  ? "mp-flat"
                  : r.change > 0
                  ? "mp-up"
                  : "mp-down";
              return (
                <div className="mp-row" key={r.symbol}>
                  <span className="mp-sym">{r.symbol}</span>
                  <span className="mp-price">{r.idle ? "no trades" : fmtPrice(r.price)}</span>
                  <span className={`mp-chg ${dir}`}>
                    {r.change === null
                      ? "n/a"
                      : `${r.change > 0 ? "+" : ""}${r.change.toFixed(2)}%`}
                  </span>
                </div>
              );
            })}
          <p className="mp-src">Live from the dreamDEX HTTP API, 24 hour change</p>
        </div>
      )}
      <button
        className="mp-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Toggle dreamDEX markets"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="2,15 7,9 11,12 18,4" />
          <polyline points="13,4 18,4 18,9" />
        </svg>
        <span className="mp-lbl">Markets</span>
      </button>
    </div>
  );
}

// Mount the button after the app, without touching App.tsx.
if (!document.getElementById("market-pulse-root")) {
  const host = document.createElement("div");
  host.id = "market-pulse-root";
  document.body.appendChild(host);
  createRoot(host).render(<MarketPulse />);
}
