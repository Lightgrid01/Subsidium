import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// Live market panel powered by the public dreamDEX HTTP API.
// Endpoints used: GET /v0/markets and GET /v0/markets/{symbol}/tickers
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
  volume: number;
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
          volume: Number(k?.volume ?? 0),
          idle: !k || close === 0,
        };
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        return { symbol: m.symbol, price: 0, change: null, volume: 0, idle: true };
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
.mp{position:fixed;right:16px;bottom:16px;z-index:20;width:min(300px,calc(100vw - 32px));
  color:#fff;font:500 13px/1.4 inherit;border-radius:20px;overflow:hidden;
  background:rgba(14,32,18,.42);border:1px solid rgba(255,255,255,.26);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  box-shadow:0 10px 30px rgba(0,0,0,.22)}
.mp-head{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;
  padding:12px 16px;cursor:pointer;font-weight:600;letter-spacing:.02em}
.mp-head:focus-visible{outline:2px solid #fff;outline-offset:-2px}
.mp-dot{width:8px;height:8px;border-radius:50%;background:#7dffa0;box-shadow:0 0 8px #7dffa0}
.mp-toggle{margin-left:auto;opacity:.7;font-weight:500}
.mp-body{padding:2px 16px 14px}
.mp-row{display:flex;align-items:baseline;gap:8px;padding:7px 0;border-top:1px solid rgba(255,255,255,.14)}
.mp-sym{flex:1;font-weight:600}
.mp-price{font-variant-numeric:tabular-nums}
.mp-chg{min-width:58px;text-align:right;font-variant-numeric:tabular-nums}
.mp-up{color:#8dffae}
.mp-down{color:#ffb0a8}
.mp-flat{opacity:.65}
.mp-note{margin:6px 0;opacity:.8}
.mp-src{margin:10px 0 0;font-size:11px;opacity:.6}
`;

function MarketPulse() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
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
  }, []);

  return (
    <aside className="mp" aria-label="dreamDEX markets">
      <style>{CSS}</style>
      <button className="mp-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mp-dot" />
        <span>dreamDEX markets</span>
        <span className="mp-toggle">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mp-body">
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
    </aside>
  );
}

// Mount the panel without touching App.tsx.
if (!document.getElementById("market-pulse-root")) {
  const host = document.createElement("div");
  host.id = "market-pulse-root";
  document.body.appendChild(host);
  createRoot(host).render(<MarketPulse />);
}
