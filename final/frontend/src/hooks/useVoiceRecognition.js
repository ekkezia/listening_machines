import { useEffect, useRef, useCallback } from 'react';
import { COMMANDS } from '../utils/voiceVerify';

const dispatch = (cmd) =>
  window.dispatchEvent(new CustomEvent('voiceCommand', { detail: cmd }));

/**
 * Starts the Web Speech API as soon as `enabled` flips to true.
 * Automatically restarts after each result or silence timeout.
 * Calls onSpeechStart / onSpeechEnd so the UI can update the dot.
 */
export default function useVoiceRecognition({ enabled, onSpeechStart, onSpeechEnd }) {
  const recRef    = useRef(null);
  const activeRef = useRef(false);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (recRef.current) {
      recRef.current.onend = null;
      try { recRef.current.abort(); } catch (_) {}
      recRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('[Darwin] SpeechRecognition not supported.');
      return;
    }

    const rec = new SR();
    rec.lang           = 'en-US';
    rec.continuous     = false;
    rec.interimResults = false;
    recRef.current     = rec;

    rec.onstart  = () => onSpeechStart?.();
    rec.onspeech = () => onSpeechStart?.();
    rec.onsoundend = () => onSpeechEnd?.();

    rec.onresult = (event) => {
      const text = event.results[0][0].transcript.trim().toLowerCase();
      console.log('[Darwin] Heard:', text);
      const matched = COMMANDS.find((cmd) => text.includes(cmd));
      if (matched) dispatch(matched);
      onSpeechEnd?.();
    };

    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[Darwin] SR error:', e.error);
      }
      onSpeechEnd?.();
    };

    rec.onend = () => {
      onSpeechEnd?.();
      if (activeRef.current) {
        setTimeout(start, 150);
      }
    };

    try {
      rec.start();
      activeRef.current = true;
    } catch (e) {
      console.warn('[Darwin] Could not start recognition:', e);
    }
  }, [onSpeechStart, onSpeechEnd]);

  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }
    return stop;
  }, [enabled, start, stop]);
}
