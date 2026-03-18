import { useState, useEffect } from 'react'

export default function DiffViewer({ project }) {
    const [diff, setDiff] = useState('')
    
    useEffect(() => {
        if (!project) return
        fetch(`/api/git/diff?path=${encodeURIComponent(project.path)}`)
            .then(r => r.json())
            .then(d => setDiff(d.diff || 'No unstaged changes.'))
            .catch(() => setDiff('Error loading diff.'))
    }, [project])
    
    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] border-t border-border border-l font-mono text-xs overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#2d2d2d] border-b border-border shadow">
               <span className="text-gray-300 flex items-center gap-2"><span>🔍</span> Unstaged Git Changes</span>
               <button onClick={() => setDiff('')} className="text-gray-500 hover:text-white" title="Refresh">↻</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 text-gray-300 leading-relaxed selection:bg-accent/30 whitespace-pre">
               {diff.split('\n').map((line, i) => {
                   if (line.startsWith('+')) return <div key={i} className="text-green-400 bg-green-900/20 px-1">{line}</div>
                   if (line.startsWith('-')) return <div key={i} className="text-red-400 bg-red-900/20 px-1">{line}</div>
                   if (line.startsWith('@@')) return <div key={i} className="text-blue-400 px-1">{line}</div>
                   return <div key={i} className="px-1">{line}</div>
               })}
            </div>
        </div>
    )
}
