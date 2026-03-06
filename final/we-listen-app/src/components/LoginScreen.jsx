import { useState } from 'react';
import { supabase } from '../supabase';

function MicIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 3a4 4 0 00-4
        4v4a4 4 0 008 0V7a4 4 0 00-4-4z" />
    </svg>
  );
}

export default function LoginScreen({ onLogin }) {
  const [loginMode, setLoginMode]               = useState(null);
  const [customName, setCustomName]             = useState('');
  const [existingId, setExistingId]             = useState('');
  const [biometricRecorded, setBiometricRecorded] = useState(false);
  const [biometricBlob, setBiometricBlob]       = useState(null);
  const [isRecording, setIsRecording]           = useState(false);
  const [submitting, setSubmitting]             = useState(false);
  const [error, setError]                       = useState('');

  const handleBiometric = async () => {
    setIsRecording(true);
    setError('');
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
        .find(m => MediaRecorder.isTypeSupported(m)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const chunks   = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start();
      await new Promise(r => setTimeout(r, 2500));
      recorder.stop();
      await new Promise(r => { recorder.onstop = r; });
      stream.getTracks().forEach(t => t.stop());
      setBiometricBlob(new Blob(chunks, { type: mimeType || 'audio/webm' }));
      setBiometricRecorded(true);
    } catch (err) {
      setError('Mic access denied — please allow microphone use.');
      console.error('[Login] Biometric failed:', err);
    } finally {
      setIsRecording(false);
    }
  };

  const handleCreateUser = async () => {
    if (!customName.trim() || !biometricBlob) return;
    setSubmitting(true);
    setError('');
    try {
      const userId = customName.trim().toLowerCase().replace(/\s+/g, '_');

      // Check name uniqueness
      const { data: existingRows } = await supabase
        .from('users').select('id').eq('id', userId).limit(1);
      if (existingRows?.length) {
        setError('That name is already taken — try a different one.');
        setSubmitting(false);
        return;
      }

      // Upload biometric to Supabase Storage
      let voiceUrl = null;
      try {
        const ext  = biometricBlob.type.includes('ogg') ? 'ogg' : 'webm';
        const path = `biometrics/${userId}_${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('biometrics')
          .upload(path, biometricBlob, { contentType: biometricBlob.type });
        if (!upErr) {
          voiceUrl = supabase.storage.from('biometrics').getPublicUrl(path).data.publicUrl;
        } else {
          console.warn('[Login] Biometric upload failed:', upErr.message);
        }
      } catch (upErr) {
        console.warn('[Login] Biometric upload error:', upErr);
      }

      const { error } = await supabase.from('users').insert({
        id:          userId,
        name:        customName.trim(),
        voice_url:   voiceUrl,
        paired_with: null,
        created_at:  new Date().toISOString(),
      });
      if (error) throw error;

      onLogin(userId, customName.trim());
    } catch (err) {
      setError('Failed to create account. Check your connection.');
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
            <>
              <button onClick={() => setLoginMode('new')}
                className="w-full py-3 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] text-white
                  text-sm font-semibold transition-all shadow-[0_0_20px_rgba(124,58,237,0.3)]
                  hover:shadow-[0_0_28px_rgba(124,58,237,0.5)]">
                Create new ID
              </button>
              <button onClick={() => setLoginMode('existing')}
                className="w-full py-3 rounded-xl bg-[#1c2030] hover:bg-[#21273a] text-[#b8c0d8]
                  text-sm font-semibold border border-[#2a2f42] hover:border-[#3a4155] transition-all">
                Log in to existing ID
              </button>
            </>
          )}

          {loginMode === 'new' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] text-[#4b5368] font-semibold uppercase tracking-widest mb-1.5">
                  Choose a name
                </label>
                <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
                  placeholder="e.g. darwin"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#1c2030] border border-[#2a2f42]
                    text-sm text-[#f0f6fc] placeholder-[#3a4155] focus:outline-none
                    focus:border-[#7c3aed]/60 transition-all" />
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5368] font-semibold uppercase tracking-widest mb-1.5">
                  Voice biometric — say "I agree"
                </label>
                <button onClick={handleBiometric} disabled={biometricRecorded || isRecording}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold border transition-all flex items-center justify-center gap-2
                    ${biometricRecorded
                      ? 'bg-[#06201580] border-[#10b981]/40 text-[#10b981]'
                      : isRecording
                        ? 'bg-[#2d0a0a] border-[#ef4444]/40 text-[#ef4444] animate-pulse'
                        : 'bg-[#1c2030] border-[#2a2f42] text-[#b8c0d8] hover:border-[#ef4444]/30 hover:text-[#ef4444]'
                    }`}>
                  <MicIcon className="w-4 h-4" />
                  {biometricRecorded ? '✓ Voice recorded' : isRecording ? 'Recording…' : 'Record voice'}
                </button>
              </div>

              {error && <p className="text-[11px] text-[#ef4444]">{error}</p>}

              <button onClick={handleCreateUser}
                disabled={!customName.trim() || !biometricRecorded || submitting}
                className="w-full py-3 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9]
                  disabled:bg-[#1c2030] disabled:text-[#3a4155] disabled:cursor-not-allowed
                  text-white text-sm font-semibold transition-all">
                {submitting ? 'Creating account…' : 'Continue →'}
              </button>

              <button onClick={() => { setLoginMode(null); setCustomName(''); setBiometricRecorded(false); setBiometricBlob(null); setError(''); }}
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
