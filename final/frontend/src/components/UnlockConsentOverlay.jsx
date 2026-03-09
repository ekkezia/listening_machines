import { UNLOCK_STATUS } from '../UnlockStatus';

const statusConfig = {
  [UNLOCK_STATUS.RECORDING]: {
    icon: '🎙️',
    label: 'Listening...',
    sub: 'Say "I agree" clearly',
    color: 'text-[#f59e0b]',
    pulse: true,
  },
  [UNLOCK_STATUS.VERIFYING]: {
    icon: '🔍',
    label: 'Verifying voice...',
    sub: 'Please wait',
    color: 'text-[#6366f1]',
    pulse: false,
  },
  [UNLOCK_STATUS.VOICE_MATCHED]: {
    icon: '✓',
    label: 'Voice matched!',
    sub: 'Your identity was confirmed',
    color: 'text-[#10b981]',
    pulse: false,
  },
  [UNLOCK_STATUS.WAITING_PARTNER]: {
    icon: '⏳',
    label: 'Waiting for partner...',
    sub: 'Your voice was confirmed. Waiting for them to agree.',
    color: 'text-[#8892a4]',
    pulse: false,
  },
  [UNLOCK_STATUS.UPLOADING]: {
    icon: '⬆️',
    label: 'Uploading...',
    sub: 'Please wait',
    color: 'text-[#6366f1]',
    pulse: false,
  },
  [UNLOCK_STATUS.DECLINED]: {
    icon: '✕',
    label: 'Request declined',
    sub: null,
    color: 'text-[#ef4444]',
    pulse: false,
  },
  [UNLOCK_STATUS.ERROR]: {
    icon: '⚠',
    label: 'Verification failed',
    sub: null,
    color: 'text-[#ef4444]',
    pulse: false,
  },
};

