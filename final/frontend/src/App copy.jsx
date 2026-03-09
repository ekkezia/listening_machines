import { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';
import { supabase } from './supabase';
import TabBar from './components/TabBar';
import PairingScreen from './components/PairingScreen';
import VoiceMessageCard from './components/VoiceMessageCard';
import ActionBar from './components/ActionBar';
import DebugPanel from './components/DebugPanel';
import UnlockConsentOverlay from './components/UnlockConsentOverlay';
import useVoiceRecognition from './hooks/useVoiceRecognition';
import useAudioRecorder from './hooks/useAudioRecorder';
import { checkVoiceCommand } from './utils/voiceVerify';
import { BACKEND_URL } from './config';
import LoginScreen from './components/LoginScreen';

const UNLOCK_COUNTDOWN_SECONDS = 2;
const UNLOCK_REQUEST_TTL_MS = 3 * 60 * 1000;

export const UNLOCK_STATUS = {
  RECORDING:       'recording',
  UPLOADING:       'uploading',
  VERIFYING:       'verifying',
  WAITING_PARTNER: 'waiting_partner',
  DECLINED:        'declined',
  ERROR:           'error',
};

const mapMessage = (row) => ({
  id: row.id,
  type: row.type ?? '',
  sender: row.sender ?? null,
  recipient: row.recipient ?? null,
  timestamp: row.timestamp,
  transcription: row.transcription,
  duration: row.duration ?? 0,
  data: row.data ?? '',
  participants: Array.isArray(row.participants)
    ? row.participants
    : (() => { try { return JSON.parse(row.participants ?? '[]'); } catch { return []; } })(),
});

const mapInvitation = (row) => ({
  id: row.id,
  from: row.from,
  to: row.to,
  status: row.status,
});

const mapUnlockRequest = (row) => ({
  id: row.id,
  kind: row.type ?? 'shared',
  requesterId: row.requester_id,
  partnerId: row.partner_id,
  status: row.status,
  countdownStartedAt: row.countdown_started_at,
  requesterAgreedAt: row.requester_agreed_at,
  partnerAgreedAt: row.partner_agreed_at,
  requesterRecordingStartedAt: row.requester_recording_started_at ?? null,
  partnerRecordingStartedAt: row.partner_recording_started_at ?? null,
  requesterAudioUrl: row.requester_audio_url ?? null,
  partnerAudioUrl: row.partner_audio_url ?? null,
  createdAt: row.created_at,
  unlockedAt: row.unlocked_at,
});

const buildPrivateUnlockRequest = ({ userId }) => {
  const now = new Date().toISOString();
  return {
    id: `private-${now}`,
    kind: 'private',
    requesterId: userId,
    partnerId: null,
    status: 'countdown',
    countdownStartedAt: now,
    requesterAgreedAt: null,
    partnerAgreedAt: null,
    createdAt: now,
    unlockedAt: null,
  };
};

const getCountdownRemaining = (startedAt, now = Date.now()) => {
  if (!startedAt) return UNLOCK_COUNTDOWN_SECONDS;
  const elapsed = now - new Date(startedAt).getTime();
  const remainingMs = (UNLOCK_COUNTDOWN_SECONDS * 1000) - elapsed;
  return Math.max(0, Math.ceil(remainingMs / 1000));
};

const isUnlockRequestComplete = (request) => {
  if (!request) return false;
  // Only trust status===unlocked set by server after verification.
  // agreedAt fields are written before verification completes and must not trigger unlock.
  return request.status === 'unlocked';
};

const isUnlockRequestCurrent = (request, now = Date.now()) => {
  if (!request?.createdAt) return false;
  return now - new Date(request.createdAt).getTime() <= UNLOCK_REQUEST_TTL_MS;
};

const isUnlockRequestRelevant = (request, now = Date.now()) => {
  if (!request || !isUnlockRequestCurrent(request, now)) return false;
  if (isUnlockRequestComplete(request)) return true;
  if (request.status === 'declined') return true;
  if (request.status === 'verification_failed') return false; // terminal — don't re-show
  return request.status === 'pending_partner' || request.status === 'countdown'
    || request.status === 'recording' || request.status === 'waiting_partner'
    || request.status === 'verifying';
};

const isUnlockRequestActive = (request, now = Date.now()) => {
  if (!request || !isUnlockRequestCurrent(request, now) || isUnlockRequestComplete(request)) return false;
  return request.status === 'pending_partner' || request.status === 'countdown'
    || request.status === 'recording' || request.status === 'waiting_partner'
    || request.status === 'verifying';
};

// Writes or clears active_unlock_request_id on the users row.
// Pass null to clear it (request resolved/declined/errored).
const setUserActiveUnlock = async (userId, requestId) => {
  await supabase.from('users')
    .update({ active_unlock_request_id: requestId })
    .eq('id', userId);
};

const saveMessage = async (data) => {
  try {
    const { data: inserted, error } = await supabase.from('messages').insert({
      sender: data.sender,
      recipient: data.recipient ?? null,
      type: data.type,
      participants: data.participants ?? null,
      data: data.data ?? null,
      mime_type: data.mimeType ?? null,
      duration: data.duration ?? 0,
      timestamp: new Date().toISOString(),
      transcription: data.transcription ?? null,
    }).select().single();
    if (error) throw error;
    return inserted;
  } catch (err) {
    console.error('[App] Supabase write error:', err);
    return null;
  }
};

/**
 * Records audio until the always-on SpeechRecognition (useVoiceRecognition) fires
 * a voiceCommand event containing "i agree", then returns { blob, detected }.
 *
 * Does NOT pause the main recogniser — it stays running so it can detect "i agree".
 * Opens a separate getUserMedia stream purely for MediaRecorder (audio capture).
 * On desktop Chrome two concurrent mic consumers work fine; on mobile we fall back
 * gracefully if getUserMedia fails while Speech API holds the mic.
 *
 * Timeout fallback at timeoutMs (default 15s).
 */
const recordUntilIAgree = (timeoutMs = 15000) => new Promise(async (resolve, reject) => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    // On some mobile browsers the Speech API holds exclusive mic access.
    // Pause it, wait, then retry once.
    console.warn('[recordUntilIAgree] First getUserMedia failed, pausing Speech API and retrying:', err.message);
    window._darwinPause?.();
    await new Promise(r => setTimeout(r, 400));
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err2) {
      window._darwinResume?.();
      reject(new Error('Microphone access denied: ' + err2.message));
      return;
    }
  }

  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
  recorder.onerror = (e) => {
    stream.getTracks().forEach(t => t.stop());
    window._darwinResume?.();
    reject(new Error('MediaRecorder error: ' + e.error?.message));
  };

  recorder.start();
  console.log('[recordUntilIAgree] Recording started. Waiting for "i agree"...');

  let detected = false;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(hardTimeout);
    window.removeEventListener('voiceCommand', onVoiceCommand);
    if (recorder.state === 'recording') recorder.stop();
  };

  const onVoiceCommand = (e) => {
    const cmd = typeof e.detail === 'string' ? e.detail : '';
    if (cmd.includes('i agree')) {
      console.log('[recordUntilIAgree] "i agree" detected — stopping recorder');
      detected = true;
      stop();
    }
  };

  window.addEventListener('voiceCommand', onVoiceCommand);
  const hardTimeout = setTimeout(() => {
    console.log('[recordUntilIAgree] Timeout — no "i agree" detected');
    stop();
  }, timeoutMs);

  await new Promise(r => { recorder.onstop = r; });
  stream.getTracks().forEach(t => t.stop());
  window._darwinResume?.(); // resume if we had to pause for the retry
  const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
  console.log('[recordUntilIAgree] Done. detected:', detected, 'blob:', blob.size, 'bytes');
  resolve({ blob, detected });
});


