import { useState, useEffect } from 'react'

const ICONS = {
  '.js':'📜','.jsx':'⚛','.ts':'📘','.tsx':'⚛','.py':'🐍',
  '.html':'🌐','.css':'🎨','.scss':'🎨','.json':'📋','.md':'📝',
  '.txt':'📄','.sh':'⚡','.bat':'⚡','.env':'🔑',
  '.png':'🖼','.jpg':'🖼','.svg':'🖼',
  '.sql':'🗄','.toml':'⚙','.yaml':'⚙','.yml':'⚙',
}

function Node({ item, depth, root, selectedFiles, setSelectedFiles }) {
  const [open, setOpen] = useState(depth < 1)
  const [children, setChildren] = useState([])
  const [loaded, setLoaded] = useState(false)

  const toggle = async () => {
    if (!item.isDir) return
    if (!loaded) {
      const r = await fetch(`/api/fs/list?path=${encodeURIComponent(item.path)}`)
      const d = await r.json()
      setChildren(d.items || [])
      setLoaded(true)
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (item.isDir && depth < 1 && !loaded) {
      fetch(`/api/fs/list?path=${encodeURIComponent(item.path)}`)
        .then(r => r.json()).then(d => { setChildren(d.items || []); setLoaded(true) })
        .catch(() => {})
    }
  }, [])

  const [contextMenu, setContextMenu] = useState(false)
  const [actionFile, setActionFile] = useState('')

  const icon = item.isDir ? (open ? '📂' : '📁') : (ICONS[item.ext] || '📄')
  const relPath = item.path.replace(root, '').replace(/^[/\\]/, '')
  const isSelected = selectedFiles?.includes(relPath)
  
  const handleAction = async (action) => {
      setContextMenu(false)
      let url = '/api/fs/' + action
      let body = { path: item.path }
      
      if (action === 'delete') {
          if (!confirm(`Delete ${item.name}?`)) return
          await fetch(url + '?path=' + encodeURIComponent(item.path), { method: 'DELETE' })
      } else if (action === 'rename') {
          const newName = prompt('New name:', item.name)
          if (!newName || newName === item.name) return
          // construct new path replacing old name
          const newPath = item.path.replace(item.name, newName)
          body.new_path = newPath
          await fetch(url, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
      } else if (action === 'create') {
          const newName = prompt('New file name (include extension):')
          if (!newName) return
          body.path = item.path + (item.isDir ? '/' : '/../') + newName
          await fetch(url, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
      }
      
      // Need a way to refresh, we will dispatch an event for App to re-trigger FileTree load
      window.dispatchEvent(new CustomEvent('refresh_fs'))
  }

  const handleSelect = (e) => {
    e.stopPropagation()
    if (item.isDir) return toggle()
    
    setSelectedFiles(prev => {
        if (prev.includes(relPath)) return prev.filter(p => p !== relPath)
        return [...prev, relPath]
    })
  }
  
  const handleView = (e) => {
      e.stopPropagation()
      if (item.isDir) return toggle()
      
      // Dispatch custom event that App.jsx will catch to show inline file viewer
      const ev = new CustomEvent('open_file', { detail: { path: item.path, name: item.name } })
      window.dispatchEvent(ev)
  }

  return (
    <div>
      <div
        onClick={handleView}
        onContextMenu={e => { e.preventDefault(); setContextMenu(true) }}
        onMouseLeave={() => setContextMenu(false)}
        className={`relative flex items-center gap-1.5 py-0.5 text-xs rounded transition-colors cursor-pointer group
          ${isSelected ? 'bg-accent/20 text-accent' : item.isDir ? 'text-gray-300 hover:text-white hover:bg-bg3' : 'text-gray-400 hover:text-white hover:bg-bg3'}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="text-sm flex-shrink-0">{icon}</span>
        <span className="truncate flex-1">{item.name}</span>
        {!item.isDir && (
            <div onClick={handleSelect} className={`w-4 h-4 rounded border mr-2 flex items-center justify-center transition-colors
                ${isSelected ? 'border-accent bg-accent text-bg0' : 'border-border group-hover:border-gray-500'}`} title="Include in AI context">
                {isSelected && '✓'}
            </div>
        )}
        
        {/* Context Menu */}
        {contextMenu && (
            <div className="absolute left-full top-0 ml-1 z-50 bg-bg1 border border-border rounded shadow-lg flex flex-col py-1 w-24">
               {item.isDir && <button onClick={(e) => { e.stopPropagation(); handleAction('create') }} className="text-left px-2 py-1 text-gray-300 hover:bg-bg2 hover:text-white">New File</button>}
               <button onClick={(e) => { e.stopPropagation(); handleAction('rename') }} className="text-left px-2 py-1 text-gray-300 hover:bg-bg2 hover:text-white">Rename</button>
               <button onClick={(e) => { e.stopPropagation(); handleAction('delete') }} className="text-left px-2 py-1 text-red-400 hover:bg-red-500/20">Delete</button>
            </div>
        )}
      </div>
      {open && item.isDir && children.map(c => (
        <Node key={c.path} item={c} depth={depth + 1} root={root} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} />
      ))}
    </div>
  )
}

export default function FileTree({ root, selectedFiles, setSelectedFiles }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    fetch(`/api/fs/list?path=${encodeURIComponent(root)}`)
      .then(r => r.json()).then(d => setItems(d.items || []))
      .catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => {
     load()
     const onRef = () => load()
     window.addEventListener('refresh_fs', onRef)
     return () => window.removeEventListener('refresh_fs', onRef)
  }, [root])

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <div className="spinner w-4 h-4 border-2 border-border border-t-accent rounded-full" />
    </div>
  )

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-2 py-1 mb-1">
        <span className="text-xs text-gray-600 italic">Select files for context</span>
        <div className="flex items-center gap-1">
           <button onClick={() => {
               const newName = prompt('New file name (e.g. src/utils.js):')
               if (newName) fetch('/api/fs/create', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({path: root + '/' + newName})}).then(load)
           }} className="text-xs text-gray-500 hover:text-white px-1 transition-colors" title="New File">+</button>
           <button onClick={load} className="text-xs text-gray-500 hover:text-white px-1 transition-colors" title="Refresh">↻</button>
        </div>
      </div>
      
      {/* Global Search Bar */}
      <div className="px-2 mb-2">
         <input type="text" placeholder="Search files..." className="w-full bg-bg2 border border-border text-xs px-2 py-1 rounded text-white outline-none focus:border-accent"
           onKeyDown={e => {
               if (e.key === 'Enter') {
                   const q = e.target.value
                   if (!q) return
                   fetch(`/api/fs/search?path=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}`)
                      .then(r => r.json())
                      .then(d => {
                          if (d.results) {
                              const list = d.results.map(r => `File: ${r.file}\nLine ${r.line}: ${r.text}`).join('\n\n')
                              if (list) {
                                  // Hacky quick display of search results
                                  const ev = new CustomEvent('open_file', { detail: { path: root, name: `Search: ${q}`, content: list } })
                                  window.dispatchEvent(ev)
                              } else {
                                  alert('No results found')
                              }
                          }
                      })
               }
           }}
         />
      </div>
      {items.map(item => <Node key={item.path} item={item} depth={0} root={root} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} />)}
    </div>
  )
}
