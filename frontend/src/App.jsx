import { useState, useEffect, useRef } from 'react'
import FileTree from './components/FileTree'
import AgentChat from './components/AgentChat'
import Terminal from './components/Terminal'
import GitPanel from './components/GitPanel'
import ProjectPicker from './components/ProjectPicker'
import Settings from './components/Settings'
import DiffViewer from './components/DiffViewer'

import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/themes/prism-tomorrow.css'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'


export default function App() {
  const [projects, setProjects]         = useState([])
  const [activeTab, setActiveTab]       = useState(0)
  const [cloudModels, setCloudModels]   = useState([])
  const [selectedFiles, setSelectedFiles] = useState([]) // For explicitly included context
  const [localModels, setLocalModels]   = useState([])
  const [model, setModel]               = useState('ollama/deepseek-coder-v2:236b')
  const [ollamaOnline, setOllamaOnline] = useState(false)
  const [showTerminal, setShowTerminal] = useState(true)
  const [showFiles, setShowFiles]       = useState(true)
  const [showGit, setShowGit]           = useState(false)
  const [showDiff, setShowDiff]         = useState(false)
  const [showPicker, setShowPicker]     = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [gitData, setGitData]           = useState(null)
  const [projectStats, setProjectStats] = useState(null)
  const [sidebarW, setSidebarW]         = useState(220)
  const [fileViewer, setFileViewer]     = useState(null)
  const [mobileMenu, setMobileMenu]     = useState(false)
  const resizing = useRef(false)

  const project = projects[activeTab] || null

  // Load saved projects once on mount
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (Array.isArray(d) && d.length > 0) setProjects(d)
    }).catch(() => {})
  }, [])

  // Poll Ollama status + model list every 10s
  useEffect(() => {
    const check = () =>
      fetch('/api/models').then(r => r.json()).then(d => {
        setOllamaOnline(d.online !== false)
        setCloudModels(d.cloud || [])
        setLocalModels(d.local  || [])
        // Auto-select first cloud model if current model is a local one
        const firstCloud = (d.cloud || [])[0]
        if (firstCloud && !model.includes('cloud')) {
          setModel(`ollama/${firstCloud}`)
        }
      }).catch(() => setOllamaOnline(false))
    check()
    const t = setInterval(check, 10000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist projects list to backend
  useEffect(() => {
    if (projects.length > 0) {
      fetch('/api/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(projects),
      }).catch(() => {})
    }
  }, [projects])

  // Load git + stats whenever the active project changes
  useEffect(() => {
    if (!project) { setGitData(null); setProjectStats(null); setSelectedFiles([]); return }
    
    const loadGit = () => fetch(`/api/git/status?path=${encodeURIComponent(project.path)}`).then(r => r.json()).then(setGitData).catch(() => {})
    const loadScan = () => fetch(`/api/scan?path=${encodeURIComponent(project.path)}`).then(r => r.json()).then(setProjectStats).catch(() => {})
    
    loadGit()
    loadScan()
    setSelectedFiles([]) // Reset context on project switch
    
    window.addEventListener('refresh_git', loadGit)
    return () => window.removeEventListener('refresh_git', loadGit)
  }, [project?.path])

  const [showShortcuts, setShowShortcuts] = useState(false)

  // Sidebar resize listeners, File Viewer, & Shortcuts
  useEffect(() => {
    const onMove = e => { if (resizing.current) setSidebarW(Math.max(160, Math.min(480, e.clientX))) }
    const onUp   = () => { resizing.current = false; document.body.style.cursor = '' }
    
    const onOpenFile = (e) => {
        setFileViewer({ path: e.detail.path, name: e.detail.name, content: 'Loading...' })
        fetch(`/api/fs/read?path=${encodeURIComponent(e.detail.path)}`)
            .then(r => r.json())
            .then(d => {
                if (d.content !== undefined) setFileViewer(fv => fv ? { ...fv, content: d.content } : null)
                else setFileViewer(fv => fv ? { ...fv, content: 'Error loading file' } : null)
            })
    }
    
    window.addEventListener('mousemove', onMove)
    const onKey = e => {
       if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
           e.preventDefault()
           setShowShortcuts(s => !s)
       }
    }
    
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    window.addEventListener('open_file', onOpenFile)
    window.addEventListener('keydown', onKey)
    
    return () => { 
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp) 
        window.removeEventListener('open_file', onOpenFile)
        window.removeEventListener('keydown', onKey)
    }
  }, [])

  const openProject = p => {
    const idx = projects.findIndex(x => x.path === p.path)
    if (idx >= 0) { setActiveTab(idx); setShowPicker(false); return }
    const next = [...projects, p]
    setProjects(next)
    setActiveTab(next.length - 1)
    setShowPicker(false)
  }

  const removeProject = (i, e) => {
    e.stopPropagation()
    const next = [...projects]
    next.splice(i, 1)
    setProjects(next)
    setActiveTab(Math.min(activeTab, Math.max(0, next.length - 1)))
  }

  const refreshModels = () =>
    fetch('/api/models').then(r => r.json()).then(d => {
      setCloudModels(d.cloud || [])
      setLocalModels(d.local  || [])
    })

  const isLocal = !model.includes('cloud') && model !== ''

  return (
    <div className="flex flex-col h-screen bg-bg0 overflow-hidden select-none">

      {/* ── TITLE BAR ──────────────────────────── */}
      <div className="h-10 flex items-center gap-2 px-3 bg-bg1 border-b border-border flex-shrink-0 z-20">
        <span className="text-accent text-xl">⬡</span>
        <span className="font-bold text-sm text-white mr-1">AiderWeb</span>

        {/* Project tabs */}
        <div className="flex items-end gap-0.5 flex-1 h-full overflow-x-auto">
          {projects.map((p, i) => (
            <div key={i}
              onClick={() => { setActiveTab(i); setProjectStats(null); setGitData(null) }}
              className={`relative flex items-center gap-1.5 px-3 h-8 mt-2 rounded-t border border-b-0
                cursor-pointer text-xs whitespace-nowrap group flex-shrink-0 transition-all
                ${i === activeTab
                  ? 'bg-bg0 border-border text-white'
                  : 'bg-bg2 border-border/40 text-gray-400 hover:text-white hover:bg-bg3'}`}>
              <span>📁</span>
              <span>{p.name}</span>
              <button onClick={e => removeProject(i, e)}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red ml-0.5">✕</button>
              {i === activeTab && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />}
            </div>
          ))}
          <button onClick={() => setShowPicker(true)}
            className="flex items-center justify-center w-7 h-7 mt-2 rounded border border-border
              text-gray-400 hover:text-white hover:bg-bg3 hover:border-accent/50 text-lg transition-all flex-shrink-0"
            title="Open project">+</button>
        </div>

        {/* Mobile Hamburger */}
        <button className="md:hidden ml-auto text-gray-400" onClick={() => setMobileMenu(m => !m)}>☰</button>

        {/* Right-side controls */}
        <div className={`flex items-center gap-2 flex-shrink-0 ${mobileMenu ? 'absolute top-10 left-0 right-0 bg-bg1 border-b border-border p-3 flex-wrap shadow-lg z-50' : 'hidden md:flex'}`}>

          {/* File count + type badge */}
          {projectStats && (
            <div className="hidden md:flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-bg2 border border-border/50 px-2 py-0.5 rounded-full">
              <span>📋 {projectStats.count}</span>
              <span className="text-gray-700">·</span>
              <span className="text-gray-400">{projectStats.type}</span>
            </div>
          )}

          {/* Git branch */}
          {gitData?.branch && (
            <button onClick={() => setShowGit(g => !g)}
              className={`flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full border transition-all
                ${showGit ? 'bg-brand/10 border-brand/30 text-brand' : 'border-border/50 bg-bg2 text-gray-400 hover:text-white'}`}>
              ⎇ {gitData.branch}
              {(gitData.status || '').trim() && <span className="w-1.5 h-1.5 rounded-full bg-yellow" />}
            </button>
          )}

          {/* Ollama status dot */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-bg2 border border-border rounded text-xs">
            <div className={`w-2 h-2 rounded-full transition-all
              ${ollamaOnline ? 'bg-green shadow-[0_0_4px_#3fb950]' : 'bg-red'}`} />
            <span className="text-gray-400 hidden sm:inline">{ollamaOnline ? 'Ollama' : 'Offline'}</span>
          </div>

          {/* Model selector — cloud models first, local models last with warning */}
          <select value={model} onChange={e => setModel(e.target.value)}
            className="hidden sm:block bg-bg1 hover:bg-bg2 border border-border text-gray-300 hover:text-white text-xs px-2 py-1 rounded-lg outline-none cursor-pointer max-w-[210px] truncate transition-colors appearance-none pr-6 font-medium relative"
            style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23888" height="16" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}>
            {cloudModels.length > 0 ? (
              <optgroup label="☁️ Massive Cloud Models">
                {cloudModels.map(m => <option key={m} value={`ollama/${m}`}>✨ {m}</option>)}
              </optgroup>
            ) : (
              <optgroup label="☁️ Massive Cloud Models">
                <option value="ollama/deepseek-coder-v2:236b">✨ deepseek-coder-v2:236b</option>
                <option value="ollama/qwen2.5-coder:32b">✨ qwen2.5-coder:32b</option>
                <option value="ollama/gpt-4o-proxy">✨ gpt-4o-proxy</option>
                <option value="ollama/claude-3.5-sonnet-proxy">✨ claude-3.5-sonnet-proxy</option>
                <option value="ollama/jules-proxy">✨ jules-proxy</option>
              </optgroup>
            )}
            {localModels.length > 0 && (
              <optgroup label="💻 Local Downloaded Models">
                {localModels.map(m => <option key={m} value={`ollama/${m}`}>💻 {m}</option>)}
              </optgroup>
            )}
          </select>

          {/* Warn badge when a local model is selected */}
          {isLocal && (
            <span className="hidden md:inline text-xs text-yellow bg-yellow/10 border border-yellow/30 px-2 py-1 rounded">
              Local Hardware
            </span>
          )}

          <div className="hidden md:flex bg-bg2 rounded-lg p-0.5 border border-border/50 shadow-sm ml-1 gap-0.5">
              <button onClick={() => setShowFiles(f => !f)}
                className={`text-[11px] px-2 py-1 font-medium rounded transition-all ${showFiles ? 'bg-bg3 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}>
                Files
              </button>
    
              <button onClick={() => setShowTerminal(t => !t)}
                className={`text-[11px] px-2 py-1 font-medium rounded transition-all ${showTerminal ? 'bg-bg3 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}>
                Term
              </button>
              
              <button onClick={() => setShowDiff(d => !d)}
                className={`text-[11px] px-2 py-1 font-medium rounded transition-all ${showDiff ? 'bg-bg3 text-brand shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}>
                Diff
              </button>
          </div>

          <button onClick={() => setShowSettings(true)}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white transition-all ml-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        </div>
      </div>

      {/* ── MAIN LAYOUT ────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0 bg-bg0">

        {showFiles && (
          <>
            <div className={`flex flex-col bg-bg0 border-r border-border/40 flex-shrink-0 ${mobileMenu ? 'absolute inset-y-0 left-0 z-40 shadow-2xl' : ''}`}
              style={{ width: mobileMenu ? '80%' : sidebarW }}>
              <div className="flex items-center justify-between px-3 py-2.5 flex-shrink-0 bg-bg0">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest truncate">
                  {project?.name || 'Explorer'}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0 relative">
                {project ? (
                  <FileTree root={project.path} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 p-5 text-center">
                    <div className="text-4xl">📁</div>
                    <p className="text-gray-500 text-xs">No project open</p>
                    <button onClick={() => setShowPicker(true)}
                      className="px-3 py-1.5 bg-accent/20 border border-accent/50 text-accent rounded-lg text-xs hover:bg-accent hover:text-bg0 transition-all">
                      Open Project
                    </button>
                  </div>
                )}
              </div>
              {showGit && gitData && <GitPanel data={gitData} />}
            </div>

            {/* Resize handle */}
            <div className="w-0.5 hover:w-1 bg-transparent hover:bg-accent/30 cursor-col-resize flex-shrink-0 transition-all"
              onMouseDown={() => { resizing.current = true; document.body.style.cursor = 'col-resize' }} />
          </>
        )}

        <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
          {fileViewer ? (
             <div className="flex-1 flex flex-col bg-[#1d1f21] overflow-hidden relative">
                <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-border shadow-sm z-10">
                   <div className="flex items-center gap-2">
                       <span className="text-gray-400">📄</span>
                       <span className="text-white text-sm font-medium">{fileViewer.name}</span>
                       <span className="text-gray-500 text-xs ml-2 hidden sm:inline">{fileViewer.path}</span>
                   </div>
                   <button onClick={() => setFileViewer(null)} className="text-gray-500 hover:text-white w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700">✕</button>
                </div>
                <div className="flex-1 overflow-auto p-4 text-sm font-mono text-white selection:bg-accent/30 custom-scroll">
                    <Editor
                      value={fileViewer.content}
                      onValueChange={() => {}}
                      highlight={code => {
                          const ext = fileViewer.name.split('.').pop().toLowerCase()
                          let lang = Prism.languages.javascript
                          if (['ts', 'tsx'].includes(ext)) lang = Prism.languages.typescript
                          if (ext === 'py') lang = Prism.languages.python
                          if (ext === 'css') lang = Prism.languages.css
                          if (ext === 'json') lang = Prism.languages.json
                          return Prism.highlight(code, lang, ext)
                      }}
                      padding={10}
                      style={{
                        fontFamily: '"Fira Code", "Consolas", monospace',
                        fontSize: 14,
                        minHeight: '100%'
                      }}
                      readOnly
                    />
                </div>
             </div>
          ) : (
             <AgentChat project={project} model={model} ollamaOnline={ollamaOnline} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} />
          )}
          {showTerminal && <Terminal project={project} />}
        </div>
        
        {showDiff && project && (
            <div className="w-[400px] border-l border-border flex-shrink-0 flex flex-col bg-bg1">
                <DiffViewer project={project} />
            </div>
        )}
      </div>

      {/* ── MODALS ─────────────────────────────── */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowShortcuts(false)}>
           <div className="bg-bg1 border border-border rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
               <div className="px-4 py-3 border-b border-border flex justify-between items-center bg-bg2">
                  <span className="font-bold text-white text-sm">Keyboard Shortcuts</span>
                  <button onClick={() => setShowShortcuts(false)} className="text-gray-500 hover:text-white">✕</button>
               </div>
               <div className="p-4 flex flex-col gap-3 text-sm text-gray-300">
                  <div className="flex justify-between"><span>Toggle Terminal</span> <kbd className="bg-bg3 px-2 py-0.5 rounded border border-border text-xs font-mono">Cmd/Ctrl + ~ (or UI toggle)</kbd></div>
                  <div className="flex justify-between"><span>Send Message</span> <kbd className="bg-bg3 px-2 py-0.5 rounded border border-border text-xs font-mono">Enter</kbd></div>
                  <div className="flex justify-between"><span>New Line in Chat</span> <kbd className="bg-bg3 px-2 py-0.5 rounded border border-border text-xs font-mono">Shift + Enter</kbd></div>
                  <div className="flex justify-between"><span>Search Files</span> <kbd className="bg-bg3 px-2 py-0.5 rounded border border-border text-xs font-mono">Sidebar Searchbox</kbd></div>
                  <div className="flex justify-between"><span>Show Shortcuts</span> <kbd className="bg-bg3 px-2 py-0.5 rounded border border-border text-xs font-mono">Cmd/Ctrl + K</kbd></div>
               </div>
           </div>
        </div>
      )}

      {showPicker   && <ProjectPicker onSelect={openProject} onClose={() => setShowPicker(false)} />}
      {showSettings && (
        <Settings
          model={model}
          localModels={localModels}
          onModelChange={setModel}
          onClose={() => setShowSettings(false)}
          onModelsRefresh={refreshModels}
        />
      )}
    </div>
  )
}
