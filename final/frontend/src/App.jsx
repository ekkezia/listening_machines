import { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';
import { supabase } from './supabase';
import LoginScreen from './components/LoginScreen';
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

const UNLOCK_COUNTDOWN_SECONDS = 3;
const UNLOCK_REQUEST_TTL_MS = 5 * 60 * 1000;

const mapMessage = (row) => ({
  id: row.id,
  sender: row.sender,
  recipient: row.recipient,
  type: row.type,
  participants: row.participants,
  data: row.data,
  mimeType: row.mime_type,
  duration: row.duration,
  timestamp: row.timestamp,
  transcription: row.transcription,
});

const mapInvitation = (row) => ({
  id: row.id,
  from: row.from,
  fromName: row.from_name,
  to: row.to,
  status: row.status,
});

const mapUnlockRequest = (row) => ({
  id: row.id,
  kind: 'shared',
  requesterId: row.requester_id,
  requesterName: row.requester_name,
  partnerId: row.partner_id,
  status: row.status,
  countdownStartedAt: row.countdown_started_at,
  requesterAgreedAt: row.requester_agreed_at,
  partnerAgreedAt: row.partner_agreed_at,
  createdAt: row.created_at,
  unlockedAt: row.unlocked_at,
});

const buildPrivateUnlockRequest = ({ userId, userName }) => {
  const now = new Date().toISOString();
  return {
    id: `private-${now}`,
    kind: 'private',
    requesterId: userId,
    requesterName: userName,
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
  return request.status === 'pending_partner' || request.status === 'countdown';
};

const isUnlockRequestActive = (request, now = Date.now()) => {
  if (!request || !isUnlockRequestCurrent(request, now) || isUnlockRequestComplete(request)) return false;
  return request.status === 'pending_partner' || request.status === 'countdown';
};

const saveMessage = async (data) => {
  try {
    const { error } = await supabase.from('messages').insert({
      sender: data.sender,
      recipient: data.recipient ?? null,
      type: data.type,
      participants: data.participants ?? null,
      data: data.data ?? null,
      mime_type: data.mimeType ?? null,
      duration: data.duration ?? 0,
      timestamp: new Date().toISOString(),
      transcription: data.transcription ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[App] Supabase write error:', err);
  }
};

export default function App() {
    // Handle force lock event
    useEffect(() => {
      const forceLockHandler = () => {
        setIsUnlocked(false);
        setLockCountdown(0);
      };
      window.addEventListener('forceLock', forceLockHandler);
      return () => window.removeEventListener('forceLock', forceLockHandler);
    }, []);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('me');
  const [recordingState, setRecordingState] = useState('idle');
  const [privateMessages, setPrivateMessages] = useState([]);
  const [sharedMessages, setSharedMessages] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [partnerId, setPartnerId] = useState(null);
  const [partnerName, setPartnerName] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [isHearing, setIsHearing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [activeUnlockRequest, setActiveUnlockRequest] = useState(null);
  const [unlockActionPending, setUnlockActionPending] = useState(false);
  const [unlockNow, setUnlockNow] = useState(Date.now());

  const lastActivityRef = useRef(Date.now());
  const pendingRecordRef = useRef(null);
  const partnerIdRef = useRef(null);
  const pendingInvitationsRef = useRef([]);
  const activeUnlockRequestRef = useRef(null);
  const unlockActionPendingRef = useRef(false);
  const { startRecording, stopAndUpload } = useAudioRecorder();

  useEffect(() => { partnerIdRef.current = partnerId; }, [partnerId]);
  useEffect(() => { pendingInvitationsRef.current = pendingInvitations; }, [pendingInvitations]);
  useEffect(() => { activeUnlockRequestRef.current = activeUnlockRequest; }, [activeUnlockRequest]);
  useEffect(() => { unlockActionPendingRef.current = unlockActionPending; }, [unlockActionPending]);

  const onSpeechStart = useCallback(() => setIsHearing(true), []);
  const onSpeechEnd = useCallback(() => setIsHearing(false), []);

  useVoiceRecognition({
    enabled: isLoggedIn && !verifying && !isUnlocked,
    onSpeechStart,
    onSpeechEnd,
  });

  // ...existing code...

  const markUnlocked = useCallback(() => {
    setRecordingState('matched');
    setIsUnlocked(true);
    setLockCountdown(60);
    lastActivityRef.current = Date.now();
    window.setTimeout(() => setRecordingState('idle'), 1500);
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
      const confirmed = true;
      if (!confirmed) {
        setVerifyError('Voice not recognised. Try again.');
        return;
      }

      const currentPartnerId = partnerIdRef.current;
      if (type === 'private') {
        setActiveTab('me');
        pendingRecordRef.current = { sender: userId, recipient: userId, type: 'private' };
      } else {
        if (!currentPartnerId) {
          setVerifyError('No partner connected yet.');
          return;
        }
        setActiveTab('us');
        pendingRecordRef.current = {
          sender: userId,
          type: 'shared',
          participants: [userId, currentPartnerId],
        };
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

    const result = await stopAndUpload(meta.type);
    const audioBlob = result?.blob;

    let transcription = '';
    if (audioBlob) {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      try {
        const resp = await fetch(`${BACKEND_URL}/transcribe`, {
          method: 'POST',
          body: formData,
        });
        const data = await resp.json();
        transcription = data.transcription || '';
      } catch (err) {
        console.error('[Transcription] Error:', err);
      }
    }

    await saveMessage({
      ...meta,
      data: result?.url ?? null,
      mimeType: result?.mimeType ?? null,
      duration: result?.duration ?? 0,
      transcription,
    });
  }, [stopAndUpload]);

  const startPrivateUnlockFlow = useCallback(async () => {
  if (activeUnlockRequestRef.current && !isUnlockRequestComplete(activeUnlockRequestRef.current)) {
    setVerifyError('Finish the current unlock prompt first.');
    return;
  }

  setVerifyError('');
  setActiveTab('me');

  const request = buildPrivateUnlockRequest({ userId, userName });
  setActiveUnlockRequest(request);

  try {
    // Start recording immediately for verification
    pendingRecordRef.current = {
      sender: userId,
      recipient: userId,
      type: 'private'
    };

    await startRecording();
    setRecordingState('recording');

  } catch (err) {
    console.error('[Unlock] Failed to start recording:', err);
    setVerifyError('Microphone could not start.');
  }
}, [userId, userName, startRecording]);

  const startSharedUnlockFlow = useCallback(async () => {
    if (unlockActionPendingRef.current) return;
    if (activeUnlockRequestRef.current && !isUnlockRequestComplete(activeUnlockRequestRef.current)) {
      setVerifyError('Finish the current unlock prompt first.');
      return;
    }

    const currentPartnerId = partnerIdRef.current;
    if (!currentPartnerId) {
      setVerifyError('No partner connected yet.');
      return;
    }

    setVerifyError('');
    setActiveTab('us');
    setUnlockActionPending(true);

    try {
      const { data, error } = await supabase.from('unlock_requests').insert({
        requester_id: userId,
        requester_name: userName,
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
  }, [userId, userName]);

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

  const recordUnlockAgreement = useCallback(async () => {
    const request = activeUnlockRequestRef.current;
    if (!request || unlockActionPendingRef.current || isUnlockRequestComplete(request)) return;
    if (request.status === 'pending_partner') return;

    const countdownRemaining = request.status === 'countdown'
      ? getCountdownRemaining(request.countdownStartedAt, Date.now())
      : 0;
    if (countdownRemaining > 0) return;

    if (request.kind === 'private') {
  const now = new Date().toISOString();

  try {
    const result = await stopAndUpload('private', { upload: false, transcribe: false });

    if (!result || !result.blob) {
      setVerifyError('Recording failed. Please try again.');
      console.error('[Unlock] stopAndUpload returned null', result);
      return;
    }

    const audioBlob = result.blob;

    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.webm');
    console.log('user id', userId)
    formData.append('user_id', userId);

    const resp = await fetch(`${BACKEND_URL}/verify-me`, {
      method: 'POST',
      body: formData,
    });

    const data = await resp.json();
    console.log('[verify-me result]', data);

    if (data.error) {
      setVerifyError(data.error);
      return;
    }

    setActiveUnlockRequest((current) => {
      if (!current || current.id !== request.id) return current;
      return {
        ...current,
        requesterAgreedAt: now,
        status: 'unlocked',
        unlockedAt: now,
      };
    });

  } catch (err) {
    console.error('[Unlock verify error]', err);
    setVerifyError('Verification failed.');
  }

  return;
}

    const isRequester = request.requesterId === userId;
    const alreadyAgreed = isRequester ? request.requesterAgreedAt : request.partnerAgreedAt;
    if (alreadyAgreed) return;

    setVerifyError('');
    setUnlockActionPending(true);

    try {
      const now = new Date().toISOString();
      const payload = isRequester ? { requester_agreed_at: now } : { partner_agreed_at: now };
      const otherAgreedAt = isRequester ? request.partnerAgreedAt : request.requesterAgreedAt;
      
      // verify the voice id of me

      if (otherAgreedAt) {
        payload.status = 'unlocked';
        payload.unlocked_at = now;
      }

      const { data, error } = await supabase.from('unlock_requests').update(payload)
        .eq('id', request.id)
        .select()
        .single();

      if (error) throw error;

      const mapped = mapUnlockRequest(data);
      setActiveUnlockRequest(mapped);

      if (mapped.requesterAgreedAt && mapped.partnerAgreedAt && mapped.status !== 'unlocked') {
        await supabase.from('unlock_requests').update({
          status: 'unlocked',
          unlocked_at: now,
        }).eq('id', request.id);
      }
    } catch (err) {
      console.error('[App] Could not record unlock consent:', err);
      setVerifyError('Could not record your consent.');
    } finally {
      setUnlockActionPending(false);
    }
  }, [userId]);

  useEffect(() => {
    const id = localStorage.getItem('userId');
    const name = localStorage.getItem('userName');
    if (id && name) handleLogin(id, name);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!userId) return;

    (async () => {
      const { data: rows } = await supabase.from('users').select('*').eq('id', userId).limit(1);
      const data = rows?.[0];
      if (!data) return;

      if (data.paired_with) {
        setPartnerId(data.paired_with);
        const { data: partnerRows } = await supabase.from('users').select('name').eq('id', data.paired_with).limit(1);
        const partner = partnerRows?.[0];
        if (partner) setPartnerName(partner.name);
      }
    })();
  }, [userId]);

  // Only start locking when user is idle in unlocked state
  useEffect(() => {
    if (!isUnlocked) return;
    const tick = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, Math.ceil((60000 - elapsed) / 1000));

      setLockCountdown(remaining);
      // Only lock if user is idle (no activity for 60s)
      if (elapsed > 60000) {
        setIsUnlocked(false);
        setLockCountdown(0);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [isUnlocked]);

  // Listen for user activity in unlocked state to reset timer
  useEffect(() => {
    if (!isUnlocked) return;
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };
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
    ? activeUnlockRequest.id
    : null;

  useEffect(() => {
    if (!completedUnlockId) return;
    markUnlocked();
    const timer = window.setTimeout(() => {
      setActiveUnlockRequest((current) => current?.id === completedUnlockId ? null : current);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [completedUnlockId, markUnlocked]);

  useEffect(() => {
    if (!userId) return;

    const isForCurrentUser = (row) => row?.requester_id === userId || row?.partner_id === userId;
    const syncUnlockRequest = (row) => {
      if (!isForCurrentUser(row)) return;

      const mapped = mapUnlockRequest(row);
      if (!isUnlockRequestRelevant(mapped)) {
        setActiveUnlockRequest((current) => current?.id === mapped.id ? null : current);
        return;
      }

      setActiveTab('us');
      setActiveUnlockRequest(mapped);
    };

    (async () => {
      const [{ data: priv }, { data: shared }, { data: invites }, unlockResult] = await Promise.all([
        supabase.from('messages').select('*')
          .eq('sender', userId)
          .eq('type', 'private')
          .order('timestamp', { ascending: false }),
        supabase.from('messages').select('*')
          .contains('participants', [userId])
          .order('timestamp', { ascending: false }),
        supabase.from('invitations').select('*')
          .eq('to', userId)
          .eq('status', 'pending'),
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
        const latestUnlock = (unlockResult.data ?? [])
          .map(mapUnlockRequest)
          .find((request) => isUnlockRequestActive(request));
        if (latestUnlock) {
          setActiveTab('us');
          setActiveUnlockRequest(latestUnlock);
        }
      }
    })();

    const channel = supabase
      .channel(`user-${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        ({ new: msg }) => {
          const mapped = mapMessage(msg);
          if (msg.type === 'private' && msg.sender === userId) {
            setPrivateMessages((prev) => [mapped, ...prev]);
          }
          if (msg.participants?.includes(userId)) {
            setSharedMessages((prev) => [mapped, ...prev]);
          }
        }
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'invitations', filter: `to=eq.${userId}` },
        ({ new: inv }) => {
          if (inv.status === 'pending') {
            setPendingInvitations((prev) => [mapInvitation(inv), ...prev]);
          }
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'invitations', filter: `to=eq.${userId}` },
        ({ new: inv }) => {
          setPendingInvitations((prev) => prev.filter((item) => item.id !== inv.id || inv.status === 'pending'));
        }
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'unlock_requests' },
        ({ new: request }) => {
          syncUnlockRequest(request);
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'unlock_requests' },
        ({ new: request }) => {
          syncUnlockRequest(request);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [userId]);

  const sendInvitation = useCallback(async (toId) => {
    const { data: rows } = await supabase.from('users').select('id').eq('id', toId).limit(1);
    if (!rows?.length) throw new Error('User ID not found.');

    const { error } = await supabase.from('invitations').insert({
      from: userId,
      from_name: userName,
      to: toId,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  }, [userId, userName]);

  const acceptInvitation = useCallback(async (inv) => {
    await supabase.from('invitations').update({ status: 'accepted' }).eq('id', inv.id);
    await supabase.from('users').update({ paired_with: inv.from }).eq('id', userId);
    await supabase.from('users').update({ paired_with: userId }).eq('id', inv.from);
    setPartnerId(inv.from);
    setPartnerName(inv.fromName);
  }, [userId]);

  useEffect(() => {
    if (!isLoggedIn) return;

    const handle = async ({ detail: cmd }) => {
      lastActivityRef.current = Date.now();
      const currentUnlockRequest = activeUnlockRequestRef.current;

      if (currentUnlockRequest && !isUnlockRequestComplete(currentUnlockRequest)) {
        if (cmd === 'i agree') {
          await recordUnlockAgreement();
        }
        return;
      }

      // TODO: abstract this somewhere else
      if (cmd === 'record me') {
        beginRecording('private');
      } else if (cmd === 'record for us') {
        beginRecording('shared');
      } else if (cmd === 'listen to me') {
        startPrivateUnlockFlow();
      } else if (cmd === 'listen to us') {
        await startSharedUnlockFlow();
      } else if (cmd === 'stop recording') {
        handleStopRecording();
      } else if (cmd === 'connect us') {
        // Handle connect us command
      } else if (cmd === 'stop listening') {
        // Handle stop listening command
      } else if (cmd === 'i agree') {
        const invites = pendingInvitationsRef.current;
        if (invites.length === 0) return;

        setVerifying(true);
        try {
          const confirmed = await checkVoiceCommand('I agree'); // TODO: change to verifyVoiceCommand
          if (confirmed) acceptInvitation(invites[0]);
        } finally {
          setVerifying(false);
        }
      } else if (cmd === 'stop recording') {
        handleStopRecording();
      }
    };

    window.addEventListener('voiceCommand', handle);
    return () => window.removeEventListener('voiceCommand', handle);
  }, [
    isLoggedIn,
    beginRecording,
    acceptInvitation,
    handleStopRecording,
    recordUnlockAgreement,
    startPrivateUnlockFlow,
    startSharedUnlockFlow,
  ]);

  const handleLogin = (id, name) => {
    setUserId(id);
    setUserName(name);
    setIsLoggedIn(true);
    localStorage.setItem('userId', id);
    localStorage.setItem('userName', name);
  };

  const handleLogout = () => {
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    setUserId(null);
    setUserName('');
    setIsLoggedIn(false);
    setPartnerId(null);
    setPartnerName('');
    setPrivateMessages([]);
    setSharedMessages([]);
    setPendingInvitations([]);
    setIsUnlocked(false);
    setLockCountdown(0);
    setRecordingState('idle');
    setVerifyError('');
    setActiveUnlockRequest(null);
    setUnlockActionPending(false);
  };

  if (!isLoggedIn) return <LoginScreen onLogin={handleLogin} />;

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
      <div className="w-full max-h-[80vh] max-w-sm bg-[#0d1117] text-[#f0f6fc] flex flex-col font-sans rounded-2xl border border-[#21273a] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#21273a] bg-[#0d1117]">
          <span className="text-[13px] font-bold tracking-tight text-[#f0f6fc]">We Listen</span>
          <button
            onClick={handleLogout}
            className="cursor-pointer text-[10px] text-[#4b5368] hover:text-[#ef4444] font-semibold transition-colors"
          >
            Log out
          </button>
        </div>

        <TabBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          partnerName={partnerName}
          userName={userName}
        />

        <div className="flex-1 overflow-y-auto min-h-[400px]">
          {activeTab === 'me' && (
            <div className="px-3 py-3 space-y-2">
              {pendingInvitations.map((inv) => (
                <div
                  key={inv.id}
                  className="rounded-xl bg-[#1c2030] border border-[#7c3aed]/30 px-4 py-3"
                >
                  <p className="text-[12px] text-[#b8c0d8] font-semibold">
                    Pairing request from <span className="text-[#7c3aed]">{inv.fromName}</span>
                  </p>
                  <p className="text-[11px] text-[#4b5368] mt-0.5">
                    Say <span className="italic text-[#8892a4]">"I agree"</span> to accept
                  </p>
                  <button
                    onClick={() => acceptInvitation(inv)}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-[#7c3aed]/20 border border-[#7c3aed]/40 text-[11px] text-[#7c3aed] font-semibold hover:bg-[#7c3aed]/30 transition-all"
                  >
                    Accept
                  </button>
                </div>
              ))}

              {meMessages.length === 0 && pendingInvitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center gap-2 select-none">
                  <span className="text-3xl opacity-20">🔒</span>
                  <p className="text-[12px] text-[#3a4155] max-w-[200px] leading-relaxed">{emptyHint}</p>
                </div>
              ) : (
                meMessages.map((msg) => (
                  <VoiceMessageCard key={msg.id} message={msg} isUnlocked={isUnlocked} />
                ))
              )}
            </div>
          )}

          {activeTab === 'us' && (
            partnerId ? (
              <div className="px-3 py-3 space-y-2">
                {usMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center gap-2 select-none">
                    <span className="text-3xl opacity-20">🔒</span>
                    <p className="text-[12px] text-[#3a4155] max-w-[200px] leading-relaxed">{emptyHint}</p>
                  </div>
                ) : (
                  usMessages.map((msg) => (
                    <VoiceMessageCard key={msg.id} message={msg} isUnlocked={isUnlocked} />
                  ))
                )}
              </div>
            ) : (
              <PairingScreen userId={userId} userName={userName} onSendInvite={sendInvitation} />
            )
          )}
        </div>

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
        {!isUnlocked && (
          <div className="text-xs text-[#7c3aed] text-center py-2">
            Voice commands are active.
          </div>
        )}
        {isUnlocked && (
          <div className="text-xs text-[#4b5368] text-center py-2">
            Voice commands are disabled while unlocked.
          </div>
        )}
        <DebugPanel />
      </div>

      {activeUnlockRequest && (
        <UnlockConsentOverlay
          request={activeUnlockRequest}
          currentUserId={userId}
          countdownRemaining={unlockCountdownRemaining}
          isSubmitting={unlockActionPending}
          onAcceptSharedRequest={acceptSharedUnlockRequest}
          onVerifyMe={recordUnlockAgreement}
        />
      )}
    </div>
  );
}
