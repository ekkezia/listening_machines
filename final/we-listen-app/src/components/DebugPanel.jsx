const dispatch = (cmd) =>
  window.dispatchEvent(new CustomEvent('voiceCommand', { detail: cmd }));

const cmds = [
  { label: 'record me',       color: 'bg-[#7f1d1d] text-[#fca5a5] border-[#ef4444]/30' },
  { label: 'record for us',   color: 'bg-[#7f1d1d] text-[#fca5a5] border-[#ef4444]/30' },
  { label: 'listen to me',    color: 'bg-[#78350f] text-[#fcd34d] border-[#f59e0b]/30' },
  { label: 'listen to us',    color: 'bg-[#78350f] text-[#fcd34d] border-[#f59e0b]/30' },
  { label: 'i agree',         color: 'bg-[#052e2b] text-[#99f6e4] border-[#14b8a6]/30' },
];

export default function DebugPanel() {
  return (
    <div className="border-t border-[#21273a] bg-[#0a0d14] px-3 py-2">
      <p className="text-[9px] text-[#2a2f42] uppercase tracking-widest mb-1.5 font-semibold">Dev — simulate voice</p>
      <div className="flex flex-wrap gap-1">
        {cmds.map(cmd => (
          <button
            key={cmd.label}
            onClick={() => dispatch(cmd.label)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono border transition-opacity hover:opacity-80 ${cmd.color}`}
          >
            "{cmd.label}"
          </button>
        ))}
      </div>
    </div>
  );
}
