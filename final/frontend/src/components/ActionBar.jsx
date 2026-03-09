import Soundwave from './Soundwave';

const STATE_CONFIG = {
  idle:      { bg: 'bg-[#0d1117]', border: 'border-[#21273a]', label: 'Listening for commands', dot: 'bg-[#8892a4]' },
  recording: { bg: 'bg-[#2d0a0a]', border: 'border-[#ef4444]/40', label: 'Recording...', dot: 'bg-[#ef4444] animate-ping' },
  uploading: { bg: 'bg-[#0d1a2d]', border: 'border-[#3b82f6]/40', label: 'Saving...', dot: 'bg-[#3b82f6] animate-pulse' },
  matching:  { bg: 'bg-[#2d1f00]', border: 'border-[#f59e0b]/40', label: 'Matching voice...', dot: 'bg-[#f59e0b] animate-pulse' },
  matched:   { bg: 'bg-[#062015]', border: 'border-[#10b981]/40', label: 'Voice matched!', dot: 'bg-[#10b981]' },
};

function MicIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 3a4 4 0 00-4 4v4a4 4 0 008 0V7a4 4 0 00-4-4z" />
    </svg>
  );
}

export default function ActionBar({
  recordingState, isUnlocked, lockCountdown, isHearing,
  verifying, verifyError,
  onStopRecording, onStartRecording,
  activeTab, partnerId,
}) {
  const config = STATE_CONFIG[recordingState] || STATE_CONFIG.idle;
  const isRecording = recordingState === 'recording';
  const isUploading = recordingState === 'uploading';

  // Which type to record depends on the active tab
  const recordType = activeTab === 'us' ? 'shared' : 'private';
  // Disable "record for us" button if no partner
  const canRecordUs = activeTab !== 'us' || !!partnerId;

  const unlocking = isUnlocked && lockCountdown > 0;
  return (
    <div className={`${config.bg} border-t ${config.border} px-4 pt-3 pb-3 transition-all duration-500`}>
      {/* Status + lock row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full inline-block ${isUnlocked ? 'bg-[#8892a4]' : config.dot}`} />
          <span className="text-[11px] text-[#8892a4] font-medium tracking-wide flex items-center gap-2">
            {verifying ? 'Verifying voice…' : unlocking ? (
              <>
                {`Auto-locking in ${lockCountdown}s…`}
                <button
                  className="cursor-pointer flex items-center justify-center ml-1 px-2 py-1 rounded-full bg-[#ef4444]/10 hover:bg-[#ef4444]/20 text-[#ef4444] text-[10px] font-semibold border border-[#ef4444]/30 transition"
                  aria-label="Force lock"
                  onClick={() => window.dispatchEvent(new CustomEvent('forceLock', {}))}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 0h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Lock
                </button>
              </>
            ) : config.label}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isRecording ? (
            /* Stop button */
            <button
              onClick={onStopRecording}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                bg-[#ef4444]/20 border border-[#ef4444]/40 text-[#ef4444]
                text-[10px] font-semibold hover:bg-[#ef4444]/30 transition-all">
              <span className="w-2 h-2 rounded-sm bg-[#ef4444] inline-block" />
              Stop
            </button>
          ) : (
            <>
              {/* Record button — also disabled while uploading */}
              <button
                onClick={() => onStartRecording(recordType)}
                disabled={verifying || !canRecordUs || unlocking || isUploading}
                className="cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                  bg-[#7c3aed]/20 border border-[#7c3aed]/40 text-[#7c3aed]
                  text-[10px] font-semibold hover:bg-[#7c3aed]/30
                  disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                <MicIcon />
                {isUploading ? 'Saving…' : activeTab === 'us' ? 'Record for us' : 'Record for me'}
              </button>

              {/* Lock indicator */}
              {isUnlocked ? (
                <span className="text-[10px] text-[#10b981] font-semibold flex items-center gap-1">
                  🔓 Unlocked
                </span>
              ) : (
                <span className="text-[10px] text-[#4b5368] font-semibold flex items-center gap-1">
                  🔒 Locked
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Verify error */}
      {verifyError && (
        <p className="text-[10px] text-[#ef4444] mb-1.5">{verifyError}</p>
      )}

      <Soundwave isActive={!unlocking && !isUnlocked} />

      {!isUnlocked && <div className="text-xs text-[#7c3aed] text-center py-2">Voice commands are active.</div>}
      {isUnlocked && <div className="text-xs text-[#4b5368] text-center py-2">Voice commands are disabled while unlocked.</div>}

    </div>
  );
}