import { defineChain, parseAbi } from "viem";

export const hideki = defineChain({
  id: 50383,
  name: "Somnia Hideki",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.hideki2.infra.testnet.somnia.network"] } },
});

export const SUBSIDIUM = (localStorage.getItem("subsidium") || import.meta.env.VITE_SUBSIDIUM || "") as `0x${string}`;
export const FROM_BLOCK = BigInt(import.meta.env.VITE_FROM_BLOCK || 0);

export const abi = parseAbi([
  "function owner() view returns (address)",
  "function phase() view returns (uint8)",
  "function deadline() view returns (uint64)",
  "function interval() view returns (uint64)",
  "function stepDelay() view returns (uint64)",
  "function healthBps() view returns (bool ok, uint256 bps)",
  "function pollInterval() view returns (uint64)",
  "function reduceBelowBps() view returns (uint256)",
  "function closeBelowBps() view returns (uint256)",
  "function guardian() view returns (address)",
  "function configure(uint64 interval_, uint64 stepDelay_, uint64 pollInterval_, uint256 reduceBelowBps_, uint256 closeBelowBps_, address guardian_)",
  "function arm()",
  "function checkIn()",
  "function panic()",
  "function disarm()",
  "event Armed(uint64 deadline, uint64 interval)",
  "event CheckedIn(address indexed by, uint64 deadline)",
  "event Warned(uint64 at, uint64 nextStepAt)",
  "event Cut(address indexed pool, bool isBid, uint256 quantity, uint256 pct, string reason)",
  "event CutFailed(address indexed pool, bytes reason)",
  "event HealthTrip(uint256 healthBps, uint256 pct)",
  "event Rescheduled(uint64 at)",
  "event Disarmed(address indexed by)",
]);

export const PHASES = ["Disarmed", "Armed", "Warned", "Reduced", "Closed"] as const;
