import { useMic } from '../context/MicContext';

function MicSlashIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
        d="M12 1a4 4 0 00-4 4v6a4 4 0 008 0V5a4 4 0 00-4-4z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7}
        d="M19 11a7 7 0 01-14 0M12 18v4M8 22h8" />
      <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" strokeWidth={1.7} />
    </svg>
  );
}

export default function MicPermissionOverlay() {
  const { openMic, permissionState } = useMic();

  const isDenied = permissionState === 'denied';

  const handleAllow = () => {
    openMic({ force: true });
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4
      bg-[#0d1117]/85 backdrop-blur-sm px-6">

      <div className="w-16 h-16 rounded-2xl bg-[#ef4444]/10 border border-[#ef4444]/30
        flex items-center justify-center">
        <MicSlashIcon className="w-8 h-8 text-[#ef4444]" />
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold text-[#f0f6fc]">Microphone access required</p>
        <p className="text-[11px] text-[#4b5368] mt-1.5 leading-relaxed">
          {isDenied
            ? 'Your browser has blocked microphone access for this site.'
            : 'We Listen needs your microphone for voice commands and recording.'}
        </p>
      </div>

      {isDenied ? (
        <div className="w-full space-y-3">
          <div className="bg-[#1c2030] rounded-xl border border-[#2a2f42] px-4 py-3 space-y-2 text-[11px] text-[#8892a4] leading-relaxed">
            <p className="font-semibold text-[#b8c0d8]">How to fix:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Click the <span className="font-mono bg-[#0d1117] px-1 rounded">🔒</span> icon in the browser address bar</li>
              <li>Find <span className="italic">Microphone</span> and set it to <span className="text-[#10b981]">Allow</span></li>
              <li>Refresh the page, then click <span className="italic">Check again</span> below</li>
            </ol>
          </div>
          <button
            onClick={handleAllow}
            className="w-full py-2.5 rounded-xl bg-[#1c2030] hover:bg-[#21273a] border
              border-[#2a2f42] hover:border-[#3a4155] text-[#b8c0d8] text-sm font-semibold
              transition-all">
            Check again
          </button>
        </div>
      ) : (
        <button
          onClick={handleAllow}
          className="w-full py-2.5 rounded-xl bg-[#7c3aed] hover:bg-[#6d28d9] text-white
            text-sm font-semibold transition-all shadow-[0_0_20px_rgba(124,58,237,0.35)]
            hover:shadow-[0_0_28px_rgba(124,58,237,0.5)]">
          Allow microphone
        </button>
      )}
    </div>
  );
}
