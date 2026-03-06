import { useRef, useCallback } from 'react';
import { useMic } from '../context/MicContext';
import { supabase } from '../supabase';

/**
 * Records audio from the shared mic stream and uploads it to Supabase Storage.
 * Returns { startRecording, stopAndUpload }.
 * stopAndUpload() resolves with { url, duration, mimeType } or null on error.
 */
export default function useAudioRecorder() {
  const { stream: streamRef, ready } = useMic();
  const recorderRef  = useRef(null);
  const chunksRef    = useRef([]);
  const startTimeRef = useRef(null);

  const startRecording = useCallback(() => {
    if (!ready || !streamRef.current) {
      console.warn('[Recorder] Mic not ready');
      return;
    }

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(
      m => MediaRecorder.isTypeSupported(m)
    ) || '';

    const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {});
    chunksRef.current    = [];
    startTimeRef.current = Date.now();

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start(100);
    recorderRef.current = recorder;
    console.log('[Recorder] Started', mimeType);
  }, [ready, streamRef]);

  const stopAndUpload = useCallback((pathPrefix = 'recordings') => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }

      const duration = (Date.now() - startTimeRef.current) / 1000;

      recorder.onstop = async () => {
        try {
          const mimeType = recorder.mimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: mimeType });
          chunksRef.current = [];

          // Upload to Supabase Storage
          const ext  = mimeType.includes('ogg') ? 'ogg' : 'webm';
          const path = `${pathPrefix}/${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from('recordings')
            .upload(path, blob, { contentType: mimeType });

          let url = null;
          if (upErr) {
            console.warn('[Recorder] Upload failed:', upErr.message);
          } else {
            url = supabase.storage.from('recordings').getPublicUrl(path).data.publicUrl;
            console.log('[Recorder] Uploaded:', url);
          }

          resolve({ url, duration: Math.round(duration), mimeType, blob });
        } catch (err) {
          console.error('[Recorder] Error stopping recorder:', err);
          resolve(null);
        }
      };

      recorder.stop();
      recorderRef.current = null;
    });
  }, []);

  return { startRecording, stopAndUpload };
}
