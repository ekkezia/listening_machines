export default function TabBar({ activeTab, setActiveTab, partnerId, userId }) {
  return (
    <div className="flex border-b border-[#21273a] bg-[#0d1117]">
      {['us', 'me'].map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`flex-1 py-3 text-[13px] font-semibold tracking-wide transition-all relative
            ${activeTab === tab
              ? 'text-white'
              : 'text-[#4b5368] hover:text-[#8892a4]'
            }`}
        >
          {tab === 'us'
            ? <div className="cursor-pointer">
                <span className="text-[11px] text-[#4b5368] block font-normal">
                  {partnerId ? `with ${partnerId}` : 'no partner yet'}
                </span>
                {partnerId ? 'Us' : 'Us?'}
              </div>
            : <div className="cursor-pointer">
                <span className="text-[11px] text-[#4b5368] block font-normal">{userId}</span>
                Me
              </div>
          }
          {activeTab === tab && (
            <span className="absolute bottom-0 left-1/4 right-1/4 h-[2px] bg-[#7c3aed] rounded-full" />
          )}
        </button>
      ))}

      <div className="flex items-center pr-3">
        <span className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.7)]" title="Listening for commands" />
      </div>
    </div>
  );
}
