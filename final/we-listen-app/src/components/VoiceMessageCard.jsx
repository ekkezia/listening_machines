import { useState, useRef, useEffect } from 'react';

function LockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 15v2m-6 0h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0
        00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

export default function VoiceMessageCard({ message, isUnlocked }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const time = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '--:--';

  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      // Pause all other audios
      window.dispatchEvent(new CustomEvent('pauseAllAudio'));
      audioRef.current.play();
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  // Stop playing when audio ends
  useEffect(() => {
    if (!audioRef.current) return;
    const handleEnded = () => setIsPlaying(false);
    audioRef.current.addEventListener('ended', handleEnded);
    return () => audioRef.current.removeEventListener('ended', handleEnded);
  }, []);

  // Listen for global pause event
  useEffect(() => {
    const pauseListener = () => {
      if (isPlaying) {
        setIsPlaying(false);
      }
    };
    window.addEventListener('pauseAllAudio', pauseListener);
    return () => window.removeEventListener('pauseAllAudio', pauseListener);
  }, [isPlaying]);

  return (
    <div className={`rounded-xl border transition-all duration-300 overflow-hidden
      ${isUnlocked
        ? 'bg-[#1c2030] border-[#7c3aed]/40 shadow-[0_0_12px_rgba(124,58,237,0.1)]'
        : 'bg-[#141824] border-[#2a2f42]'}`
    }>
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
            {
                isUnlocked &&
                <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`cursor-pointer flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold transition-all
              ${isPlaying
                ? 'bg-[#7c3aed] text-white shadow-[0_0_10px_rgba(124,58,237,0.4)]'
                : 'bg-[#7c3aed]/10 text-[#7c3aed] border border-[#7c3aed]/30 hover:bg-[#7c3aed]/20'
              }`
            }
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
            {/* {isPlaying ? 'Pause' : 'Play'} */}
          </button>
            }
          {isUnlocked
            ? <span className="text-[10px] font-semibold text-[#7c3aed] uppercase tracking-widest">Unlocked</span>
            : <span className="text-[10px] font-semibold text-[#4b5368] uppercase tracking-widest flex items-center gap-1"><LockIcon />Locked</span>
          }
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#4b5368]">
          <span>{time}</span>
          <span>·</span>
          <span>{message.duration ?? 0}s</span>
        </div>
      </div>

      {isUnlocked ? (
        <div className="px-3 pb-3">
          <p className="text-[13px] text-[#b8c0d8] leading-relaxed mb-3 mt-1">
            {message.transcription}
          </p>
          <audio
            ref={audioRef}
            src={message.data || ''}
            preload="auto"
            style={{ display: 'none' }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center py-4 gap-2 text-[#2a2f42]">
          <LockIcon />
          <span className="text-[11px] text-[#3a4155]">Say "listen to me" or "listen to us" to unlock</span>
        </div>
      )}
    </div>
  );
}