export default function UnlockConsentOverlay({
  request,
  currentUserId,
  countdownRemaining,
  isSubmitting,
  unlockStatus,
  verifyError,
  onAcceptSharedRequest,
  onVerifyMe,
  onDecline,
  onDismiss,
  onDismissError,
}) {
  if (!request) return null;

  const isShared = request.kind === 'shared';
  const isRequester = request.requesterId === currentUserId;
  const isUnlocked = request.status === 'unlocked';
  const isDeclined = request.status === 'declined' || unlockStatus === UNLOCK_STATUS.DECLINED;
  const isError = unlockStatus === UNLOCK_STATUS.ERROR;
  const isWaiting = unlockStatus === UNLOCK_STATUS.WAITING_PARTNER;
  const isVoiceMatched = unlockStatus === UNLOCK_STATUS.VOICE_MATCHED;
  const isCountingDown = request.status === 'countdown' && countdownRemaining > 0;
  const isPendingPartner = request.status === 'pending_partner';

  const activeStatus = statusConfig[unlockStatus];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-[#13181f] border border-[#21273a] rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#21273a] flex items-center justify-between">
          <span className="text-[13px] font-bold text-[#f0f6fc]">
            {isShared ? 'Shared unlock' : 'Private unlock'}
          </span>
          {(isUnlocked || isDeclined || isError) && (
            <button
              onClick={isError ? onDismissError : onDismiss}
              className="text-[11px] text-[#4b5368] hover:text-[#f0f6fc] font-semibold transition-colors"
            >
              Close
            </button>
          )}
        </div>

        <div className="px-5 py-5 space-y-4">

          {/* ── Unlocked state ── */}
          {isUnlocked && (
            <div className="flex flex-col items-center gap-2 py-2">
              <span className="text-3xl">🔓</span>
              <p className="text-[13px] font-semibold text-[#10b981]">
                {isShared ? 'Both voices confirmed' : 'Voice confirmed'}
              </p>
              <p className="text-[11px] text-[#4b5368]">You now have access</p>
            </div>
          )}

          {/* ── Declined state ── */}
          {isDeclined && !isUnlocked && (
            <div className="flex flex-col items-center gap-2 py-2">
              <span className="text-3xl">✕</span>
              <p className="text-[13px] font-semibold text-[#ef4444]">Request declined</p>
              <p className="text-[11px] text-[#4b5368]">The unlock request was declined</p>
            </div>
          )}

          {/* ── Error state ── */}
          {isError && !isUnlocked && !isDeclined && (
            <div className="flex flex-col items-center gap-3 py-2">
              <span className="text-3xl">⚠</span>
              <p className="text-[13px] font-semibold text-[#ef4444]">Verification failed</p>
              {verifyError && (
                <p className="text-[11px] text-[#8892a4] text-center max-w-[240px] leading-relaxed">
                  {verifyError}
                </p>
              )}
              <button
                onClick={onDismissError}
                className="mt-1 px-4 py-2 rounded-lg bg-[#1c2030] border border-[#21273a] text-[11px] text-[#f0f6fc] font-semibold hover:bg-[#252b3b] transition-all"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ── Active status indicator (recording / verifying / voice_matched / waiting) ── */}
          {!isUnlocked && !isDeclined && !isError && activeStatus && (
            <div className="flex flex-col items-center gap-2 py-2">
              <span className={`text-2xl ${activeStatus.pulse ? 'animate-pulse' : ''} ${activeStatus.color}`}>
                {activeStatus.icon}
              </span>
              <p className={`text-[13px] font-semibold ${activeStatus.color}`}>
                {activeStatus.label}
              </p>
              {activeStatus.sub && (
                <p className="text-[11px] text-[#4b5368] text-center">{activeStatus.sub}</p>
              )}
            </div>
          )}

          {/* ── Countdown ── */}
          {!isUnlocked && !isDeclined && !isError && !activeStatus && isCountingDown && (
            <div className="flex flex-col items-center gap-2 py-2">
              <span className="text-4xl font-bold text-[#f0f6fc] tabular-nums">{countdownRemaining}</span>
              <p className="text-[11px] text-[#4b5368]">
                {isShared ? 'Both users: get ready to say "I agree"' : 'Get ready to say "I agree"'}
              </p>
            </div>
          )}

          {/* ── Pending partner (requester view) ── */}
          {!isUnlocked && !isDeclined && !isError && !activeStatus && !isCountingDown && isPendingPartner && isRequester && (
            <div className="flex flex-col items-center gap-2 py-2">
              <span className="text-2xl">⏳</span>
              <p className="text-[13px] font-semibold text-[#f0f6fc]">Waiting for partner</p>
              <p className="text-[11px] text-[#4b5368]">They need to accept before you can both agree</p>
            </div>
          )}

          {/* ── Pending partner (partner view — accept/decline prompt) ── */}
          {!isUnlocked && !isDeclined && !isError && !activeStatus && !isCountingDown && isPendingPartner && !isRequester && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl bg-[#1c2030] border border-[#7c3aed]/20 px-4 py-3">
                <p className="text-[12px] text-[#b8c0d8] font-semibold">
                  <span className="text-[#7c3aed]">{request.requesterId}</span> wants to listen together
                </p>
                <p className="text-[11px] text-[#4b5368] mt-1 leading-relaxed">
                  Both of you will need to say "I agree" to unlock shared messages.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onAcceptSharedRequest}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-[#7c3aed] text-[12px] font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-all"
                >
                  Accept
                </button>
                <button
                  onClick={onDecline}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-[#1c2030] border border-[#21273a] text-[12px] font-bold text-[#8892a4] hover:text-[#ef4444] hover:border-[#ef4444]/30 disabled:opacity-50 transition-all"
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* ── Idle / ready state after countdown (shouldn't linger but just in case) ── */}
          {!isUnlocked && !isDeclined && !isError && !activeStatus && !isCountingDown && !isPendingPartner && (
            <div className="flex flex-col items-center gap-2 py-2">
              <span className="text-2xl animate-pulse">🎙️</span>
              <p className="text-[13px] font-semibold text-[#f0f6fc]">Say "I agree"</p>
              <p className="text-[11px] text-[#4b5368]">Speak clearly into your microphone</p>
            </div>
          )}

          {/* ── Decline button (available during pending/countdown for partner) ── */}
          {!isUnlocked && !isDeclined && !isError && isShared && !isPendingPartner && !isWaiting && !isVoiceMatched && (
            <button
              onClick={onDecline}
              disabled={isSubmitting}
              className="w-full py-2 rounded-xl border border-[#21273a] text-[11px] text-[#4b5368] hover:text-[#ef4444] hover:border-[#ef4444]/30 disabled:opacity-50 transition-all"
            >
              Cancel
            </button>
          )}

        </div>
      </div>
    </div>
  );
}