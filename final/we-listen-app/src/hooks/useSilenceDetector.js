import { useEffect, useRef } from 'react';
import { useMic } from '../context/MicContext';

const DEFAULT_SILENCE_MS = 3000;
const DEFAULT_THRESHOLD  = 0.01;

/**
 * Monitors microphone RMS via the shared MicContext while `active` is true.
 * Calls `onSilence` once after `silenceDurationMs` of continuous quiet.
 * Resets the timer whenever sound above `threshold` is detected.
 */
export default function useSilenceDetector({
  active,
  silenceDurationMs = DEFAULT_SILENCE_MS,
  threshold         = DEFAULT_THRESHOLD,
  onSilence,
}) {
  const onSilenceRef = useRef(onSilence);
  useEffect(() => { onSilenceRef.current = onSilence; }, [onSilence]);

  const { analyser: analyserRef, ready } = useMic();

  useEffect(() => {
    if (!active || !ready || !analyserRef.current) return;

    const analyser   = analyserRef.current;
    const buf        = new Uint8Array(analyser.fftSize);
    let rafId        = null;
    let silenceStart = null;
    let fired        = false;
    let cancelled    = false;

    function frame() {
      if (cancelled || fired) return;
      rafId = requestAnimationFrame(frame);

      analyser.getByteTimeDomainData(buf);

      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);

      if (rms < threshold) {
        if (silenceStart === null) silenceStart = performance.now();
        else if (performance.now() - silenceStart >= silenceDurationMs) {
          fired = true;
          onSilenceRef.current?.();
        }
      } else {
        silenceStart = null;
      }
    }

    frame();
    return () => { cancelled = true; cancelAnimationFrame(rafId); };
  }, [active, ready, silenceDurationMs, threshold]);
}
