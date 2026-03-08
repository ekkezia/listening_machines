import { useState } from 'react';
import { supabase } from '../supabase';
import { BACKEND_URL } from '../config';

function MicIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 3a4 4 0 00-4
        4v4a4 4 0 008 0V7a4 4 0 00-4-4z" />
    </svg>
  );
}

// Races a promise against a timeout so nothing can hang forever
const withTimeout = (promise, ms, label = 'Operation') =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

export default function LoginScreen({ onLogin }) {
  const [success, setSuccess]                     = useState('');
  const [loginMode, setLoginMode]                 = useState(null);
  const [userId, setUserId]                       = useState('');
  const [existingId, setExistingId]               = useState('');
  const [biometricBlob, setBiometricBlob]         = useState(null);
  const [biometricRecorded, setBiometricRecorded] = useState(false);
  const [isRecording, setIsRecording]             = useState(false);
  const [submitting, setSubmitting]               = useState(false);
  const [verifyingUnlock, setVerifyingUnlock]     = useState(false);
  const [unlockVerified, setUnlockVerified]       = useState(false);
  const [error, setError]                         = useState('');

  const handleBiometric = async () => {
    setIsRecording(true);
    setError('');
    // Reset previous attempt so the button always re-enables on failure
    setBiometricBlob(null);
    setBiometricRecorded(false);
    setUnlockVerified(false);

    let stream = null;
    try {
      // 1. Get mic — timeout after 5s (covers dismissed permission dialogs)
      stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
        5000,
        'Mic access'
      );

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
        .find(m => MediaRecorder.isTypeSupported(m)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start();

      // 2. Record for 2.5s
      await new Promise(r => setTimeout(r, 2500));
      recorder.stop();

      // 3. Wait for onstop — hard 3s timeout (this was the original hang cause)
      await withTimeout(
        new Promise(r => { recorder.onstop = r; }),
        3000,
        'Recorder stop'
      );

      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      if (blob.size === 0) throw new Error('Recording produced empty audio. Please try again.');

      setBiometricBlob(blob);
      setBiometricRecorded(true);

      // 4. Verify with backend
      setVerifyingUnlock(true);
      const formData = new FormData();
      formData.append('user_id', userId.trim().toLowerCase().replace(/\s+/g, '_'));
      formData.append('audio', blob, 'audio.webm');

      let data = null;
      try {
        const resp = await withTimeout(
          fetch(`${BACKEND_URL}/verify-me`, { method: 'POST', body: formData }),
          10000,
          'Voice verification'
        );
        if (!resp.ok) throw new Error('Server error: ' + resp.status);
        data = await resp.json();
        console.log('[Login] Verification response:', data);
      } catch (fetchErr) {
        setError(fetchErr?.message || 'Voice verification failed: server error.');
        // Clear so user can re-record immediately
        setBiometricBlob(null);
        setBiometricRecorded(false);
        return;
      }

      if (data && (data.success || data.unlock)) {
        setUnlockVerified(true);
        setError('');
      } else {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : 'Voice verification failed. Please try again.'
        );
        // Clear so re-record button re-enables
        setBiometricBlob(null);
        setBiometricRecorded(false);
      }
    } catch (err) {
      setError(err?.message || 'Mic access denied or recording failed.');
      setBiometricBlob(null);
      setBiometricRecorded(false);
      console.error('[Login] Biometric failed:', err);
    } finally {
      if (stream) stream.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      setVerifyingUnlock(false);
    }
  };

  const handleCreateUser = async () => {
    if (!userId.trim() || !biometricBlob || !unlockVerified) return;
    setSubmitting(true);
    setError('');
    try {
      const userIdClean = userId.trim().toLowerCase().replace(/\s+/g, '_');

      // Check if user already exists
      const { data: existing, error: selectErr } = await supabase
        .from('users')
        .select('id')
        .eq('id', userIdClean)
        .single();

      if (selectErr && selectErr.code !== 'PGRST116') {
        setError('Failed to check user: ' + selectErr.message);
        setUnlockVerified(false);
        setSubmitting(false);
        return;
      }

      if (existing?.id) {
        // User exists — treat as login
        setSuccess('Welcome back! Redirecting...');
        setTimeout(() => {
          window.lastVoiceBlob = biometricBlob;
          onLogin(userIdClean, userId.trim());
        }, 1200);
        setSubmitting(false);
        return;
      }

      // New user — insert row
      const { error: insertErr } = await supabase
        .from('users')
        .insert([{ id: userIdClean, paired_with: null, created_at: new Date().toISOString() }]);

      if (insertErr) {
        setError('Failed to create user: ' + insertErr.message);
        setUnlockVerified(false);
        setSubmitting(false);
        return;
      }

      setSuccess('Account created successfully! Redirecting...');
      setTimeout(() => {
        window.lastVoiceBlob = biometricBlob;
        onLogin(userIdClean, userId.trim());
      }, 1200);
    } catch (err) {
      setError('Failed to create account or verify voice.');
      setUnlockVerified(false);
      console.error('[Login] Create user failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExistingLogin = async () => {
    if (!existingId.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const { data: rows } = await supabase
        .from('users').select('name').eq('id', existingId.trim()).limit(1);
      const data = rows?.[0];
      if (!data) { setError('User ID not found.'); setSubmitting(false); return; }
      onLogin(existingId.trim(), data.name);
    } catch (err) {
      setError('Could not connect to database.');
      console.error('[Login] Existing login failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const isWorking  = isRecording || verifyingUnlock;
  const isVerified = unlockVerified && !!biometricBlob;

  const recordBtnLabel = isRecording
    ? 'Recording…'
    : verifyingUnlock
      ? 'Verifying…'
      : isVerified
        ? '✓ Voice verified'
        : biometricRecorded
          ? '✓ Voice recorded'
          : 'Record voice';

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#0d1117] text-[#f0f6fc] flex flex-col rounded-2xl border border-[#21273a] shadow-2xl">
        <div className="px-6 pt-8 pb-6 text-center border-b border-[#21273a]">
          <div className="w-12 h-12 rounded-2xl bg-[#7c3aed]/20 border border-[#7c3aed]/30
            flex items-center justify-center mx-auto mb-3">
            <MicIcon className="w-6 h-6 text-[#7c3aed]" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">We Listen</h1>
          <p className="text-[11px] text-[#4b5368] mt-1">Voice-authenticated messaging</p>
        </div>

        <div className="flex-1 px-6 py-6 space-y-3">
          {!loginMode && (
            <button onClick={() => setLoginMode('new')}
              className="w-full py-3 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] text-white
                text-sm font-semibold transition-all shadow-[0_0_20px_rgba(124,58,237,0.3)]
                hover:shadow-[0_0_28px_rgba(124,58,237,0.5)]">
              Log in
            </button>
          )}

          {loginMode === 'new' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] text-[#4b5368] font-semibold uppercase tracking-widest mb-1.5">
                  Choose a name
                </label>
                <input type="text" value={userId} onChange={e => setUserId(e.target.value)}
                  placeholder="e.g. darwin"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#1c2030] border border-[#2a2f42]
                    text-sm text-[#f0f6fc] placeholder-[#3a4155] focus:outline-none
                    focus:border-[#7c3aed]/60 transition-all" />
              </div>

              {userId.trim() && (
                <div>
                  <label className="block text-[11px] text-[#4b5368] font-semibold uppercase tracking-widest mb-1.5">
                    Voice biometric — say "I agree"
                  </label>
                  <button
                    onClick={handleBiometric}
                    disabled={isWorking}
                    className={`w-full py-2.5 rounded-xl text-sm font-semibold border transition-all flex items-center justify-center gap-2
                      ${isVerified
                        ? 'bg-[#06201580] border-[#10b981]/40 text-[#10b981]'
                        : isWorking
                          ? 'bg-[#2d0a0a] border-[#ef4444]/40 text-[#ef4444] animate-pulse'
                          : 'bg-[#1c2030] border-[#2a2f42] text-[#b8c0d8] hover:border-[#ef4444]/30 hover:text-[#ef4444]'
                      }`}>
                    <MicIcon className="w-4 h-4" />
                    {recordBtnLabel}
                  </button>

                  {/* Re-record after success */}
                  {isVerified && !isWorking && (
                    <button onClick={handleBiometric}
                      className="mt-1 w-full text-[11px] text-[#4b5368] hover:text-[#8892a4] transition-colors">
                      Re-record
                    </button>
                  )}

                  {/* Retry button on error (from their version) */}
                  {error && biometricRecorded && !isVerified && (
                    <button onClick={handleBiometric} disabled={isWorking}
                      className="mt-2 w-full py-2.5 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2 bg-[#ef4444] text-white hover:bg-[#b91c1c] transition-all disabled:opacity-50">
                      <MicIcon className="w-4 h-4" />
                      {isWorking ? 'Retrying…' : 'Retry Record'}
                    </button>
                  )}
                </div>
              )}

              {error && <p className="text-[11px] text-[#ef4444]">{error}</p>}
              {success && <p className="text-[11px] text-[#10b981] font-semibold">{success}</p>}

              <button
                onClick={handleCreateUser}
                disabled={!userId.trim() || !isVerified || submitting}
                className="w-full py-3 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9]
                  disabled:bg-[#1c2030] disabled:text-[#3a4155] disabled:cursor-not-allowed
                  text-white text-sm font-semibold transition-all">
                {verifyingUnlock
                  ? 'Verifying voice…'
                  : submitting
                    ? 'Creating account…'
                    : isVerified
                      ? 'Continue →'
                      : 'Verify voice to continue'}
              </button>

              <button onClick={() => {
                setLoginMode(null);
                setUserId('');
                setBiometricBlob(null);
                setBiometricRecorded(false);
                setUnlockVerified(false);
                setError('');
                setSuccess('');
              }}
                className="w-full py-2 text-[12px] text-[#4b5368] hover:text-[#8892a4] transition-colors">
                ← Back
              </button>
            </div>
          )}

          {loginMode === 'existing' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] text-[#4b5368] font-semibold uppercase tracking-widest mb-1.5">
                  Your user ID
                </label>
                <input type="text" value={existingId} onChange={e => setExistingId(e.target.value)}
                  placeholder="user_1234567890"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#1c2030] border border-[#2a2f42]
                    text-sm text-[#f0f6fc] placeholder-[#3a4155] focus:outline-none
                    focus:border-[#7c3aed]/60 transition-all font-mono text-[12px]" />
              </div>

              {error && <p className="text-[11px] text-[#ef4444]">{error}</p>}

              <button onClick={handleExistingLogin}
                disabled={!existingId.trim() || submitting}
                className="w-full py-3 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9]
                  disabled:bg-[#1c2030] disabled:text-[#3a4155] disabled:cursor-not-allowed
                  text-white text-sm font-semibold transition-all">
                {submitting ? 'Logging in…' : 'Log in →'}
              </button>

              <button onClick={() => { setLoginMode(null); setExistingId(''); setError(''); }}
                className="w-full py-2 text-[12px] text-[#4b5368] hover:text-[#8892a4] transition-colors">
                ← Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}