import { useEffect, useRef } from "react";

const g = (p: number, mu: number, sig: number, amp: number) => amp * Math.exp(-((p - mu) ** 2) / (2 * sig * sig));
const beat = (p: number) => g(p, 0.12, 0.025, 0.14) + g(p, 0.235, 0.008, -0.16) + g(p, 0.26, 0.009, 1) + g(p, 0.285, 0.01, -0.3) + g(p, 0.46, 0.045, 0.26);
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

interface Props { phase: number; ratio: number; color: string }

/** Scrolling ECG. Rate slows as the deadline nears; the line weakens with each rung and goes flat when the switch has closed. */
export function Heartbeat({ phase, ratio, color }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ phase, ratio, color });
  live.current = { phase, ratio, color };

  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext("2d")!;
    let raf = 0, w = 0, h = 0;
    const fit = () => { const r = devicePixelRatio || 1; w = cv.clientWidth; h = cv.clientHeight; cv.width = w * r; cv.height = h * r; ctx.setTransform(r, 0, 0, r, 0, 0); };
    fit(); addEventListener("resize", fit);
    const speed = 150; // px per second

    const draw = (now: number) => {
      const { phase: ph, ratio: ra, color: col } = live.current;
      const bpm = ph === 1 ? 38 + 36 * Math.max(0, Math.min(1, ra)) : ph === 2 ? 30 : ph === 3 ? 22 : 40;
      const amp = ph === 1 ? 1 : ph === 2 ? 0.8 : ph === 3 ? 0.42 : 0;
      const period = 60 / bpm;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = col;
      const base = h * 0.68, scale = h * 0.6, t = now / 1000;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const tx = t - (w - x) / speed;
        const idx = Math.floor(tx / period);
        const jitter = ph === 2 ? (hash(idx) - 0.5) * 0.5 * period : 0; // irregular once warned
        const p = ((tx - jitter) / period) - Math.floor((tx - jitter) / period);
        const noise = amp === 0 ? Math.sin(tx * 9) * 0.004 : 0;
        const y = base - (amp * beat(p) + noise) * scale;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(0.35, col); grad.addColorStop(1, col);
      ctx.strokeStyle = grad; ctx.stroke();
      // leading dot
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(w - 2, base - (amp * beat(((t / period) % 1)) ) * scale, 4, 0, 6.3); ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", fit); };
  }, []);

  return <canvas ref={ref} className="heartbeat" role="img" aria-label="Live heartbeat of the switch" />;
}
