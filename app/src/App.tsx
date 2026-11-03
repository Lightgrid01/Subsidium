import { Fragment, useEffect, useState } from "react";
import { Heartbeat } from "./Heartbeat";
import { PHASES, SUBSIDIUM } from "./config";
import { useSwitch } from "./useSwitch";

const COLORS = ["#9fb4c4", "#c7f55b", "#ffb02e", "#ff6a3d", "#ff4b3e"];
const TINTS = ["#000000", "#000000", "#ff9d00", "#ff4a1c", "#000000"];
const fmt = (s: number) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; const mm = String(m).padStart(h ? 2 : 1, "0"); return `${h ? h + ":" : ""}${mm}:${String(r).padStart(2, "0")}`; };
const parts = (s: number): [string, string][] => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60, p = (n: number) => String(n).padStart(2, "0"); return h ? [[String(h), "hours"], [p(m), "min"], [p(r), "sec"]] : [[String(m), "min"], [p(r), "sec"]]; };
const human = (s: number) => (s < 120 ? `${s} seconds` : s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? "" : "s"}` : s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? "" : "s"}` : `${s / 60} minutes`);
const WINDOWS = [{ label: "1 hour", i: 3600, s: 300 }, { label: "6 hours", i: 21600, s: 900 }, { label: "24 hours", i: 86400, s: 3600 }, { label: "3 days", i: 259200, s: 21600 }, { label: "Demo", i: 60, s: 20 }];
const clock = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const SAY = ["The switch is off.", "until the switch warns you.", "until it cuts half of everything.", "until it closes everything.", "The switch closed your positions."];
const FINE = [
  "Positions stay as they are. Arm the switch to protect them while you are away.",
  "Silence for the full window starts the ladder. Checking in at any point resets the clock.",
  "You were quiet for the whole window. Check in now to stop the cuts.",
  "Half of every position is already cut. Check in now to stop the close.",
  "Everything was closed on-chain. Arm the switch again to protect new positions.",
];

const Spark = () => <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden><path d="M10 1.5l1.9 5.6 5.6 1.9-5.6 1.9L10 16.5l-1.9-5.6L2.5 9l5.6-1.9z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;

function Background({ phase }: { phase: number }) {
  useEffect(() => { const r = document.documentElement.style; r.setProperty("--state", COLORS[phase]); r.setProperty("--tint", TINTS[phase]); }, [phase]);
  return <div className="bgwrap" data-phase={phase} aria-hidden><div className="bg" /><div className="haze" /><div className="tint" /><div className="scrim" /></div>;
}

function Setup() {
  const [v, setV] = useState("");
  return (
    <section className="setup">
      <h2>Connect your switch</h2>
      <p>Paste the Subsidium contract address you deployed.</p>
      <input value={v} onChange={(e) => setV(e.target.value.trim())} placeholder="0x…" aria-label="Contract address" />
      <button disabled={!/^0x[0-9a-fA-F]{40}$/.test(v)} onClick={() => { localStorage.setItem("subsidium", v); location.reload(); }}>Save address</button>
    </section>
  );
}

