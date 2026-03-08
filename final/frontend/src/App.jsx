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
  timestamp: row.timestamp,
  transcription: row.transcription,
  duration: row.duration ?? 0,
  data: row.data ?? '',
});

const mapInvitation = (row) => ({
  id: row.id,
  from: row.from,
  to: row.to,
  status: row.status,
});

const mapUnlockRequest = (row) => ({
  id: row.id,
  kind: 'shared',
  requesterId: row.requester_id,
  partnerId: row.partner_id,
  status: row.status,
  countdownStartedAt: row.countdown_started_at,
  requesterAgreedAt: row.requester_agreed_at,
  partnerAgreedAt: row.partner_agreed_at,
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
  if (request.kind === 'private') return request.status === 'unlocked' || !!request.requesterAgreedAt;
  return request.status === 'unlocked' || (!!request.requesterAgreedAt && !!request.partnerAgreedAt);
};

const isUnlockRequestCurrent = (request, now = Date.now()) => {
  if (!request?.createdAt) return false;
  return now - new Date(request.createdAt).getTime() <= UNLOCK_REQUEST_TTL_MS;
};

const isUnlockRequestRelevant = (request, now = Date.now()) => {
  if (!request || !isUnlockRequestCurrent(request, now)) return false;
  if (isUnlockRequestComplete(request)) return true;
  if (request.status === 'declined') return true; // show declined state briefly
  return request.status === 'pending_partner' || request.status === 'countdown';
};

const isUnlockRequestActive = (request, now = Date.now()) => {
  if (!request || !isUnlockRequestCurrent(request, now) || isUnlockRequestComplete(request)) return false;
  return request.status === 'pending_partner' || request.status === 'countdown';
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

const recordShortClip = () => new Promise(async (resolve, reject) => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    reject(new Error('Microphone access denied: ' + err.message));
    return;
  }
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
  recorder.onerror = (e) => {
    stream.getTracks().forEach(t => t.stop());
    reject(new Error('MediaRecorder error: ' + e.error?.message));
  };
  recorder.start();
  console.log('[recordShortClip] Started, mimeType:', mimeType || 'browser default');
  await new Promise(r => setTimeout(r, 2500));
  recorder.stop();
  await new Promise(r => { recorder.onstop = r; });
  stream.getTracks().forEach(t => t.stop());
  const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
  console.log('[recordShortClip] Done. Blob:', blob.size, 'bytes');
  resolve(blob);
});

