const isUnlockRequestComplete = (request) => {
  if (!request) return false;
  if (request.kind === 'private') return request.status === 'unlocked' || !!request.requesterAgreedAt;
  return request.status === 'unlocked' || (!!request.requesterAgreedAt && !!request.partnerAgreedAt);
};

export default function UnlockConsentOverlay({
  request,
  currentUserId,
  countdownRemaining,
  isSubmitting,
  onAcceptSharedRequest,
}) {
  if (!request) return null;

  const isShared = request.kind === 'shared';
  const isRequester = request.requesterId === currentUserId;
  const currentUserAgreed = isRequester ? request.requesterAgreedAt : request.partnerAgreedAt;
  const partnerAgreed = isRequester ? request.partnerAgreedAt : request.requesterAgreedAt;
  const complete = isUnlockRequestComplete(request);

  let eyebrow = 'Unlock';
  let title = 'Say "I agree"';
  let body = 'Recite "I agree" to unlock the data.';
  let cta = null;
  let countdown = null;

  if (isShared && request.status === 'pending_partner') {
    eyebrow = 'Shared Unlock';
    if (isRequester) {
      title = 'Waiting for your partner';
      body = 'Waiting for the other partner to accept the unlocking request.';
    } else {
      title = 'Unlock request received';
      body = `${request.requesterName || 'Your partner'} wants to unlock the shared data with you.`;
      cta = (
        <button
          onClick={onAcceptSharedRequest}
          disabled={isSubmitting}
          className="px-4 py-2 rounded-full bg-[#f59e0b] text-[#111827] text-sm font-semibold hover:bg-[#fbbf24] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Accepting...' : 'Accept'}
        </button>
      );
    }
  } else if (countdownRemaining > 0) {
    eyebrow = isShared ? 'Shared Consent' : 'Consent';
    title = 'Get ready to say "I agree"';
    body = isShared
      ? 'Both users will need to recite "I agree" when the cue ends.'
      : 'Recite "I agree" when the countdown ends to unlock the data.';
    countdown = (
      <div className="mt-6 h-24 w-24 rounded-full border border-[#f59e0b]/40 bg-[#1b2434] flex items-center justify-center text-4xl font-bold text-[#f8fafc] shadow-[0_0_30px_rgba(245,158,11,0.18)]">
        {countdownRemaining}
      </div>
    );
  } else if (complete) {
    eyebrow = 'Unlocked';
    title = 'Consent received';
    body = isShared
      ? 'Both partners agreed. The shared data is now unlocked.'
      : 'Consent received. The data is now unlocked.';
  } else if (isShared && currentUserAgreed) {
    eyebrow = 'Shared Consent';
    title = 'Waiting for your partner';
    body = 'Your "I agree" was recorded. Waiting for the other partner to agree.';
  } else if (isShared && partnerAgreed) {
    eyebrow = 'Shared Consent';
    title = 'Your partner already agreed';
    body = 'Say "I agree" now to finish unlocking the shared data.';
  } else if (isShared) {
    eyebrow = 'Shared Consent';
    title = 'Say "I agree" now';
    body = 'Both partners should recite "I agree" now to unlock the shared data.';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#04070d]/75 backdrop-blur-md px-5">
      <div className="flex flex-col items-center justify-center w-full max-w-sm rounded-[2rem] border border-[#2b3448] bg-[linear-gradient(180deg,#111827_0%,#0b1220_100%)] shadow-[0_24px_80px_rgba(0,0,0,0.55)] px-6 py-8 text-center text-[#f8fafc]">
        <p className="text-[11px] uppercase tracking-[0.35em] text-[#94a3b8] font-semibold">{eyebrow}</p>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-[#cbd5e1]">{body}</p>

        {countdown}

        {!countdown && (
          <div className="mt-6 flex items-center justify-center">
            {cta}
          </div>
        )}

        <p className="mt-6 text-[11px] leading-5 text-[#94a3b8]">
          Keep this screen open and use your voice when prompted.
        </p>
      </div>
    </div>
  );
}
