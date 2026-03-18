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
  const [selectedFiles, setSelectedFiles] = useState([])
  const [localModels, setLocalModels]   = useState([])
  const [model, setModel]               = useState('ollama/deepseek-v3.1:671b-cloud')
  const [ollamaOnline, setOllamaOnline] = useState(false)
  
  // VS Code Layout State
  const [activityBarMode, setActivityBarMode] = useState('chat') // 'chat', 'explorer', 'git', 'search'
  const [showSidebar, setShowSidebar] = useState(true)
  const [showBottomPanel, setShowBottomPanel] = useState(true)
  const [bottomPanelMode, setBottomPanelMode] = useState('terminal') // 'terminal', 'diff'
  const [openEditors, setOpenEditors] = useState([{ id: 'chat', type: 'chat', name: 'Agent Chat' }])
  const [activeEditor, setActiveEditor] = useState('chat')
  
  const [showPicker, setShowPicker]     = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [gitData, setGitData]           = useState(null)
  const [projectStats, setProjectStats] = useState(null)
  const [sidebarW, setSidebarW]         = useState(260)
  const [mobileMenu, setMobileMenu]     = useState(false)
  
  // Toast notifications & Context metrics
  const [toasts, setToasts] = useState([])
  const [lastMetrics, setLastMetrics] = useState({ in: 0, out: 0, status: 'Idle' })
  const resizing = useRef(false)
  
  const addToast = (msg, type='info') => {
      const id = Date.now()
      setToasts(t => [...t, { id, msg, type }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

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
    
    // Load persisted state (selected files, session)
    fetch(`/api/projects/state?project_path=${encodeURIComponent(project.path)}`)
        .then(r => r.json())
        .then(d => {
            if (d.selected_files) setSelectedFiles(d.selected_files)
            else setSelectedFiles([])
            // AgentChat component will handle loading the session_id internally via its own hook or we could pass it down.
        })
        .catch(() => setSelectedFiles([]))
    
    window.addEventListener('refresh_git', loadGit)
    return () => window.removeEventListener('refresh_git', loadGit)
  }, [project?.path])

  const [showShortcuts, setShowShortcuts] = useState(false)

  // Sidebar resize listeners, File Viewer, & Shortcuts
  useEffect(() => {
    const onMove = e => { if (resizing.current) setSidebarW(Math.max(160, Math.min(480, e.clientX))) }
    const onUp   = () => { resizing.current = false; document.body.style.cursor = '' }
    
    const onOpenFile = (e) => {
        const id = e.detail.path
        // Check if already open
        setOpenEditors(eds => {
            if (!eds.find(x => x.id === id)) {
                return [...eds, { id, type: 'file', path: e.detail.path, name: e.detail.name, content: 'Loading...' }]
            }
            return eds
        })
        setActiveEditor(id)
        
        fetch(`/api/fs/read?path=${encodeURIComponent(e.detail.path)}`)
            .then(r => r.json())
            .then(d => {
                if (d.content !== undefined) {
                    setOpenEditors(eds => eds.map(ed => ed.id === id ? { ...ed, content: d.content } : ed))
                } else {
                    setOpenEditors(eds => eds.map(ed => ed.id === id ? { ...ed, content: 'Error loading file' } : ed))
                }
            })
    }
    
    // Global metric listener
    const onMetrics = (e) => setLastMetrics(m => ({ ...m, ...e.detail }))
    window.addEventListener('agent_metrics', onMetrics)
    
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
        window.removeEventListener('agent_metrics', onMetrics)
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
    <div className="flex flex-col h-screen bg-bg0 overflow-hidden text-gray-300 font-sans select-none">
      
      {/* ── TITLE BAR (Top) ──────────────────────────── */}
      <div className="h-[35px] flex items-center justify-between px-2 bg-[#181818] border-b border-border/40 flex-shrink-0 z-20 title-drag">
        {/* Left: Window Controls / Title */}
        <div className="flex items-center gap-3">
            <span className="text-brand text-lg ml-1">⬡</span>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[200px] md:max-w-[400px]">
              {projects.map((p, i) => (
                <div key={i}
                  onClick={() => { setActiveTab(i); setProjectStats(null); setGitData(null) }}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer text-[11px] whitespace-nowrap group transition-all
                    ${i === activeTab ? 'bg-bg3 text-white' : 'hover:bg-bg2 text-gray-400'}`}>
                  <span>{p.name}</span>
                  <button onClick={e => removeProject(i, e)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red">✕</button>
                </div>
              ))}
              <button onClick={() => setShowPicker(true)} className="flex items-center justify-center w-5 h-5 rounded hover:bg-bg2 text-gray-400 hover:text-white" title="Open project">+</button>
            </div>
        </div>

        {/* Center: Command Palette Trigger */}
        <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center justify-center">
            <button onClick={() => setShowShortcuts(true)} className="flex items-center gap-2 bg-[#2d2d2d] hover:bg-[#333] border border-border/40 rounded-md px-16 py-1 text-[11px] text-gray-400 transition-colors shadow-sm w-96 max-w-full justify-center">
                <span>🔍</span>
                <span>{project ? project.name : 'Search'}</span>
                <span className="ml-auto text-gray-500 font-mono text-[9px] border border-gray-600 rounded px-1">Cmd K</span>
            </button>
        </div>

        {/* Right: Layout Toggles & Mobile */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button className="md:hidden text-gray-400 p-1" onClick={() => setMobileMenu(m => !m)}>☰</button>
          
          <div className="hidden md:flex items-center bg-[#252526] rounded border border-border/30 overflow-hidden">
              <button onClick={() => setShowSidebar(f => !f)} className={`px-2 py-0.5 text-[11px] ${showSidebar ? 'bg-[#37373d] text-white' : 'text-gray-400 hover:text-gray-200'}`} title="Toggle Sidebar">◧</button>
              <button onClick={() => setShowBottomPanel(t => !t)} className={`px-2 py-0.5 text-[11px] border-l border-border/30 ${showBottomPanel ? 'bg-[#37373d] text-white' : 'text-gray-400 hover:text-gray-200'}`} title="Toggle Panel">◤</button>
          </div>
        </div>
      </div>

      {/* ── MIDDLE WORKSPACE ────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative">
        
        {/* ACTIVITY BAR (Leftmost) */}
        <div className="w-[48px] bg-[#181818] border-r border-border/40 flex flex-col items-center py-2 gap-4 flex-shrink-0 z-30">
            <button onClick={() => { setShowSidebar(true); setActivityBarMode('explorer') }} className={`relative p-2 text-xl transition-colors ${activityBarMode === 'explorer' && showSidebar ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`} title="Explorer (Cmd+Shift+E)">
                📁
                {activityBarMode === 'explorer' && showSidebar && <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-brand" />}
            </button>
            <button onClick={() => { setShowSidebar(true); setActivityBarMode('chat') }} className={`relative p-2 text-xl transition-colors ${activityBarMode === 'chat' && showSidebar ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`} title="Agent Chat (Cmd+Shift+A)">
                💬
                {activityBarMode === 'chat' && showSidebar && <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-brand" />}
            </button>
            <button onClick={() => { setShowSidebar(true); setActivityBarMode('search') }} className={`relative p-2 text-xl transition-colors ${activityBarMode === 'search' && showSidebar ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`} title="Search (Cmd+Shift+F)">
                🔍
                {activityBarMode === 'search' && showSidebar && <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-brand" />}
            </button>
            <button onClick={() => { setShowSidebar(true); setActivityBarMode('git') }} className={`relative p-2 text-xl transition-colors ${activityBarMode === 'git' && showSidebar ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`} title="Source Control (Cmd+Shift+G)">
                ⎇
                {activityBarMode === 'git' && showSidebar && <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-brand" />}
            </button>
            
            <div className="mt-auto flex flex-col gap-4 mb-2">
                <button onClick={() => setShowSettings(true)} className="p-2 text-xl text-gray-500 hover:text-white transition-colors" title="Settings">⚙️</button>
            </div>
        </div>

        {/* SIDEBAR (Resizable) */}
        {showSidebar && (
          <>
            <div className={`flex flex-col bg-[#1e1e1e] border-r border-border/40 flex-shrink-0 z-20 ${mobileMenu ? 'absolute inset-y-0 left-[48px] right-10 shadow-2xl' : ''}`}
              style={{ width: mobileMenu ? 'auto' : sidebarW }}>
              <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0">
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">
                  {activityBarMode === 'explorer' ? (project?.name || 'EXPLORER') : activityBarMode.toUpperCase()}
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto min-h-0 relative">
                {!project ? (
                    <div className="p-4 text-center mt-10">
                        <p className="text-gray-500 text-xs mb-4">No folder opened</p>
                        <button onClick={() => setShowPicker(true)} className="bg-brand text-bg0 px-3 py-1.5 rounded font-medium text-xs w-full hover:opacity-90">Open Folder</button>
                    </div>
                ) : (
                    <>
                        {activityBarMode === 'explorer' && <FileTree root={project.path} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} />}
                        {activityBarMode === 'git' && <GitPanel data={gitData} />}
                        {activityBarMode === 'chat' && <AgentChat project={project} model={model} ollamaOnline={ollamaOnline} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} />}
                        {activityBarMode === 'search' && (
                            <div className="p-4 text-xs text-gray-400">
                                <p>Search is accessible via the Explorer panel top bar for now.</p>
                                <button onClick={() => setActivityBarMode('explorer')} className="mt-4 text-brand underline">Go to Explorer</button>
                            </div>
                        )}
                    </>
                )}
              </div>
            </div>
            {/* Resize handle */}
            <div className="w-1 hover:bg-brand/50 cursor-col-resize flex-shrink-0 z-20 relative -ml-0.5 transition-colors"
              onMouseDown={() => { resizing.current = true; document.body.style.cursor = 'col-resize' }} />
          </>
        )}

        {/* MAIN EDITOR AREA */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[#1e1e1e] relative">
          
          {/* Editor Tabs */}
          <div className="flex bg-[#181818] border-b border-border/40 overflow-x-auto no-scrollbar flex-shrink-0 h-[35px]">
              {openEditors.map(ed => (
                  <div key={ed.id} onClick={() => setActiveEditor(ed.id)}
                       className={`flex items-center gap-2 px-3 border-r border-border/40 min-w-0 cursor-pointer group ${activeEditor === ed.id ? 'bg-[#1e1e1e] text-brand border-t border-t-brand' : 'bg-[#2d2d2d] text-gray-500 hover:bg-[#1e1e1e]'}`}>
                      <span className="text-[11px] truncate select-none">{ed.name}</span>
                      <button onClick={(e) => {
                          e.stopPropagation();
                          const next = openEditors.filter(x => x.id !== ed.id)
                          setOpenEditors(next)
                          if (activeEditor === ed.id) setActiveEditor(next.length ? next[next.length-1].id : null)
                      }} className={`opacity-0 group-hover:opacity-100 hover:text-white text-gray-500 rounded-sm`}>✕</button>
                  </div>
              ))}
          </div>
          
          {/* Editor Content */}
          <div className="flex-1 overflow-hidden relative bg-[#1e1e1e]">
              {!activeEditor ? (
                  <div className="flex items-center justify-center h-full">
                      <div className="text-center text-gray-600 select-none">
                          <div className="text-6xl mb-4 opacity-20">⬡</div>
                          <p className="text-sm font-medium">AiderWeb Advanced</p>
                          <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-2 text-left text-xs">
                              <span>Show All Commands</span><kbd className="font-mono">Cmd+K</kbd>
                              <span>Open Folder</span><kbd className="font-mono">Cmd+O</kbd>
                              <span>Toggle Terminal</span><kbd className="font-mono">Cmd+~</kbd>
                              <span>Focus Chat</span><kbd className="font-mono">Cmd+Shift+A</kbd>
                          </div>
                      </div>
                  </div>
              ) : (
                  openEditors.map(ed => (
                      <div key={ed.id} className={`absolute inset-0 flex flex-col ${activeEditor === ed.id ? 'z-10' : 'hidden z-0'}`}>
                          {ed.type === 'chat' && (
                              <AgentChat project={project} model={model} ollamaOnline={ollamaOnline} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} isMainEditor={true} />
                          )}
                          {ed.type === 'file' && (
                              <div className="flex-1 overflow-auto p-4 text-[13px] font-mono text-[#d4d4d4] custom-scroll">
                                <Editor
                                  value={ed.content}
                                  onValueChange={() => {}}
                                  highlight={code => {
                                      const ext = ed.name.split('.').pop().toLowerCase()
                                      let lang = Prism.languages.javascript
                                      if (['ts', 'tsx'].includes(ext)) lang = Prism.languages.typescript
                                      if (ext === 'py') lang = Prism.languages.python
                                      if (ext === 'css') lang = Prism.languages.css
                                      if (ext === 'json') lang = Prism.languages.json
                                      if (ext === 'html') lang = Prism.languages.html
                                      if (ext === 'sh' || ext === 'bat') lang = Prism.languages.bash
                                      return Prism.highlight(code, lang, ext)
                                  }}
                                  padding={10}
                                  style={{ fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace', minHeight: '100%' }}
                                  readOnly
                                />
                              </div>
                          )}
                      </div>
                  ))
              )}
          </div>
          
          {/* BOTTOM PANEL (Terminal/Diff) */}
          {showBottomPanel && (
              <div className="flex-shrink-0 flex flex-col border-t border-border/40 bg-[#1e1e1e] relative min-h-[100px] h-[250px] z-20">
                  <div className="flex items-center px-4 h-8 border-b border-border/40 flex-shrink-0 gap-4 uppercase text-[10px] font-medium tracking-wide">
                      <button onClick={() => setBottomPanelMode('terminal')} className={`${bottomPanelMode === 'terminal' ? 'text-white border-b border-white h-full' : 'text-gray-500 hover:text-gray-300'}`}>Terminal</button>
                      <button onClick={() => setBottomPanelMode('diff')} className={`${bottomPanelMode === 'diff' ? 'text-brand border-b border-brand h-full' : 'text-gray-500 hover:text-gray-300'}`}>Diff Viewer</button>
                      <button onClick={() => setShowBottomPanel(false)} className="ml-auto text-gray-500 hover:text-white">✕</button>
                  </div>
                  <div className="flex-1 overflow-hidden relative">
                      {bottomPanelMode === 'terminal' && <Terminal project={project} />}
                      {bottomPanelMode === 'diff' && <DiffViewer project={project} />}
                  </div>
              </div>
          )}
        </div>
      </div>

      {/* ── STATUS BAR (Bottom) ────────────────────────── */}
      <div className="h-[22px] bg-[#007acc] text-white flex items-center justify-between px-2 flex-shrink-0 z-30 text-[10.5px] font-medium select-none">
          <div className="flex items-center gap-3">
              <button className="hover:bg-white/20 px-1 rounded flex items-center gap-1" onClick={() => {setShowSidebar(true); setActivityBarMode('git')}}>
                 ⎇ {gitData?.branch || 'main'} {gitData?.status?.trim() ? '*' : ''}
              </button>
              <span className="opacity-50">|</span>
              <span className="flex items-center gap-1" title="Errors / Warnings">
                 ❌ 0 ⚠️ 0
              </span>
              <span className="opacity-50">|</span>
              <span className="animate-pulse">{lastMetrics.status !== 'Idle' ? lastMetrics.status : ''}</span>
          </div>
          
          <div className="flex items-center gap-3">
              <span title="Tokens used in last prompt">📊 {lastMetrics.in.toLocaleString()} IN / {lastMetrics.out.toLocaleString()} OUT</span>
              <select value={model} onChange={e => setModel(e.target.value)}
                className="bg-transparent hover:bg-white/20 outline-none cursor-pointer appearance-none px-1 rounded transition-colors" title="Select Model">
                {cloudModels.length > 0 ? (
                  <optgroup label="Massive Cloud Models">
                    {cloudModels.map(m => <option className="text-black" key={m} value={`ollama/${m}`}>{m}</option>)}
                  </optgroup>
                ) : (
                  <optgroup label="Massive Cloud Models">
                    <option className="text-black" value="ollama/gpt-4o-proxy">gpt-4o-proxy</option>
                    <option className="text-black" value="ollama/claude-3.5-sonnet-proxy">claude-3.5-sonnet-proxy</option>
                    <option className="text-black" value="ollama/deepseek-v3.1:671b-cloud">deepseek-v3.1:671b-cloud</option>
                  </optgroup>
                )}
                {localModels.length > 0 && (
                  <optgroup label="Local Hardware">
                    {localModels.map(m => <option className="text-black" key={m} value={`ollama/${m}`}>{m}</option>)}
                  </optgroup>
                )}
              </select>
              <div className="flex items-center gap-1 hover:bg-white/20 px-1 rounded cursor-pointer" onClick={() => {}}>
                  <div className={`w-1.5 h-1.5 rounded-full ${ollamaOnline ? 'bg-white' : 'bg-red-300'}`} />
                  {ollamaOnline ? 'Online' : 'Offline'}
              </div>
          </div>
      </div>

      {/* ── TOASTS ─────────────────────────────── */}
      <div className="fixed bottom-10 right-4 z-50 flex flex-col gap-2">
          {toasts.map(t => (
              <div key={t.id} className="bg-[#252526] border border-border/50 text-gray-200 px-4 py-2 rounded shadow-xl text-xs flex items-center gap-2 animate-in slide-in-from-bottom-5">
                  <span className={t.type === 'error' ? 'text-red-400' : 'text-brand'}>{t.type === 'error' ? '❌' : 'ℹ️'}</span>
                  {t.msg}
              </div>
          ))}
      </div>

      {/* ── MODALS ─────────────────────────────── */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-start pt-20 justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowShortcuts(false)}>
           <div className="bg-[#252526] border border-border/50 rounded-lg shadow-2xl w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
               <div className="p-2 border-b border-border/50">
                   <input type="text" autoFocus placeholder="Type a command or search..." className="w-full bg-transparent text-white outline-none px-2 py-1 text-sm font-mono" />
               </div>
               <div className="max-h-64 overflow-y-auto p-2 flex flex-col text-sm text-gray-300">
                  <button className="flex justify-between items-center px-3 py-2 hover:bg-brand/20 hover:text-brand rounded text-left" onClick={() => {setShowSettings(true); setShowShortcuts(false)}}><span>Open Settings</span></button>
                  <button className="flex justify-between items-center px-3 py-2 hover:bg-brand/20 hover:text-brand rounded text-left" onClick={() => {setShowPicker(true); setShowShortcuts(false)}}><span>Open Folder / Project</span></button>
                  <button className="flex justify-between items-center px-3 py-2 hover:bg-brand/20 hover:text-brand rounded text-left" onClick={() => {setShowBottomPanel(b => !b); setShowShortcuts(false)}}><span>Toggle Terminal Panel</span><kbd className="font-mono text-xs">Cmd+~</kbd></button>
                  <button className="flex justify-between items-center px-3 py-2 hover:bg-brand/20 hover:text-brand rounded text-left" onClick={() => {setActivityBarMode('chat'); setShowSidebar(true); setShowShortcuts(false)}}><span>Focus Chat Agent</span><kbd className="font-mono text-xs">Cmd+Shift+A</kbd></button>
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
