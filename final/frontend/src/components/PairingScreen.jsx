import { useState } from 'react';

export default function PairingScreen({ userId, userName, onSendInvite }) {
  const [partnerId, setPartnerId] = useState('');
  const [sending, setSending]     = useState(false);
  const [sent, setSent]           = useState(false);
  const [error, setError]         = useState('');
  const [inviteId, setInviteId] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');

  const handleSend = async () => {
    const trimmed = partnerId.trim();
    if (!trimmed || trimmed === userId) {
      setError("That's your own ID.");
      return;
    }
    setSending(true);
    setError('');
    try {
      await onSendInvite(trimmed);
      setInviteStatus('pending');
      setInviteId(trimmed);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Could not send invitation.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-[#10b981]/10 border border-[#10b981]/30
          flex items-center justify-center text-2xl">
          ✓
        </div>
        <p className="text-sm text-[#b8c0d8]">
          Invitation sent to <span className="font-mono text-[#7c3aed] text-[11px]">{partnerId.trim()}</span>
        </p>
        <p className="text-[11px] text-[#4b5368]">
          Ask them to open We Listen and say <span className="italic text-[#8892a4]">"I agree"</span>
        </p>
        {inviteStatus === 'pending' && (
          <p className="text-[11px] text-[#7c3aed]">
            Invitation to <span className="font-mono">{inviteId}</span> is pending.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="text-center">
        <p className="text-sm text-[#b8c0d8] font-semibold">Connect with a partner</p>
        <p className="text-[11px] text-[#4b5368] mt-1">
          Enter their user ID to send a pairing invitation
        </p>
      </div>

      <div className="bg-[#1c2030] rounded-xl border border-[#2a2f42] px-3 py-2.5">
        <p className="text-[10px] text-[#4b5368] font-semibold uppercase tracking-widest mb-1">
          Your ID (share this)
        </p>
        <p className="font-mono text-[11px] text-[#7c3aed] break-all select-all">{userId}</p>
      </div>

      <div>
        <label className="block text-[11px] text-[#4b5368] font-semibold uppercase tracking-widest mb-1.5">
          Partner's user ID
        </label>
        <input
          type="text"
          value={partnerId}
          onChange={e => { setPartnerId(e.target.value); setError(''); }}
          placeholder="user_1234567890"
          className="w-full px-3 py-2.5 rounded-xl bg-[#1c2030] border border-[#2a2f42]
            text-sm text-[#f0f6fc] placeholder-[#3a4155] focus:outline-none
            focus:border-[#7c3aed]/60 transition-all font-mono text-[12px]"
        />
        {error && <p className="text-[11px] text-[#ef4444] mt-1.5">{error}</p>}
      </div>

      <button
        onClick={handleSend}
        disabled={!partnerId.trim() || sending}
        className="w-full py-3 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9]
          disabled:bg-[#1c2030] disabled:text-[#3a4155] disabled:cursor-not-allowed
          text-white text-sm font-semibold transition-all">
        {sending ? 'Sending…' : 'Send invitation'}
      </button>
    </div>
  );
}
