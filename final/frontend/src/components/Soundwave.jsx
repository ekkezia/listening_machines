import { useEffect, useRef } from 'react';
import { useMic } from '../context/MicContext';

const NUM_BARS = 28;
const MIN_H    = 3;
const MAX_H    = 34;

const SHAPE = Array.from({ length: NUM_BARS }, (_, i) => {
  const t = i / (NUM_BARS - 1);
  return Math.sin(t * Math.PI) * 0.7 + 0.3;
});

function lerp(a, b, t) { return Math.round(a + (b - a) * Math.min(1, Math.max(0, t))); }

export default function Soundwave({ isActive }) {
  const barsRef    = useRef([]);
  const volRef     = useRef(0);
  const rafRef     = useRef(null);
  const cleanupRef = useRef(null);

  useEffect(() => {
    if (!isActive) {
      cleanupRef.current?.();
      barsRef.current.forEach(b => {
        if (b) { b.style.height = `${MIN_H}px`; b.style.opacity = '0.2'; }
      });
      volRef.current = 0;
      return;
    }

    let cancelled = false;

    async function init() {
      let ctx, stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        ctx = new AudioContext();
        await ctx.resume();

        const source   = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const buf = new Uint8Array(analyser.fftSize);

        function frame() {
          if (cancelled) return;
          rafRef.current = requestAnimationFrame(frame);

          analyser.getByteTimeDomainData(buf);

          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const target = Math.min(rms * 10, 1);

          volRef.current = target > volRef.current
            ? volRef.current + (target - volRef.current) * 0.7
            : volRef.current + (target - volRef.current) * 0.1;

          const vol = volRef.current;

          barsRef.current.forEach((bar, i) => {
            if (!bar) return;
            const jitter = vol > 0.04 ? (Math.random() - 0.5) * vol * 10 : 0;
            const h      = MIN_H + (vol * SHAPE[i] * (MAX_H - MIN_H)) + jitter;
            bar.style.height  = `${Math.max(MIN_H, h).toFixed(1)}px`;
            bar.style.opacity = (0.18 + vol * SHAPE[i] * 0.82).toFixed(2);
            const intensity   = vol * SHAPE[i];
            bar.style.background = `rgb(${lerp(90,220,intensity)},${lerp(110,235,intensity)},255)`;
          });
        }

        frame();
      } catch (err) {
        console.warn('[Soundwave] Mic unavailable — idle fallback:', err);
        let t = 0;
        function idle() {
          if (cancelled) return;
          rafRef.current = requestAnimationFrame(idle);
          t += 0.055;
          barsRef.current.forEach((bar, i) => {
            if (!bar) return;
            const phase = (i / NUM_BARS) * Math.PI;
            const h     = MIN_H + ((Math.sin(t + phase) + 1) / 2) * 7;
            bar.style.height     = `${h.toFixed(1)}px`;
            bar.style.opacity    = '0.3';
            bar.style.background = 'rgb(130,140,255)';
          });
        }
        idle();
      }

      cleanupRef.current = () => {
        cancelled = true;
        cancelAnimationFrame(rafRef.current);
        stream?.getTracks().forEach(t => t.stop());
        if (ctx?.state && ctx.state !== 'closed') {
          ctx.close().catch(() => {});
        }
      };
    }

    init();
    return () => cleanupRef.current?.();
  }, [isActive]);

  return (
    <div className="flex items-center justify-center gap-[3px] h-9">
      {[...Array(NUM_BARS)].map((_, i) => (
        <div
          key={i}
          ref={el => barsRef.current[i] = el}
          className="w-[3px] rounded-full"
          style={{ height: `${MIN_H}px`, background: 'rgb(90,110,255)', opacity: 0.18 }}
        />
      ))}
    </div>
  );
}
