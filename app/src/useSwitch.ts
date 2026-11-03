import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, parseEventLogs, type Log } from "viem";
import { abi, FROM_BLOCK, hideki, SUBSIDIUM } from "./config";

export const publicClient = createPublicClient({ chain: hideki, transport: http() });

export interface SwitchState {
  phase: number; deadline: number; interval: number; stepDelay: number; health: number | null; owner: string; poll: number; reduce: bigint; close: bigint; guardian: `0x${string}`;
}
export interface Entry { id: string; kind: string; text: string; ts?: number; tx: string; muted?: boolean }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function describe(l: any): Omit<Entry, "id" | "ts" | "tx"> | null {
  const a = l.args;
  switch (l.eventName) {
    case "Armed": return { kind: "armed", text: `Switch armed. Silence for ${a.interval}s starts the ladder.` };
    case "CheckedIn": return { kind: "ok", text: `Checked in by ${short(a.by)}. Clock reset.` };
    case "Warned": return { kind: "warn", text: "No check-in. Warning issued; positions untouched." };
    case "Cut": return { kind: "cut", text: `${a.isBid ? "Bought" : "Sold"} ${Number(a.quantity) / 1e18} to cut ${a.pct}% on ${short(a.pool)}. Reason: ${a.reason}.` };
    case "CutFailed": return { kind: "fail", text: `Order rejected on ${short(a.pool)}. The ladder moved on.` };
    case "HealthTrip": return { kind: "cut", text: `Margin health ${(Number(a.healthBps) / 10000).toFixed(2)}x. Cutting ${a.pct}%.` };
    case "Rescheduled": return { kind: "tick", text: `Validators booked the next check for ${new Date(Number(a.at) * 1000).toLocaleTimeString()}.`, muted: true };
    case "Disarmed": return { kind: "off", text: `Switch disarmed by ${short(a.by)}.` };
    default: return null;
  }
}

export function useSwitch() {
  const [state, setState] = useState<SwitchState | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const blockTs = useRef(new Map<bigint, number>());
  const [skew, setSkew] = useState(0); // chain time minus local time, seconds

  const read = useCallback(async () => {
    if (!SUBSIDIUM) return;
    try {
      const c = { address: SUBSIDIUM, abi } as const;
      const [phase, deadline, interval, stepDelay, h, owner, block, poll, reduce, close, guardian] = await Promise.all([
        publicClient.readContract({ ...c, functionName: "phase" }),
        publicClient.readContract({ ...c, functionName: "deadline" }),
        publicClient.readContract({ ...c, functionName: "interval" }),
        publicClient.readContract({ ...c, functionName: "stepDelay" }),
        publicClient.readContract({ ...c, functionName: "healthBps" }),
        publicClient.readContract({ ...c, functionName: "owner" }),
        publicClient.getBlock(),
        publicClient.readContract({ ...c, functionName: "pollInterval" }),
        publicClient.readContract({ ...c, functionName: "reduceBelowBps" }),
        publicClient.readContract({ ...c, functionName: "closeBelowBps" }),
        publicClient.readContract({ ...c, functionName: "guardian" }),
      ]);
      setSkew(Number(block.timestamp) - Math.floor(Date.now() / 1000));
      setState({ phase, deadline: Number(deadline), interval: Number(interval), stepDelay: Number(stepDelay), health: h[0] ? Number(h[1]) / 10000 : null, owner, poll: Number(poll), reduce, close, guardian });
      setError("");
    } catch (e: any) { setError("Cannot read the contract. Check the address and the network."); }
  }, []);

  const loadLogs = useCallback(async () => {
    if (!SUBSIDIUM) return;
    try {
      const head = await publicClient.getBlockNumber();
      const from = FROM_BLOCK > 0n ? FROM_BLOCK : head > 50_000n ? head - 50_000n : 0n;
      const raw = (await publicClient.getLogs({ address: SUBSIDIUM, fromBlock: from, toBlock: head })) as Log[];
      const logs = parseEventLogs({ abi, logs: raw as any });
      const need = [...new Set(logs.map((l) => l.blockNumber!))].filter((b) => !blockTs.current.has(b)).slice(-40);
      await Promise.all(need.map(async (b) => { const blk = await publicClient.getBlock({ blockNumber: b }); blockTs.current.set(b, Number(blk.timestamp)); }));
      const out: Entry[] = [];
      for (const l of logs as any[]) {
        const d = describe(l); if (!d) continue;
        out.push({ ...d, id: `${l.transactionHash}-${l.logIndex}`, tx: l.transactionHash, ts: blockTs.current.get(l.blockNumber) });
      }
      setEntries(out.reverse());
    } catch { /* keep previous timeline */ }
  }, []);

  useEffect(() => { read(); loadLogs(); const a = setInterval(read, 2500), b = setInterval(loadLogs, 5000); return () => { clearInterval(a); clearInterval(b); }; }, [read, loadLogs]);

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) { setError("No wallet found. Install a browser wallet and reload."); return; }
    const [addr] = await eth.request({ method: "eth_requestAccounts" });
    try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xc4cf" }] }); }
    catch { await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0xc4cf", chainName: hideki.name, nativeCurrency: hideki.nativeCurrency, rpcUrls: hideki.rpcUrls.default.http }] }); }
    setAccount(addr);
  }, []);

  const send = useCallback(async (fn: "arm" | "checkIn" | "panic" | "disarm") => {
    const eth = (window as any).ethereum; if (!eth || !account) { setError("Connect your wallet first."); return; }
    setBusy(true);
    try {
      const w = createWalletClient({ account, chain: hideki, transport: custom(eth) });
      const hash = await w.writeContract({ address: SUBSIDIUM, abi, functionName: fn });
      await publicClient.waitForTransactionReceipt({ hash });
      await Promise.all([read(), loadLogs()]);
      setError("");
    } catch (e: any) { setError(e?.shortMessage || "Transaction failed."); }
    setBusy(false);
  }, [account, read, loadLogs]);

  const setWindow = useCallback(async (interval: number, step: number) => {
    const eth = (window as any).ethereum; if (!eth || !account || !state) { setError("Connect your wallet first."); return; }
    setBusy(true);
    try {
      const w = createWalletClient({ account, chain: hideki, transport: custom(eth) });
      const hash = await w.writeContract({ address: SUBSIDIUM, abi, functionName: "configure", args: [BigInt(interval), BigInt(step), BigInt(state.poll), state.reduce, state.close, state.guardian] });
      await publicClient.waitForTransactionReceipt({ hash });
      await Promise.all([read(), loadLogs()]);
      setError("");
    } catch (e: any) { setError(e?.shortMessage || "Transaction failed."); }
    setBusy(false);
  }, [account, state, read, loadLogs]);

  return { state, entries, account, error, busy, skew, connect, send, setWindow };
}
