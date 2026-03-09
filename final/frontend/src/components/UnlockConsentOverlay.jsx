const isUnlockRequestComplete = (request) => {
  if (!request) return false;
  // Both private and shared: only trust status===unlocked, never agreedAt.
  // agreedAt fields are intermediate markers written before server verification.
  return request.status === 'unlocked';
};

function Spinner({ color = 'text-white', size = 'w-4 h-4' }) {
  return (
    <svg className={`animate-spin ${size} ${color}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function MicRing() {
  return (
    <div className="relative flex items-center justify-center mt-6 mb-2">
      <div className="absolute w-20 h-20 rounded-full bg-[#ef4444]/20 animate-ping" />
      <div className="absolute w-14 h-14 rounded-full bg-[#ef4444]/15 animate-ping" style={{ animationDelay: '0.3s' }} />
      <div className="relative w-12 h-12 rounded-full bg-[#1a0808] border-2 border-[#ef4444]/70 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.35)]">
        <svg className="w-6 h-6 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 3a4 4 0 00-4 4v4a4 4 0 008 0V7a4 4 0 00-4-4z" />
        </svg>
      </div>
    </div>
  );
}

function StepPill({ icon, label, sublabel, color, bg, border }) {
  return (
    <div className={`mt-5 w-full rounded-2xl ${bg} border ${border} px-4 py-3 flex items-start gap-3`}>
      <div className={`flex-shrink-0 mt-0.5 ${color}`}>{icon}</div>
      <div className="text-left">
        <p className={`text-[12px] font-semibold leading-tight ${color}`}>{label}</p>
        {sublabel && <p className="text-[11px] text-[#8892a4] mt-0.5 leading-relaxed">{sublabel}</p>}
      </div>
    </div>
  );
}

function ErrorPill({ message, onDismiss }) {
  return (
    <div className="mt-5 w-full rounded-2xl bg-[#1c0909] border border-[#ef4444]/40 px-4 py-3 text-left">
      <div className="flex items-start gap-3">
        <svg className="w-4 h-4 text-[#ef4444] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-[12px] font-semibold text-[#ef4444]">Verification failed</p>
          <p className="text-[11px] text-[#f87171] mt-0.5 leading-relaxed">{message}</p>
        </div>
      </div>
    </div>
  );
}

// Always-visible decline button — sits at the bottom of the card
function DeclineButton({ onDecline, isSubmitting, label = 'Decline' }) {
  return (
    <button
      onClick={onDecline}
      disabled={isSubmitting}
      className="mt-6 flex items-center gap-1.5 text-[12px] text-[#4b5368] hover:text-[#ef4444] disabled:opacity-40 disabled:cursor-not-allowed transition-colors group"
    >
      <svg
        className="w-3.5 h-3.5 group-hover:text-[#ef4444] transition-colors"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
      {label}
    </button>
  );
}

const STATUS_CONFIG = {
  recording: {
    label: 'Recording your voice…',
    sublabel: 'Speak clearly — say "I agree" into the microphone.',
    color: 'text-[#ef4444]',
    bg: 'bg-[#1c0909]',
    border: 'border-[#ef4444]/30',
    icon: <Spinner color="text-[#ef4444]" />,
  },
  uploading: {
    label: 'Uploading audio…',
    sublabel: 'Sending your recording to be verified.',
    color: 'text-[#f59e0b]',
    bg: 'bg-[#1a1200]',
    border: 'border-[#f59e0b]/30',
    icon: <Spinner color="text-[#f59e0b]" />,
  },
  verifying: {
    label: 'Matching voice with model…',
    sublabel: 'Running voice-ID — this takes a few seconds.',
    color: 'text-[#a78bfa]',
    bg: 'bg-[#100b1f]',
    border: 'border-[#7c3aed]/30',
    icon: <Spinner color="text-[#a78bfa]" />,
  },
  waiting_partner: {
    label: 'Waiting for your partner…',
    sublabel: 'Your voice was recorded. The other user must also agree.',
    color: 'text-[#10b981]',
    bg: 'bg-[#041510]',
    border: 'border-[#10b981]/30',
    icon: <Spinner color="text-[#10b981]" />,
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
  const currentUserAgreed = isRequester ? request.requesterAgreedAt : request.partnerAgreedAt;
  const partnerAgreed = isRequester ? request.partnerAgreedAt : request.requesterAgreedAt;
  const complete = isUnlockRequestComplete(request);
  const isActivelyProcessing = ['recording', 'uploading', 'verifying'].includes(unlockStatus);

  // ── Declined state — shown to BOTH sides ────────────────────────────────
  const isDeclined = request.status === 'declined' || unlockStatus === 'declined';
  if (isDeclined) {
    const theyDeclined = isShared && !isRequester
      ? false  // requester declined
      : true;  // partner declined (or we declined)
    // Determine who declined: if this user triggered it, show "you declined"
    // If it came via realtime from the other side, show "partner declined"
    const selfDeclined = unlockStatus === 'declined' && request.status !== 'declined';
    const message = selfDeclined
      ? 'You declined the unlock request.'
      : 'Your partner declined the unlock request.';

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#04070d]/75 backdrop-blur-md px-5">
        <div className="flex flex-col items-center justify-center w-full max-w-sm rounded-[2rem] border border-[#ef4444]/20 bg-[linear-gradient(180deg,#110a0a_0%,#0b1220_100%)] shadow-[0_24px_80px_rgba(0,0,0,0.55)] px-6 py-8 text-center text-[#f8fafc]">
          <div className="w-12 h-12 rounded-full bg-[#ef4444]/10 border border-[#ef4444]/30 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-[11px] uppercase tracking-[0.35em] text-[#94a3b8] font-semibold">Unlock Cancelled</p>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-[#f87171]">Request Declined</h2>
          <p className="mt-3 text-sm leading-6 text-[#94a3b8]">{message}</p>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="mt-5 px-5 py-2 rounded-full border border-[#ef4444]/30 text-[12px] text-[#f87171] hover:text-[#f8fafc] hover:border-[#ef4444]/60 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Normal states ────────────────────────────────────────────────────────
  let eyebrow = 'Unlock';
  let title = 'Say "I agree"';
  let body = 'Recite "I agree" to unlock the data.';
  let cta = null;
  let countdown = null;
  let showMicRing = false;

  if (isShared && request.status === 'pending_partner') {
    eyebrow = 'Shared Unlock';
    if (isRequester) {
      title = 'Waiting for your partner';
      body = 'Waiting for the other partner to accept the unlock request.';
    } else {
      title = 'Unlock request received';
      body = 'Your partner wants to unlock the shared data together with you.';
      cta = (
        <button
          onClick={onAcceptSharedRequest}
          disabled={isSubmitting}
          className="px-5 py-2 rounded-full bg-[#f59e0b] text-[#111827] text-sm font-semibold hover:bg-[#fbbf24] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Accepting…' : 'Accept'}
        </button>
      );
    }
  } else if (countdownRemaining > 0) {
    eyebrow = isShared ? 'Shared Consent' : 'Private Consent';
    title = 'Get ready to say "I agree"';
    body = isShared
      ? 'Both users will need to say "I agree" when the countdown ends.'
      : 'Recite "I agree" when the countdown ends to unlock the data.';
    countdown = (
      <div className="mt-6 h-24 w-24 rounded-full border border-[#f59e0b]/40 bg-[#1b2434] flex items-center justify-center text-4xl font-bold text-[#f8fafc] shadow-[0_0_30px_rgba(245,158,11,0.18)]">
        {countdownRemaining}
      </div>
    );
  } else if (unlockStatus === 'error') {
    // error state — handled below via ErrorPill, just set eyebrow
    eyebrow = isShared ? 'Shared Consent' : 'Private Consent';
    title = 'Verification failed';
    body = '';
  } else if (complete) {
    eyebrow = 'Unlocked';
    title = 'Consent received ✓';
    body = isShared
      ? 'Both partners agreed. The shared data is now unlocked.'
      : 'Consent received. Your data is now unlocked.';
  } else if (unlockStatus === 'waiting_partner') {
    eyebrow = 'Shared Consent';
    title = 'Your voice was recorded';
    body = 'Waiting for your partner to also say "I agree".';
  } else if (isShared && (request.status === 'recording' || isActivelyProcessing) && !currentUserAgreed) {
    eyebrow = 'Shared Consent';
    title = 'Say "I agree" now';
    body = 'Recording is active — speak clearly into your microphone.';
    showMicRing = true;
  } else if (isShared && partnerAgreed && !currentUserAgreed && !isActivelyProcessing) {
    eyebrow = 'Shared Consent';
    title = 'Your partner already agreed';
    body = 'Recording will start automatically. Get ready to say "I agree".';
    showMicRing = true;
  } else if (isShared && !currentUserAgreed && !isActivelyProcessing && unlockStatus !== 'error') {
    eyebrow = 'Shared Consent';
    title = 'Get ready to say "I agree"';
    body = 'Recording will start automatically when the countdown ends.';
    showMicRing = true;
  } else if (!isShared && !isActivelyProcessing && unlockStatus !== 'error') {
    eyebrow = 'Private Consent';
    title = 'Say "I agree" now';
    body = 'Speak clearly. We are verifying that the voice saying "I agree" is yours.';
    showMicRing = true;
  }

  const statusConfig = unlockStatus && unlockStatus !== 'error' && unlockStatus !== 'declined'
    ? STATUS_CONFIG[unlockStatus]
    : null;

  // Decline button label changes based on current stage
  const declineLabelMap = {
    recording:       'Cancel & decline',
    uploading:       'Cancel & decline',
    verifying:       'Cancel & decline',
    waiting_partner: 'Cancel & decline',
  };
  const declineLabel = declineLabelMap[unlockStatus] ?? 'Decline';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#04070d]/75 backdrop-blur-md px-5">
      <div className="flex flex-col items-center justify-center w-full max-w-sm rounded-[2rem] border border-[#2b3448] bg-[linear-gradient(180deg,#111827_0%,#0b1220_100%)] shadow-[0_24px_80px_rgba(0,0,0,0.55)] px-6 py-8 text-center text-[#f8fafc]">

        <p className="text-[11px] uppercase tracking-[0.35em] text-[#94a3b8] font-semibold">{eyebrow}</p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-[#cbd5e1]">{body}</p>

        {/* Countdown circle */}
        {countdown}

        {/* Mic ring while idle / ready */}
        {!countdown && showMicRing && !isActivelyProcessing && <MicRing />}

        {/* CTA button */}
        {!countdown && cta && (
          <div className="flex flex-col items-center">
            {cta}
          </div>
        )}

        {/* Step status pill (recording / uploading / verifying / waiting) */}
        {statusConfig && (
          <StepPill
            icon={statusConfig.icon}
            label={statusConfig.label}
            sublabel={statusConfig.sublabel}
            color={statusConfig.color}
            bg={statusConfig.bg}
            border={statusConfig.border}
          />
        )}

        {/* Error pill */}
        {unlockStatus === 'error' && verifyError && (
          <ErrorPill message={verifyError} onDismiss={onDismissError} />
        )}

        {/* Hint — only while actively waiting / processing */}
        {!complete && unlockStatus !== 'error' && (
          <p className="mt-5 text-[11px] leading-5 text-[#475569]">
            Keep this screen open and speak when prompted.
          </p>
        )}

        {/* Close button — shown after terminal states (error, complete) */}
        {(complete || unlockStatus === 'error') && onDismiss && (
          <button
            onClick={onDismiss}
            className="mt-5 px-5 py-2 rounded-full border border-[#2b3448] text-[12px] text-[#8892a4] hover:text-[#f8fafc] hover:border-[#4b5368] transition-colors"
          >
            Close
          </button>
        )}

        {/* Decline button — always visible while request is still active */}
        {!complete && unlockStatus !== 'error' && onDecline && (
          <DeclineButton
            onDecline={onDecline}
            isSubmitting={isSubmitting && !isActivelyProcessing}
            label={declineLabel}
          />
        )}
      </div>
    </div>
  );
}