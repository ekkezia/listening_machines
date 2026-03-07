import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

/**
 * Opens the microphone once and shares a single AnalyserNode across the app.
 * In a regular web page (unlike a Chrome extension popup), we can call
 * openMic() on mount — no click-gate needed.
 */
const MicContext = createContext(null);

export function MicProvider({ children }) {
  const [ready, setReady]             = useState(false);
  const [micError, setMicError]       = useState(null);
  const [attempted, setAttempted]     = useState(false);
  const [permissionState, setPermissionState] = useState(null);
  const analyserRef = useRef(null);
  const streamRef   = useRef(null);
  const ctxRef      = useRef(null);
  const initingRef  = useRef(false);

  const openMic = useCallback(async ({ force = false } = {}) => {
    if ((!force && ready) || initingRef.current) return;
    initingRef.current = true;
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      const ctx = new AudioContext();
      await ctx.resume();

      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      streamRef.current   = stream;
      ctxRef.current      = ctx;
      analyserRef.current = analyser;
      setPermissionState('granted');
      setReady(true);
    } catch (err) {
      console.error('[MicProvider] Could not open mic:', err.name, err.message);
      setMicError(err.name);
      try {
        const result = await navigator.permissions.query({ name: 'microphone' });
        setPermissionState(result.state);
        result.onchange = () => setPermissionState(result.state);
      } catch { /* permissions API unavailable */ }
    } finally {
      initingRef.current = false;
      setAttempted(true);
    }
  }, [ready]);

  // In a web page (not extension popup), we can safely call openMic on mount.
  useEffect(() => {
    openMic();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      ctxRef.current?.close();
      analyserRef.current = null;
      streamRef.current   = null;
      ctxRef.current      = null;
    };
  }, []);

  return (
    <MicContext.Provider value={{ analyser: analyserRef, stream: streamRef, ready, micError, attempted, permissionState, openMic }}>
      {children}
    </MicContext.Provider>
  );
}

export function useMic() {
  return useContext(MicContext);
}
