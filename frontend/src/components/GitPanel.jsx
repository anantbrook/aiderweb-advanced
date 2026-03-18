import { useState } from 'react'

export default function GitPanel({ data }) {
  const [commitMsg, setCommitMsg] = useState('')
  const [working, setWorking] = useState(false)

  if (!data) return null
  const statusLines = (data.status || '').split('\n').filter(Boolean)
  const logLines = (data.log || '').split('\n').filter(Boolean)
  const clr = s => s === 'M' ? 'text-yellow' : s === '?' ? 'text-red' : s === 'A' ? 'text-green' : 'text-gray-400'

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    setWorking(true)
    try {
        const r = await fetch('/api/git/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: data.path || '.', message: commitMsg })
        })
        const d = await r.json()
        if (d.ok) setCommitMsg('')
        else alert('Commit failed: ' + d.error)
    } finally {
        setWorking(false)
        // Parent App.jsx will naturally poll git data, but we could trigger an explicit reload here
    }
  }

  const handlePush = async () => {
      setWorking(true)
      try {
          const r = await fetch(`/api/git/push?path=${encodeURIComponent(data.path || '.')}`, { method: 'POST' })
          const d = await r.json()
          if (!d.ok) alert('Push failed: ' + d.error)
      } finally {
          setWorking(false)
      }
  }

  return (
    <div className="border-t border-border bg-bg0 max-h-[300px] overflow-y-auto flex-shrink-0 flex flex-col">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
           <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Git</span>
           {data.branch && <span className="text-xs text-accent bg-accent/10 px-1.5 py-0.5 rounded">⎇ {data.branch}</span>}
        </div>
        <button disabled={working} onClick={handlePush} className="text-[10px] bg-bg2 border border-border px-1.5 py-0.5 rounded hover:bg-bg3 hover:text-white disabled:opacity-50">Push</button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
      {statusLines.length > 0 && (
        <div className="px-3 py-1">
          <div className="text-xs text-gray-600 mb-0.5">Changes</div>
          {statusLines.map((l, i) => (
            <div key={i} className={`text-xs font-mono py-0.5 ${clr(l[0])}`}>
              <span className="opacity-60 mr-1">{l[0]}</span>{l.slice(3)}
            </div>
          ))}
        </div>
      )}
      {logLines.length > 0 && (
        <div className="px-3 py-1 border-t border-border">
          <div className="text-xs text-gray-600 mb-0.5">Commits</div>
          {logLines.map((l, i) => (
            <div key={i} className="text-xs font-mono text-gray-400 py-0.5 truncate">{l}</div>
          ))}
        </div>
      )}
      {!statusLines.length && !logLines.length && (
        <div className="px-3 py-2 text-xs text-gray-600">No git info</div>
      )}
      </div>

      <div className="p-2 bg-bg1 border-t border-border flex-shrink-0">
          <input 
             type="text" 
             value={commitMsg}
             onChange={e => setCommitMsg(e.target.value)}
             placeholder="Commit message..."
             className="w-full bg-bg2 border border-border text-xs px-2 py-1 rounded outline-none focus:border-accent text-white mb-1"
             onKeyDown={e => e.key === 'Enter' && handleCommit()}
             disabled={working}
          />
          <button disabled={working || !commitMsg.trim()} onClick={handleCommit} className="w-full bg-accent/20 border border-accent/50 text-accent text-xs py-1 rounded hover:bg-accent hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              Commit All
          </button>
      </div>
    </div>
  )
}