export default function App() {
  const [userId, setUserId] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('me');
  const [recordingState, setRecordingState] = useState('idle');
  const [privateMessages, setPrivateMessages] = useState([]);
  const [sharedMessages, setSharedMessages] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [partnerId, setPartnerId] = useState(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
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

  useEffect(() => { partnerIdRef.current = partnerId; }, [partnerId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { pendingInvitationsRef.current = pendingInvitations; }, [pendingInvitations]);
  useEffect(() => { activeUnlockRequestRef.current = activeUnlockRequest; }, [activeUnlockRequest]);
  useEffect(() => { unlockActionPendingRef.current = unlockActionPending; }, [unlockActionPending]);

  useEffect(() => {
    const forceLockHandler = () => { setIsUnlocked(false); setLockCountdown(0); };
    window.addEventListener('forceLock', forceLockHandler);
    return () => window.removeEventListener('forceLock', forceLockHandler);
  }, []);

  const onSpeechStart = useCallback(() => setIsHearing(true), []);
  const onSpeechEnd = useCallback(() => setIsHearing(false), []);

  useVoiceRecognition({
    enabled: isLoggedIn && !verifying && !isUnlocked,
    onSpeechStart,
    onSpeechEnd,
  });

  useEffect(() => {
    if (!userId) return;
    supabase.from('users').select('paired_with').eq('id', userId).single().then(({ data, error }) => {
      if (!error && data?.paired_with) setPartnerId(data.paired_with);
    });
  }, [userId]);

  const markUnlocked = useCallback(() => {
    setRecordingState('matched');
    setIsUnlocked(true);
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
    if (recordingState === 'recording') return;
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
    setRecordingState('idle');

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

    if (!inserted) return;
    const mapped = mapMessage(inserted);
    if (meta.type === 'private') {
      setPrivateMessages((prev) => prev.some((m) => m.id === mapped.id) ? prev : [mapped, ...prev]);
    } else {
      setSharedMessages((prev) => prev.some((m) => m.id === mapped.id) ? prev : [mapped, ...prev]);
    }
  }, [stopAndUpload]);

  const startPrivateUnlockFlow = useCallback(async () => {
    if (activeUnlockRequestRef.current && !isUnlockRequestComplete(activeUnlockRequestRef.current)) {
      setVerifyError('Finish the current unlock prompt first.');
      return;
    }
    setVerifyError('');
    setActiveTab('me');
    const request = buildPrivateUnlockRequest({ userId });
    setActiveUnlockRequest(request);
    try {
      pendingRecordRef.current = { sender: userId, recipient: userId, type: 'private' };
      await startRecording();
      setRecordingState('recording');
    } catch (err) {
      console.error('[Unlock] Failed to start recording:', err);
      setVerifyError('Microphone could not start.');
    }
  }, [userId, startRecording]);

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
        status: 'pending_partner',
        created_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
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
      // Show declined state briefly on this side, then dismiss
      setActiveUnlockRequest((cur) => cur?.id === request.id ? { ...cur, status: 'declined' } : cur);
      setUnlockStatus(UNLOCK_STATUS.DECLINED);
      window.setTimeout(dismissUnlockOverlay, 2000);
    } catch (err) {
      console.error('[Unlock] Decline failed:', err);
      dismissUnlockOverlay();
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

    const now = new Date().toISOString();
    setVerifyError('');
    setUnlockStatus(null);
    setUnlockActionPending(true);

    try {
      if (request.kind === 'private') {
        console.log('[Unlock:private] Capturing "I agree" recording...');
        setUnlockStatus(UNLOCK_STATUS.RECORDING);
        const result = await stopAndUpload('private', { upload: false, transcribe: false });
        if (!result?.blob) {
          setVerifyError('Recording failed — no audio captured. Please try again.');
          setUnlockStatus(UNLOCK_STATUS.ERROR);
          setUnlockActionPending(false);
          return;
        }
        setUnlockStatus(UNLOCK_STATUS.VERIFYING);
        const formData = new FormData();
        formData.append('audio', result.blob, 'audio.webm');
        formData.append('user_id', userId);
        let resp, data;
        try {
          resp = await fetch(`${BACKEND_URL}/verify-me`, { method: 'POST', body: formData });
          data = await resp.json();
        } catch (fetchErr) {
          setVerifyError('Could not reach the server. Check your connection.');
          setUnlockStatus(UNLOCK_STATUS.ERROR);
          setUnlockActionPending(false);
          return;
        }
        console.log('[Unlock:private] /verify-me response:', data);
        if (data.error || !data.success) {
          setVerifyError(data.error || 'Voice verification failed.');
          setUnlockStatus(UNLOCK_STATUS.ERROR);
          setUnlockActionPending(false);
          return;
        }
        setUnlockStatus(null);
        setActiveUnlockRequest((current) => {
          if (!current || current.id !== request.id) return current;
          return { ...current, requesterAgreedAt: now, status: 'unlocked', unlockedAt: now };
        });
        setUnlockActionPending(false);
        return;
      }

      const isRequester = request.requesterId === userId;
      const alreadyAgreed = isRequester ? request.requesterAgreedAt : request.partnerAgreedAt;
      if (alreadyAgreed) { setUnlockActionPending(false); return; }

      console.log('[Unlock:shared] Recording "I agree"...');
      setUnlockStatus(UNLOCK_STATUS.RECORDING);
      let audioBlob;
      try {
        audioBlob = await recordShortClip();
      } catch (micErr) {
        setVerifyError(micErr.message || 'Microphone access denied.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        setUnlockActionPending(false);
        return;
      }
      if (!audioBlob || audioBlob.size === 0) {
        setVerifyError('No audio captured. Please try again.');
        setUnlockStatus(UNLOCK_STATUS.ERROR);
        setUnlockActionPending(false);
        return;
      }

      const role = isRequester ? 'requester' : 'partner';
      const ext = audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
      const storagePath = `${request.id}_${role}.${ext}`;
      console.log(`[Unlock:shared] Uploading to i-agree/${storagePath}...`);
      setUnlockStatus(UNLOCK_STATUS.UPLOADING);

      const { error: upErr } = await supabase.storage
        .from('i-agree')
        .upload(storagePath, audioBlob, { contentType: audioBlob.type, upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const audioUrl = supabase.storage.from('i-agree').getPublicUrl(storagePath).data.publicUrl;
      const payload = isRequester
        ? { requester_audio_url: audioUrl, requester_agreed_at: now }
        : { partner_audio_url: audioUrl, partner_agreed_at: now };

      const { data: updated, error: updateErr } = await supabase
        .from('unlock_requests').update(payload).eq('id', request.id).select().single();
      if (updateErr) throw updateErr;
      setActiveUnlockRequest(mapUnlockRequest(updated));

      if (updated.requester_audio_url && updated.partner_audio_url) {
        console.log('[Unlock:shared] Both ready — calling /verify-shared-unlock...');
        setUnlockStatus(UNLOCK_STATUS.VERIFYING);
        let resp, data;
        try {
          resp = await fetch(`${BACKEND_URL}/verify-shared-unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: request.id }),
          });
          data = await resp.json();
        } catch (fetchErr) {
          setVerifyError('Could not reach the server.');
          setUnlockStatus(UNLOCK_STATUS.ERROR);
          setUnlockActionPending(false);
          return;
        }
        if (!data.success) {
          setVerifyError(data.error || 'Shared voice verification failed.');
          setUnlockStatus(UNLOCK_STATUS.ERROR);
        } else {
          setUnlockStatus(null);
        }
      } else {
        setUnlockStatus(UNLOCK_STATUS.WAITING_PARTNER);
      }
    } catch (err) {
      setVerifyError(typeof err?.message === 'string' ? err.message : 'Verification failed.');
      setUnlockStatus(UNLOCK_STATUS.ERROR);
    } finally {
      setUnlockActionPending(false);
    }
  }, [userId, stopAndUpload]);

  // ── Data load + realtime subscriptions ──────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const syncUnlockRequest = (row) => {
      if (row?.requester_id !== userId && row?.partner_id !== userId) return;
      const mapped = mapUnlockRequest(row);

      // Someone declined — show the declined state, then auto-dismiss after 2s
      if (mapped.status === 'declined') {
        setActiveUnlockRequest((cur) => cur?.id === mapped.id ? { ...cur, status: 'declined' } : cur);
        setUnlockStatus(UNLOCK_STATUS.DECLINED);
        window.setTimeout(dismissUnlockOverlay, 2500);
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
      const [{ data: priv }, { data: shared }, { data: invites }, unlockResult] = await Promise.all([
        supabase.from('messages').select('*').eq('sender', userId).eq('type', 'private').order('timestamp', { ascending: false }),
        supabase.from('messages').select('*').contains('participants', [userId]).order('timestamp', { ascending: false }),
        supabase.from('invitations').select('*').eq('to', userId).eq('status', 'pending'),
        supabase.from('unlock_requests').select('*')
          .or(`requester_id.eq.${userId},partner_id.eq.${userId}`)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      setPrivateMessages((priv ?? []).map(mapMessage));
      setSharedMessages((shared ?? []).map(mapMessage));
      setPendingInvitations((invites ?? []).map(mapInvitation));

      if (unlockResult.error) {
        console.error('[App] Could not load unlock requests:', unlockResult.error);
      } else {
        const latestUnlock = (unlockResult.data ?? []).map(mapUnlockRequest).find(isUnlockRequestActive);
        if (latestUnlock) { setActiveTab('us'); setActiveUnlockRequest(latestUnlock); }
      }
    })();

    const privateMessagesChannel = supabase
      .channel('private-messages-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender=eq.${userId}` }, (payload) => {
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
        const participants = msg.participants ?? [];
        if (!participants.includes(userIdRef.current)) return;
        setSharedMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [mapMessage(msg), ...prev]);
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
      sharedMessagesChannel.unsubscribe();
      invitationChannel.unsubscribe();
      unlockChannel.unsubscribe();
      usersChannel.unsubscribe();
    };
  }, [userId, dismissUnlockOverlay]);

  useEffect(() => {
    if (!isUnlocked) return;
    const tick = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, Math.ceil((60000 - elapsed) / 1000));
      setLockCountdown(remaining);
      if (elapsed > 60000) { setIsUnlocked(false); setLockCountdown(0); }
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

  useEffect(() => {
    if (!activeUnlockRequest) return;
    setUnlockNow(Date.now());
    const timer = setInterval(() => setUnlockNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [activeUnlockRequest?.id, activeUnlockRequest?.status, activeUnlockRequest?.countdownStartedAt]);

  const completedUnlockId = activeUnlockRequest && isUnlockRequestComplete(activeUnlockRequest)
    ? activeUnlockRequest.id : null;

  useEffect(() => {
    if (!completedUnlockId) return;
    markUnlocked();
    const timer = window.setTimeout(() => {
      setActiveUnlockRequest((current) => current?.id === completedUnlockId ? null : current);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [completedUnlockId, markUnlocked]);

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
    setUserId(''); setIsLoggedIn(false); setPartnerId(null);
    setPrivateMessages([]); setSharedMessages([]); setPendingInvitations([]);
    setIsUnlocked(false); setLockCountdown(0); setRecordingState('idle');
    setVerifyError(''); setActiveUnlockRequest(null); setUnlockActionPending(false);
    setUnlockStatus(null);
  };

  if (!isLoggedIn) {
    return <LoginScreen onLogin={(id) => { setUserId(id); setIsLoggedIn(true); }} />;
  }

  const meMessages = privateMessages;
  const usMessages = sharedMessages;
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
                meMessages.map((msg) => <VoiceMessageCard key={msg.id} message={msg} isUnlocked={isUnlocked} />)
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
                  usMessages.map((msg) => <VoiceMessageCard key={msg.id} message={msg} isUnlocked={isUnlocked} />)
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
          onDismissError={() => { setVerifyError(''); setUnlockStatus(null); }}
        />
      )}
    </div>
  );
}