export default function App() {
  const [more, setMore] = useState(false);
  const { state, entries, account, error, busy, skew, connect, send, setWindow } = useSwitch();
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => { const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 500); return () => clearInterval(i); }, []);
  const phase = state?.phase ?? 0;
  if (!SUBSIDIUM) return <><Background phase={0} /><Setup /></>;

  const chainNow = now + skew, left = state ? state.deadline - chainNow : 0;
  const active = phase >= 1 && phase <= 3;
  const span = state ? (phase === 1 ? state.interval : state.stepDelay) : 1;
  const ratio = Math.min(1, Math.max(0, left / span));
  const d = state?.deadline ?? 0, s = state?.stepDelay ?? 0;
  const rungAt = [phase === 1 ? d : 0, phase === 1 ? d + s : phase === 2 ? d : 0, phase === 1 ? d + 2 * s : phase === 2 ? d + s : phase === 3 ? d : 0];
  const isOwner = !!account && state?.owner.toLowerCase() === account.toLowerCase();
  const health = state?.health != null ? Math.min(1, Math.max(0, (state.health - 1) / 2)) : 0;
  const rungs = ["Warn you", "Cut half", "Close all"];

  return (
    <>
      <Background phase={phase} />
      <header className="nav" id="top">
        <span className="brand">Subsidium</span>
        <a className="mid" href="#top">Switch</a>
        <a className="mid" href="#box">Black box</a>
        <button className="wallet" onClick={connect}>{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet"}</button>
      </header>

      <main className="frame">
        <i className="vl l" aria-hidden><i style={{ height: `${active ? (1 - ratio) * 100 : 0}%` }} /></i>
        <i className="vl r" aria-hidden><i style={{ height: `${health * 100}%` }} /></i>

        <section className="top">
          <div className="offer">
            <p className="label">Switch status</p>
            <div className="tags">
              <span className="tag on">{PHASES[phase]}</span>
              <span className="tag">{state?.health != null ? `Margin ${state.health.toFixed(2)}x` : "No open position"}</span>
              <span className="tag">Window {state ? human(state.interval) : "—"}</span>
            </div>
          </div>
          <aside className="card" aria-label="Ladder and black box">
            <div className="tiles">
              <div className="tilebox">
                {rungs.map((t, i) => {
                  const done = phase > i + 1 || phase === 4, cur = phase === i + 1;
                  return <div key={t} className={`mini ${done ? "done" : cur ? "cur" : ""}`}><i /><div>{t}<span>{done ? "Done" : active && rungAt[i] ? `in ${fmt(rungAt[i] - chainNow)}` : "Waiting"}</span></div></div>;
                })}
              </div>
              <div className="tilebox">
                {entries.length === 0 && <span>Nothing yet. Actions appear here.</span>}
                {entries.filter((e) => !e.muted).slice(0, 4).map((e) => <div className="ev" key={e.id}><time>{clock(e.ts)}</time>{e.text}</div>)}
              </div>
            </div>
            <div className="tabs"><span>Ladder</span><span>Black box</span></div>
            <p>Every action lands in the black box with its transaction the moment it happens. <a href="#box">See all</a></p>
          </aside>
        </section>

        <span />

        <section className="bottom">
          <div className="headline">
            <h1><span className="clock">{active ? parts(left).map(([v, u], i) => <Fragment key={u}>{i > 0 && <span className="sep">:</span>}<span className="seg"><b>{v}</b><small>{u}</small></span></Fragment>) : phase === 4 ? "Closed" : "Off"}</span><br /><span className="say">{SAY[phase]}</span></h1>
            <div className="prog" aria-hidden><i style={{ width: `${active ? (1 - ratio) * 100 : 0}%` }} /></div>
            <div className="ctarow">
              <button className="cta" disabled={busy || !account || phase === 0 || phase === 4} onClick={() => send("checkIn")}>I’m here<Spark /></button>
              <Heartbeat phase={phase} ratio={ratio} color={COLORS[phase]} />
            </div>
          </div>
          <div className="fine">
            <p>{FINE[phase]}</p>
            <button className="morebtn" aria-expanded={more} onClick={() => setMore((o) => !o)}>{more ? "Hide" : "Window and controls"}</button>
            <div className={`more ${more ? "open" : ""}`}>
            <div className="row"><span>Go quiet for</span>{WINDOWS.map((w) => <button key={w.label} className={`sm ${state?.interval === w.i ? "on" : ""}`} disabled={busy || !isOwner} onClick={() => setWindow(w.i, w.s)}>{w.label}</button>)}</div>
            <div className="row">
              {phase === 0 || phase === 4 ? <button className="sm" disabled={busy || !isOwner} onClick={() => send("arm")}>Arm the switch</button> : <button className="sm" disabled={busy || !isOwner} onClick={() => send("disarm")}>Turn off</button>}
              <button className="sm danger" disabled={busy || !isOwner} onClick={() => confirm("Close all positions now?") && send("panic")}>Close everything now</button>
            </div>
            </div>
            {error && <p className="err" role="alert">{error}</p>}
          </div>
        </section>
      </main>

      <section className="full" id="box">
        <h2>Black box</h2>
        <ol>
          {entries.length === 0 && <li className="empty">Nothing yet. Arm the switch and every action lands here with its transaction.</li>}
          {entries.map((e) => <li key={e.id} className={`${e.kind} ${e.muted ? "muted" : ""}`}><time>{clock(e.ts)}</time><span>{e.text}</span><code title={e.tx}>{e.tx.slice(0, 10)}…</code></li>)}
        </ol>
      </section>
    </>
  );
}
