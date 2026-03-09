import { useEffect, useRef } from 'react';
import { COMMANDS } from '../utils/voiceVerify';

const dispatch = (cmd) =>
  window.dispatchEvent(new CustomEvent('voiceCommand', { detail: cmd }));

export default function useVoiceRecognition({ enabled, onSpeechStart, onSpeechEnd }) {
  const enabledRef = useRef(enabled);
  const pausedRef  = useRef(false);
  const recRef     = useRef(null);
  const onStartRef = useRef(onSpeechStart);
  const onEndRef   = useRef(onSpeechEnd);

  useEffect(() => { onStartRef.current = onSpeechStart; }, [onSpeechStart]);
  useEffect(() => { onEndRef.current   = onSpeechEnd;   }, [onSpeechEnd]);
  useEffect(() => { enabledRef.current = enabled;       }, [enabled]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.warn('[Darwin] SpeechRecognition not supported.'); return; }

    let restartTimer = null;
    let explicitStop = false; // true only when WE stop it on purpose

    function stop() {
      explicitStop = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      if (recRef.current) {
        recRef.current.onend = null;
        try { recRef.current.abort(); } catch (_) {}
        recRef.current = null;
      }
    }

    function start() {
      if (!enabledRef.current || pausedRef.current) return;
      if (recRef.current) return;

      explicitStop = false;
      const rec = new SR();
      rec.lang           = 'en-US';
      rec.continuous     = false; // one utterance at a time — most reliable across browsers
      rec.interimResults = false;
      recRef.current     = rec;

      rec.onstart      = () => { console.log('[Darwin] listening'); onStartRef.current?.(); };
      rec.onspeechstart = () => onStartRef.current?.();
      rec.onspeechend   = () => onEndRef.current?.();

      rec.onresult = (event) => {
        const text = event.results[0]?.[0]?.transcript?.trim().toLowerCase() ?? '';
        console.log('[Darwin] heard:', text);
        const matched = COMMANDS.find(cmd => text.includes(cmd));
        if (matched) dispatch(matched);
        onEndRef.current?.();
      };

      rec.onerror = (e) => {
        // 'no-speech' and 'aborted' are not real errors — just restart quietly
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[Darwin] error:', e.error);
        }
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          // Permanent — don't retry
          recRef.current = null;
          return;
        }
        onEndRef.current?.();
        // onend will fire after onerror and handle the restart
      };

      rec.onend = () => {
        recRef.current = null;
        onEndRef.current?.();
        if (!explicitStop && enabledRef.current && !pausedRef.current) {
          // Restart immediately — no long delay needed, just yield the event loop
          restartTimer = setTimeout(start, 100);
        }
      };

      try {
        rec.start();
      } catch (e) {
        console.warn('[Darwin] start failed:', e.message);
        recRef.current = null;
        restartTimer = setTimeout(start, 300);
      }
    }

    window._darwinPause  = () => { console.log('[Darwin] paused');  pausedRef.current = true;  stop(); };
    window._darwinResume = () => { console.log('[Darwin] resumed'); pausedRef.current = false; if (enabledRef.current) setTimeout(start, 300); };

    if (enabled) { start(); } else { stop(); }

    return () => {
      stop();
      delete window._darwinPause;
      delete window._darwinResume;
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}