export default function App() {
  const [userId, setUserId] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [activeTab, setActiveTab] = useState('me');
  const [recordingState, setRecordingState] = useState('idle');
  const [privateMessages, setPrivateMessages] = useState([]);
  const [sharedMessages, setSharedMessages] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [partnerId, setPartnerId] = useState(null);
  const [isPrivateUnlocked, setIsPrivateUnlocked] = useState(false);
  const [isSharedUnlocked, setIsSharedUnlocked] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [isHearing, setIsHearing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [activeUnlockRequest, setActiveUnlockRequest] = useState(null);
  const [unlockActionPending, setUnlockActionPending] = useState(false);
  const [unlockNow, setUnlockNow] = useState(Date.now());
  const [unlockStatus, setUnlockStatus] = useState(null);

  const lastActivityRef = useRef(Date.now());
  const pendingRecordRef = useRef(null);
  const partnerIdRef = useRef(null);
  const userIdRef = useRef('');
  const pendingInvitationsRef = useRef([]);
  const activeUnlockRequestRef = useRef(null);
  const unlockActionPendingRef = useRef(false);
  const { startRecording, stopAndUpload } = useAudioRecorder();

  // Restore session from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('userId');
    if (saved) {
      setUserId(saved);
      setIsLoggedIn(true);
    }
    setSessionChecked(true);
  }, []);

    useEffect(() => { partnerIdRef.current = partnerId; }, [partnerId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { pendingInvitationsRef.current = pendingInvitations; }, [pendingInvitations]);
  useEffect(() => { activeUnlockRequestRef.current = activeUnlockRequest; }, [activeUnlockRequest]);
  useEffect(() => { unlockActionPendingRef.current = unlockActionPending; }, [unlockActionPending]);

  useEffect(() => {
    const forceLockHandler = () => { setIsPrivateUnlocked(false); setIsSharedUnlocked(false); setLockCountdown(0); };
    window.addEventListener('forceLock', forceLockHandler);
    return () => window.removeEventListener('forceLock', forceLockHandler);
  }, []);

  const onSpeechStart = useCallback(() => setIsHearing(true), []);
  const onSpeechEnd = useCallback(() => setIsHearing(false), []);

  useVoiceRecognition({
    enabled: isLoggedIn && !verifying,
    onSpeechStart,
    onSpeechEnd,
  });

  useEffect(() => {
    if (!userId) return;
    supabase.from('users').select('paired_with').eq('id', userId).single().then(({ data, error }) => {
      if (!error && data?.paired_with) setPartnerId(data.paired_with);
    });
  }, [userId]);

  const markUnlocked = useCallback((scope = 'private') => {
    setRecordingState('matched');
    if (scope === 'shared') setIsSharedUnlocked(true);
    else setIsPrivateUnlocked(true);
    setLockCountdown(60);
    setUnlockStatus(null);
    setVerifyError('');
    lastActivityRef.current = Date.now();
    window.setTimeout(() => setRecordingState('idle'), 1500);
  }, []);

  const dismissUnlockOverlay = useCallback(() => {
    setActiveUnlockRequest(null);
    setUnlockStatus(null);
    setVerifyError('');
    setUnlockActionPending(false);
  }, []);

  const beginRecording = useCallback(async (type) => {
    if (recordingState === 'recording' || recordingState === 'uploading') return;
    if (activeUnlockRequestRef.current && !isUnlockRequestComplete(activeUnlockRequestRef.current)) {
      setVerifyError('Finish the unlock consent prompt first.');
      return;
    }
    setVerifyError('');
    setVerifying(true);
    try {
      const currentPartnerId = partnerIdRef.current;
      if (type === 'private') {
        setActiveTab('me');
        pendingRecordRef.current = { sender: userId, recipient: userId, type: 'private' };
      } else {
        if (!currentPartnerId) { setVerifyError('No partner connected yet.'); return; }
        setActiveTab('us');
        pendingRecordRef.current = { sender: userId, type: 'shared', participants: [userId, currentPartnerId] };
      }
      startRecording();
      setRecordingState('recording');
    } finally {
      setVerifying(false);
    }
  }, [recordingState, startRecording, userId]);

  const handleStopRecording = useCallback(async () => {
    const meta = pendingRecordRef.current;
    if (!meta) return;
    pendingRecordRef.current = null;
    setRecordingState('uploading'); // keep button disabled during upload + transcribe

    const result = await stopAndUpload(meta.type, { upload: true, transcribe: false });

    let transcription = '';
    if (result?.blob) {
      try {
        const formData = new FormData();
        const ext = result.mimeType?.includes('ogg') ? 'ogg' : 'webm';
        formData.append('audio', result.blob, `audio.${ext}`);
        const resp = await fetch(`${BACKEND_URL}/transcribe`, { method: 'POST', body: formData });
        if (resp.ok) {
          const data = await resp.json();
          transcription = data.transcription || '';
        }
      } catch (err) {
        console.error('[Transcription] Error:', err);
      }
    }

    const inserted = await saveMessage({
      ...meta,
      data: result?.url ?? null,
      mimeType: result?.mimeType ?? null,
      duration: result?.duration ?? 0,
      transcription,
    });

    if (!inserted) {
      setRecordingState('idle');
      return;
    }
    const mapped = mapMessage(inserted);
    if (meta.type === 'private') {
      setPrivateMessages((prev) => prev.some((m) => m.id === mapped.id) ? prev : [mapped, ...prev]);
    } else {
      setSharedMessages((prev) => prev.some((m) => m.id === mapped.id) ? prev : [mapped, ...prev]);
    }
    setRecordingState('idle');
  }, [stopAndUpload]);

  const startPrivateUnlockFlow = useCallback(async () => {
    if (activeUnlockRequestRef.current && !isUnlockRequestComplete(activeUnlockRequestRef.current)) {
      setVerifyError('Finish the current unlock prompt first.');
      return;
    }
    setVerifyError('');
    setUnlockStatus(null);
    setActiveTab('me');
    setUnlockActionPending(true);

    // Insert a real DB row so the attempt is logged and the overlay has a proper id
    const now = new Date().toISOString();
    let request;
    try {
      const { data: inserted, error: insertErr } = await supabase
        .from('unlock_requests')
        .insert({
          requester_id: userId,
          partner_id: userId, // self-unlock
          type: 'private',
          status: 'countdown',
          countdown_started_at: now,
          created_at: now,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      request = {
        id: inserted.id,
        kind: 'private',
        requesterId: userId,
        partnerId: userId,
        status: 'countdown',
        countdownStartedAt: now,
        requesterAgreedAt: null,
        partnerAgreedAt: null,
        createdAt: now,
        unlockedAt: null,
      };
    } catch (err) {
      console.error('[Unlock:private] Failed to insert unlock_request row:', err);
      // Fall back to a local-only request so the UI still works
      request = buildPrivateUnlockRequest({ userId });
    }

    setActiveUnlockRequest(request);
    await setUserActiveUnlock(userId, request.id);

    try {
      // Wait out the countdown visually, then auto-record
      const countdownMs = UNLOCK_COUNTDOWN_SECONDS * 1000;
      await new Promise(r => setTimeout(r, countdownMs));

      console.log('[Unlock:private] Countdown done — starting recording');
      setUnlockStatus(UNLOCK_STATUS.RECORDING);

      let audioBlob, detected;
      try {
        ({ blob: audioBlob, detected } = await recordUntilIAgree());
      } catch (micErr) {
        setVerifyError(micErr.message || 'Microphone access denied.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        return;
      }
      if (!detected) {
        setVerifyError('No "I agree" detected. Please say it clearly and try again.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        await supabase.from('unlock_requests').update({ status: 'verification_failed' }).eq('id', request.id);
        return;
      }
      if (!audioBlob || audioBlob.size === 0) {
        setVerifyError('No audio captured. Please try again.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        return;
      }

      setUnlockStatus(UNLOCK_STATUS.VERIFYING);
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('user_id', userId);

      let resp, data;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        resp = await fetch(`${BACKEND_URL}/verify-me`, { method: 'POST', body: formData, signal: controller.signal });
        clearTimeout(timeout);
        data = await resp.json();
      } catch (fetchErr) {
        const msg = fetchErr?.name === 'AbortError'
          ? 'Server took too long to respond. Try again.'
          : 'Could not reach the server. Check your connection.';
        setVerifyError(msg);
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        return;
      }

      console.log('[Unlock:private] /verify-me response:', data);
      if (data.error || !data.success) {
        setVerifyError(data.error || 'Voice verification failed.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        // Log the failure in DB
        await supabase.from('unlock_requests')
          .update({ status: 'verification_failed' })
          .eq('id', request.id);
        return;
      }

      // Success — mark unlocked in DB then locally
      const unlockedAt = new Date().toISOString();
      await supabase.from('unlock_requests')
        .update({ status: 'unlocked', unlocked_at: unlockedAt })
        .eq('id', request.id);
      await setUserActiveUnlock(userId, null);

      setUnlockStatus(null);
      setActiveUnlockRequest((current) => {
        if (!current || current.id !== request.id) return current;
        return { ...current, status: 'unlocked', unlockedAt };
      });
      markUnlocked('private');
    } finally {
      setUnlockActionPending(false);
    }
  }, [userId]);

  const startSharedUnlockFlow = useCallback(async () => {
    if (unlockActionPendingRef.current) return;
    if (activeUnlockRequestRef.current && !isUnlockRequestComplete(activeUnlockRequestRef.current)) {
      setVerifyError('Finish the current unlock prompt first.');
      return;
    }
    const currentPartnerId = partnerIdRef.current;
    if (!currentPartnerId) { setVerifyError('No partner connected yet.'); return; }
    setVerifyError('');
    setActiveTab('us');
    setUnlockActionPending(true);
    try {
      const { data, error } = await supabase.from('unlock_requests').insert({
        requester_id: userId,
        partner_id: currentPartnerId,
        type: 'shared',
        status: 'pending_partner',
        created_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      // Mark both users as having an active unlock request so login restore works correctly
      await Promise.all([
        setUserActiveUnlock(userId, data.id),
        setUserActiveUnlock(currentPartnerId, data.id),
      ]);
      setActiveUnlockRequest(mapUnlockRequest(data));
    } catch (err) {
      console.error('[App] Could not create unlock request:', err);
      setVerifyError('Could not start the shared unlock request.');
    } finally {
      setUnlockActionPending(false);
    }
  }, [userId]);

  const acceptSharedUnlockRequest = useCallback(async () => {
    const request = activeUnlockRequestRef.current;
    if (!request || request.kind !== 'shared' || request.status !== 'pending_partner') return;
    if (unlockActionPendingRef.current) return;
    setVerifyError('');
    setActiveTab('us');
    setUnlockActionPending(true);
    try {
      const countdownStartedAt = new Date().toISOString();
      const { data, error } = await supabase.from('unlock_requests').update({
        status: 'countdown',
        countdown_started_at: countdownStartedAt,
      }).eq('id', request.id).select().single();
      if (error) throw error;
      setActiveUnlockRequest(mapUnlockRequest(data));
    } catch (err) {
      console.error('[App] Could not accept unlock request:', err);
      setVerifyError('Could not accept the unlocking request.');
    } finally {
      setUnlockActionPending(false);
    }
  }, []);

  // ── Decline: marks DB status=declined, then dismisses locally after a beat
  const declineUnlockRequest = useCallback(async () => {
    const request = activeUnlockRequestRef.current;
    if (!request) { dismissUnlockOverlay(); return; }

    // Private unlocks are local-only — just dismiss
    if (request.kind === 'private') { dismissUnlockOverlay(); return; }

    console.log('[Unlock] Declining request:', request.id);
    setUnlockActionPending(true);
    try {
      await supabase.from('unlock_requests')
        .update({ status: 'declined' })
        .eq('id', request.id);
      // Clear the active pointer on both users so login restore won't resurface this
      await Promise.all([
        setUserActiveUnlock(request.requesterId, null),
        setUserActiveUnlock(request.partnerId, null),
      ]);
      // Show declined state — user must close manually
      setActiveUnlockRequest((cur) => cur?.id === request.id ? { ...cur, status: 'declined' } : cur);
      setUnlockStatus(UNLOCK_STATUS.DECLINED);
    } catch (err) {
      console.error('[Unlock] Decline failed:', err);
      // Still show declined state rather than silently closing
      setUnlockStatus(UNLOCK_STATUS.DECLINED);
    } finally {
      setUnlockActionPending(false);
    }
  }, [dismissUnlockOverlay]);

  const recordUnlockAgreement = useCallback(async () => {
    const request = activeUnlockRequestRef.current;
    if (!request || unlockActionPendingRef.current || isUnlockRequestComplete(request)) return;
    if (request.status === 'pending_partner') return;
    if (request.status === 'declined') return;

    const countdownRemaining = request.status === 'countdown'
      ? getCountdownRemaining(request.countdownStartedAt, Date.now())
      : 0;
    if (countdownRemaining > 0) return;

    setVerifyError('');
    setUnlockStatus(null);
    setUnlockActionPending(true);

    try {
      // Private unlock is fully handled in startPrivateUnlockFlow
      if (request.kind === 'private') { setUnlockActionPending(false); return; }

      const isRequester = request.requesterId === userId;
      const alreadyRecorded = isRequester ? request.requesterAudioUrl : request.partnerAudioUrl;
      if (alreadyRecorded) { setUnlockActionPending(false); return; }

      // Stamp recording_started_at BEFORE mic opens so server can compare simultaneity
      const recordingStartedAt = new Date().toISOString();
      const role = isRequester ? 'requester' : 'partner';
      await supabase.from('unlock_requests').update(
        isRequester
          ? { requester_recording_started_at: recordingStartedAt, status: 'recording' }
          : { partner_recording_started_at: recordingStartedAt, status: 'recording' }
      ).eq('id', request.id);

      console.log(`[Unlock:shared] Recording started at ${recordingStartedAt}`);
      setUnlockStatus(UNLOCK_STATUS.RECORDING);

      let audioBlob, detected;
      try {
        ({ blob: audioBlob, detected } = await recordUntilIAgree());
      } catch (micErr) {
        setVerifyError(micErr.message || 'Microphone access denied.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        setUnlockActionPending(false);
        return;
      }
      if (!detected) {
        setVerifyError('No "I agree" detected. Please say it clearly and try again.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        setUnlockActionPending(false);
        await supabase.from('unlock_requests').update({ status: 'verification_failed' }).eq('id', request.id);
        return;
      }
      if (!audioBlob || audioBlob.size === 0) {
        setVerifyError('No audio captured. Please try again.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        setUnlockActionPending(false);
        return;
      }

      const ext = audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
      const storagePath = `${request.id}_${role}.${ext}`;
      console.log(`[Unlock:shared] Uploading to i-agree/${storagePath}...`);
      setUnlockStatus(UNLOCK_STATUS.UPLOADING);

      const { error: upErr } = await supabase.storage
        .from('i-agree')
        .upload(storagePath, audioBlob, { contentType: audioBlob.type, upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const audioUrl = supabase.storage.from('i-agree').getPublicUrl(storagePath).data.publicUrl;
      const now = new Date().toISOString();
      const audioPayload = isRequester
        ? { requester_audio_url: audioUrl, requester_agreed_at: now }
        : { partner_audio_url: audioUrl, partner_agreed_at: now };

      const { data: updated, error: updateErr } = await supabase
        .from('unlock_requests').update(audioPayload).eq('id', request.id).select().single();
      if (updateErr) throw updateErr;
      setActiveUnlockRequest(mapUnlockRequest(updated));

      const bothReady = !!(updated.requester_audio_url && updated.partner_audio_url);

      if (!bothReady) {
        // Uploaded first — update DB status to waiting and hold
        await supabase.from('unlock_requests')
          .update({ status: 'waiting_partner' })
          .eq('id', request.id);
        setUnlockStatus(UNLOCK_STATUS.WAITING_PARTNER);
      } else {
        // Both audio files are present — whoever uploaded last drives verification
        // First update DB status so both users see "verifying" via realtime
        await supabase.from('unlock_requests')
          .update({ status: 'verifying' })
          .eq('id', request.id);

        console.log(`[Unlock:shared] Both ready — ${role} calling /verify-shared-unlock...`);
        setUnlockStatus(UNLOCK_STATUS.VERIFYING);

        let resp, verifyData;
        try {
          resp = await fetch(`${BACKEND_URL}/verify-shared-unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: request.id }),
          });
          verifyData = await resp.json();
        } catch (fetchErr) {
          setVerifyError('Could not reach the server.');
          setUnlockStatus(UNLOCK_STATUS.ERROR);
          setUnlockActionPending(false);
          return;
        }

        if (!verifyData.success) {
          const msg = verifyData.error || 'Shared voice verification failed.';
          setVerifyError(msg);
          setUnlockStatus(UNLOCK_STATUS.ERROR);
          // DB is updated to verification_failed by the server via _mark_verification_failed
        } else {
          // Immediately flip local status — realtime will sync the other user
          const unlockedAt = new Date().toISOString();
          setActiveUnlockRequest((cur) => {
            if (!cur || cur.id !== request.id) return cur;
            return { ...cur, status: 'unlocked', unlockedAt };
          });
          setUnlockStatus(null);
        }
      }
    } catch (err) {
      setVerifyError(typeof err?.message === 'string' ? err.message : 'Verification failed.');
      setUnlockStatus(UNLOCK_STATUS.ERROR);
    } finally {
      setUnlockActionPending(false);
    }
  }, [userId]);

  // ── Data load + realtime subscriptions ──────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const syncUnlockRequest = (row) => {
      if (row?.requester_id !== userId && row?.partner_id !== userId) return;
      const mapped = mapUnlockRequest(row);

      // Terminal: declined — show declined state, user must close manually
      if (mapped.status === 'declined') {
        setActiveUnlockRequest((cur) => cur?.id === mapped.id ? { ...cur, status: 'declined' } : cur);
        setUnlockStatus(UNLOCK_STATUS.DECLINED);
        return;
      }

      // Terminal: verification_failed
      if (mapped.status === 'verification_failed') {
        setActiveUnlockRequest((cur) => cur?.id === mapped.id ? { ...cur, status: 'verification_failed' } : cur);
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        setVerifyError('Voice verification failed. Please try again.');
        return;
      }

      // Terminal: unlocked — partner receives this via realtime after requester verifies
      if (mapped.status === 'unlocked') {
        setActiveUnlockRequest((cur) => cur?.id === mapped.id ? { ...cur, status: 'unlocked' } : cur);
        setUnlockStatus(null); // let completedUnlockId effect handle markUnlocked
        return;
      }

      // In-progress: waiting_partner — this user uploaded first, waiting for the other
      if (mapped.status === 'waiting_partner') {
        setActiveUnlockRequest((cur) => cur?.id === mapped.id ? { ...cur, status: 'waiting_partner' } : cur);
        setUnlockStatus(UNLOCK_STATUS.WAITING_PARTNER);
        return;
      }

      // In-progress: verifying — both uploaded, the other user is running verification
      if (mapped.status === 'verifying') {
        setActiveUnlockRequest((cur) => cur?.id === mapped.id ? { ...cur, status: 'verifying' } : cur);
        setUnlockStatus(UNLOCK_STATUS.VERIFYING);
        return;
      }

      if (!isUnlockRequestRelevant(mapped)) {
        setActiveUnlockRequest((current) => current?.id === mapped.id ? null : current);
        return;
      }
      setActiveTab('us');
      setActiveUnlockRequest(mapped);
    };

    (async () => {
      const [{ data: priv }, { data: shared }, { data: invites }, { data: userData }] = await Promise.all([
        supabase.from('messages').select('*').eq('type', 'private').or(`sender.eq.${userId},recipient.eq.${userId}`).order('timestamp', { ascending: false }),
        supabase.from('messages').select('*').eq('type', 'shared').order('timestamp', { ascending: false }),
        supabase.from('invitations').select('*').eq('to', userId).eq('status', 'pending'),
        supabase.from('users').select('active_unlock_request_id').eq('id', userId).single(),
      ]);

      setPrivateMessages((priv ?? []).map(mapMessage));
      setSharedMessages((shared ?? []).map(mapMessage));
      setPendingInvitations((invites ?? []).map(mapInvitation));

      // Only restore an unlock overlay if the users row has an explicit active request ID.
      // This is set when a request is created/accepted and cleared on resolve/decline —
      // so stale rows from past sessions will never re-surface here.
      const activeId = userData?.active_unlock_request_id;
      if (activeId) {
        const { data: unlockRow, error: unlockErr } = await supabase
          .from('unlock_requests').select('*').eq('id', activeId).single();
        if (!unlockErr && unlockRow) {
          const mapped = mapUnlockRequest(unlockRow);
          if (isUnlockRequestActive(mapped)) {
            console.log('[App] Restoring active unlock request from users row:', activeId);
            setActiveTab('us');
            setActiveUnlockRequest(mapped);
          } else {
            // Row exists but is no longer active (e.g. timed out) — clean up the pointer
            console.log('[App] Stale active_unlock_request_id found, clearing it.');
            await setUserActiveUnlock(userId, null);
          }
        } else {
          // Row was deleted — clean up the pointer
          await setUserActiveUnlock(userId, null);
        }
      }
    })();

    // Two filters needed: one for messages I sent, one for messages sent to me
    const privateMessagesChannel = supabase
      .channel('private-messages-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender=eq.${userId}` }, (payload) => {
        const msg = payload.new;
        if (msg.type !== 'private') return;
        setPrivateMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [mapMessage(msg), ...prev]);
      })
      .subscribe();

    const privateMessagesReceivedChannel = supabase
      .channel('private-messages-received-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient=eq.${userId}` }, (payload) => {
        const msg = payload.new;
        if (msg.type !== 'private') return;
        setPrivateMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [mapMessage(msg), ...prev]);
      })
      .subscribe();

    const sharedMessagesChannel = supabase
      .channel('shared-messages-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new;
        if (msg.type !== 'shared') return;
        const mapped = mapMessage(msg); // mapMessage normalises participants to an array
        if (!mapped.participants.includes(userIdRef.current)) return;
        setSharedMessages((prev) => prev.some((m) => m.id === mapped.id) ? prev : [mapped, ...prev]);
      })
      .subscribe();

    const invitationChannel = supabase
      .channel('invitations-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invitations' }, (payload) => {
        const inv = payload.new;
        if (inv?.to === userId) setPendingInvitations((prev) => [...prev, mapInvitation(inv)]);
      })
      .subscribe();

    const unlockChannel = supabase
      .channel('unlock-requests-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unlock_requests' }, (payload) => {
        syncUnlockRequest(payload.new ?? payload.old);
      })
      .subscribe();

    const usersChannel = supabase
      .channel('users-paired-with')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userId}` }, (payload) => {
        const user = payload.new;
        if (user.paired_with && user.paired_with !== partnerIdRef.current) setPartnerId(user.paired_with);
      })
      .subscribe();

    return () => {
      privateMessagesChannel.unsubscribe();
      privateMessagesReceivedChannel.unsubscribe();
      sharedMessagesChannel.unsubscribe();
      invitationChannel.unsubscribe();
      unlockChannel.unsubscribe();
      usersChannel.unsubscribe();
    };
  }, [userId, dismissUnlockOverlay]);

  const isUnlocked = isPrivateUnlocked || isSharedUnlocked;

  useEffect(() => {
    if (!isUnlocked) return;
    const tick = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, Math.ceil((60000 - elapsed) / 1000));
      setLockCountdown(remaining);
      if (elapsed > 60000) { setIsPrivateUnlocked(false); setIsSharedUnlocked(false); setLockCountdown(0); }
    }, 1000);
    return () => clearInterval(tick);
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;
    const handleActivity = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
    };
  }, [isUnlocked]);

  // Tracks whether we've already auto-fired recording for a given request,
  // so the 250ms tick doesn't trigger it multiple times.
  const autoRecordFiredRef = useRef(null);

  useEffect(() => {
    if (!activeUnlockRequest) return;
    setUnlockNow(Date.now());
    const timer = setInterval(() => setUnlockNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [activeUnlockRequest?.id, activeUnlockRequest?.status, activeUnlockRequest?.countdownStartedAt]);

  // Auto-trigger recording when shared countdown hits 0
  useEffect(() => {
    if (!activeUnlockRequest) return;
    if (activeUnlockRequest.kind !== 'shared') return;
    if (activeUnlockRequest.status !== 'countdown') return;
    if (unlockActionPendingRef.current) return;
    const remaining = getCountdownRemaining(activeUnlockRequest.countdownStartedAt, unlockNow);
    if (remaining > 0) return;
    if (autoRecordFiredRef.current === activeUnlockRequest.id) return; // already fired
    autoRecordFiredRef.current = activeUnlockRequest.id;
    console.log('[Unlock:shared] Countdown hit 0 — auto-starting recording');
    recordUnlockAgreement();
  }, [unlockNow, activeUnlockRequest, recordUnlockAgreement]);

  const completedUnlockId = activeUnlockRequest && isUnlockRequestComplete(activeUnlockRequest)
    ? activeUnlockRequest.id : null;

  useEffect(() => {
    if (!completedUnlockId) return;
    const req = activeUnlockRequest;
    markUnlocked(req?.kind === 'shared' ? 'shared' : 'private');
    // Clear the pointer on both users — request is resolved
    if (req?.kind === 'shared') {
      Promise.all([
        setUserActiveUnlock(req.requesterId, null),
        setUserActiveUnlock(req.partnerId, null),
      ]);
    } else if (req?.kind === 'private') {
      setUserActiveUnlock(userId, null);
    }
    // Overlay stays open — user closes it manually via the Close button
  }, [completedUnlockId, markUnlocked, userId]);

  const sendInvitation = useCallback(async (toId) => {
    const { error } = await supabase.from('invitations').insert({
      from: userId, to: toId, status: 'pending', created_at: new Date().toISOString(),
    });
    if (error) throw error;
  }, [userId]);

  const acceptInvitation = useCallback(async (inv) => {
    await supabase.from('invitations').update({ status: 'accepted' }).eq('id', inv.id);
    const partner = inv.from;
    await Promise.all([
      supabase.from('users').update({ paired_with: partner }).eq('id', userId),
      supabase.from('users').update({ paired_with: userId }).eq('id', partner),
    ]);
    setPartnerId(partner);
  }, [userId]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const handle = async ({ detail: cmd }) => {
      lastActivityRef.current = Date.now();
      const currentUnlockRequest = activeUnlockRequestRef.current;
      if (currentUnlockRequest && !isUnlockRequestComplete(currentUnlockRequest)) {
        if (cmd === 'i agree') await recordUnlockAgreement();
        return;
      }
      if (cmd === 'record me') beginRecording('private');
      else if (cmd === 'record for us') beginRecording('shared');
      else if (cmd === 'listen to me') startPrivateUnlockFlow();
      else if (cmd === 'listen to us') await startSharedUnlockFlow();
      else if (cmd === 'stop recording') handleStopRecording();
      else if (cmd === 'i agree') {
        const invites = pendingInvitationsRef.current;
        if (invites.length === 0) return;
        setVerifying(true);
        try {
          const confirmed = await checkVoiceCommand('I agree');
          if (confirmed) acceptInvitation(invites[0]);
        } finally {
          setVerifying(false);
        }
      }
    };
    window.addEventListener('voiceCommand', handle);
    return () => window.removeEventListener('voiceCommand', handle);
  }, [isLoggedIn, beginRecording, acceptInvitation, handleStopRecording, recordUnlockAgreement, startPrivateUnlockFlow, startSharedUnlockFlow]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem('userId');
    setUserId(''); setIsLoggedIn(false); setPartnerId(null);
    setPrivateMessages([]); setSharedMessages([]); setPendingInvitations([]);
    setIsPrivateUnlocked(false); setIsSharedUnlocked(false); setLockCountdown(0); setRecordingState('idle');
    setVerifyError(''); setActiveUnlockRequest(null); setUnlockActionPending(false);
    setUnlockStatus(null);
  };

  if (!sessionChecked) return null;
  if (!isLoggedIn) {
    return <LoginScreen onLogin={(id) => {
      sessionStorage.setItem('userId', id);
      setUserId(id);
      setIsLoggedIn(true);
    }} />;
  }

  const meMessages = privateMessages;
  const usMessages = sharedMessages.filter((msg) => msg.participants.includes(userId));
  const emptyHint = activeTab === 'me'
    ? 'Say "record me" to record a private message'
    : 'Say "record for us" to share a message';
  const unlockCountdownRemaining = activeUnlockRequest?.status === 'countdown'
    ? getCountdownRemaining(activeUnlockRequest.countdownStartedAt, unlockNow)
    : 0;

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center pt-8 pb-8 px-4">
      <div className="relative w-[480px] h-[85vh] max-h-[900px] max-w-sm bg-[#0d1117] text-[#f0f6fc] flex flex-col font-sans rounded-2xl border border-[#21273a] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#21273a] bg-[#0d1117]">
          <span className="text-[13px] font-bold tracking-tight text-[#f0f6fc]">We Listen</span>
          <button onClick={handleLogout} className="cursor-pointer text-[10px] text-[#4b5368] hover:text-[#ef4444] font-semibold transition-colors">
            Log out
          </button>
        </div>

        <TabBar activeTab={activeTab} setActiveTab={setActiveTab} partnerId={partnerId} userId={userId} />

        <div className="flex-1 overflow-y-auto min-h-[400px]">
          {activeTab === 'me' && (
            <div className="px-3 py-3 space-y-2 overflow-y-auto">
              {meMessages.length === 0 && pendingInvitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center gap-2 select-none">
                  <span className="text-3xl opacity-20">🔒</span>
                  <p className="text-[12px] text-[#3a4155] max-w-[200px] leading-relaxed">{emptyHint}</p>
                </div>
              ) : (
                meMessages.map((msg) => <VoiceMessageCard key={msg.id} message={msg} isUnlocked={isPrivateUnlocked} />)
              )}
            </div>
          )}

          {activeTab === 'us' && (
            partnerId ? (
              <div className="px-3 py-3 space-y-2 overflow-y-auto h-48 scrollbar-thin scrollbar-thumb-[#21273a] scrollbar-track-[#0d1117]">
                {usMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center gap-2 select-none">
                    <span className="text-3xl opacity-20">🔒</span>
                    <p className="text-[12px] text-[#3a4155] max-w-[200px] leading-relaxed">{emptyHint}</p>
                    <div className="mt-4 text-[12px] text-[#10b981] font-semibold">
                      Paired with <span className="font-mono">{partnerId}</span>
                    </div>
                  </div>
                ) : (
                  usMessages.map((msg) => <VoiceMessageCard key={msg.id} message={msg} isUnlocked={isSharedUnlocked} />)
                )}
              </div>
            ) : pendingInvitations.length === 0 ? (
              <PairingScreen userId={userId} onSendInvite={sendInvitation} />
            ) : (
              <div className="px-3 py-3 space-y-2 overflow-y-auto h-48 scrollbar-thin scrollbar-thumb-[#21273a] scrollbar-track-[#0d1117]">
                {pendingInvitations.map((inv) => (
                  <div key={inv.id} className="rounded-xl bg-[#1c2030] border border-[#7c3aed]/30 px-4 py-3">
                    <p className="text-[12px] text-[#b8c0d8] font-semibold">
                      Pairing request from <span className="text-[#7c3aed]">{inv.from}</span>
                    </p>
                    <p className="text-[11px] text-[#4b5368] mt-0.5">
                      Say <span className="italic text-[#8892a4]">"I agree"</span> to accept
                    </p>
                    <button onClick={() => acceptInvitation(inv)}
                      className="mt-2 px-3 py-1.5 rounded-lg bg-[#7c3aed]/20 border border-[#7c3aed]/40 text-[11px] text-[#7c3aed] font-semibold hover:bg-[#7c3aed]/30 transition-all">
                      Accept
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        <div className="h-fit w-full">
          <ActionBar
            recordingState={recordingState}
            isUnlocked={isUnlocked}
            lockCountdown={lockCountdown}
            isHearing={isHearing}
            verifying={verifying}
            verifyError={verifyError}
            onStopRecording={handleStopRecording}
            onStartRecording={beginRecording}
            activeTab={activeTab}
            partnerId={partnerId}
          />
          <DebugPanel />
        </div>
      </div>

      {activeUnlockRequest && (
        <UnlockConsentOverlay
          request={activeUnlockRequest}
          currentUserId={userId}
          countdownRemaining={unlockCountdownRemaining}
          isSubmitting={unlockActionPending}
          unlockStatus={unlockStatus}
          verifyError={verifyError}
          onAcceptSharedRequest={acceptSharedUnlockRequest}
          onVerifyMe={recordUnlockAgreement}
          onDecline={declineUnlockRequest}
          onDismiss={dismissUnlockOverlay}
          onDismissError={() => { setVerifyError(''); setUnlockStatus(null); }}
        />
      )}
    </div>
  );
}