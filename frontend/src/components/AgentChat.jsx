import { useState, useEffect, useRef, useCallback } from 'react'

const WS_BASE = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

// Event icons for agent activity feed
const EVENT_ICONS = {
  start:  { icon: '🚀', color: 'text-accent' },
  scan:   { icon: '📂', color: 'text-yellow' },
  read:   { icon: '📖', color: 'text-gray-400' },
  think:  { icon: '🧠', color: 'text-purple' },
  edit:   { icon: '✏️', color: 'text-green' },
  cmd:    { icon: '⚡', color: 'text-yellow' },
  error:  { icon: '⚠️', color: 'text-red' },
  done:   { icon: '✅', color: 'text-green' },
}

// Format markdown-ish text
function fmt(text) {
  if (!text) return ''
  
  // Format diff blocks specially
  text = text.replace(/```diff\n([\s\S]*?)```/g, (_, c) => {
    const lines = c.split('\n').map(line => {
        if (line.startsWith('+')) return `<div class="bg-green/10 text-green-400 px-1 border-l-2 border-green-500">${esc(line)}</div>`
        if (line.startsWith('-')) return `<div class="bg-red/10 text-red-400 px-1 border-l-2 border-red-500">${esc(line)}</div>`
        if (line.startsWith('@@')) return `<div class="text-blue-400 px-1">${esc(line)}</div>`
        return `<div class="px-1 text-gray-300">${esc(line)}</div>`
    }).join('')
    return `<div class="my-2 rounded-lg border border-border bg-bg0 overflow-hidden text-xs font-mono"><div class="bg-bg2 px-3 py-1 text-gray-400 border-b border-border flex justify-between"><span>Diff</span><span>📝</span></div><div class="p-2 overflow-x-auto">${lines}</div></div>`
  })

  // Format EXECUTE blocks specially
  text = text.replace(/<<<EXECUTE\n([\s\S]*?)\n>>>/g, (_, c) => {
      return `<div class="my-2 rounded-lg border border-yellow/30 bg-yellow/5 overflow-hidden text-xs font-mono"><div class="bg-yellow/10 px-3 py-1 text-yellow-500 border-b border-yellow/20 flex items-center gap-2"><span>⚡</span><span>Executing Terminal Command</span></div><div class="p-3 text-gray-300 overflow-x-auto">${esc(c.trim())}</div></div>`
  })
  
  // Format SEARCH and BROWSE blocks
  text = text.replace(/<<<SEARCH\n([\s\S]*?)\n>>>/g, (_, c) => {
      return `<div class="my-2 rounded-lg border border-blue/30 bg-blue/5 overflow-hidden text-xs font-mono"><div class="bg-blue/10 px-3 py-1 text-blue-400 border-b border-blue/20 flex items-center gap-2"><span>🔍</span><span>Web Search</span></div><div class="p-3 text-gray-300 overflow-x-auto">${esc(c.trim())}</div></div>`
  })
  text = text.replace(/<<<BROWSE\n([\s\S]*?)\n>>>/g, (_, c) => {
      return `<div class="my-2 rounded-lg border border-purple/30 bg-purple/5 overflow-hidden text-xs font-mono"><div class="bg-purple/10 px-3 py-1 text-purple-400 border-b border-purple/20 flex items-center gap-2"><span>🌐</span><span>Browsing URL</span></div><div class="p-3 text-gray-300 overflow-x-auto">${esc(c.trim())}</div></div>`
  })
  
  text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g,
    (_, l, c) => `<div class="my-2 rounded-lg border border-border bg-bg0 overflow-hidden text-xs"><div class="bg-bg2 px-3 py-1 text-gray-400 border-b border-border">${l || 'code'}</div><pre class="p-3 overflow-x-auto text-gray-300 font-mono"><code>${esc(c.trim())}</code></pre></div>`)
  
  // Basic inline formatting
  text = text.replace(/`([^`\n]+)`/g, '<code class="bg-bg0 text-accent px-1.5 py-0.5 rounded font-mono text-[0.9em] border border-border/50">$1</code>')
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
  
  // Only convert single newlines to br if not inside a pre/code block (very simplified)
  // text = text.replace(/\n/g, '<br>')
  
  // split by blocks we just created
  const parts = text.split(/(<div class="my-2 rounded-lg.*?<\/div><\/div>)/s)
  return parts.map(p => {
      if (p.startsWith('<div class="my-2')) return p
      // handle normal text newlines
      return p.replace(/\n/g, '<br>')
  }).join('')
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// Agent event bubble - shows AI activity (reading files, editing, etc.)
function AgentEvent({ event }) {
  const style = EVENT_ICONS[event.event] || { icon: '•', color: 'text-gray-500' }
  return (
    <div className={`flex items-start gap-2 text-xs animate-in ${style.color} py-0.5`}>
      <span className="flex-shrink-0 mt-0.5">{style.icon}</span>
      <span className="opacity-80">{event.text}</span>
    </div>
  )
}

// Chat message bubble
function Message({ msg }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex gap-3 animate-in ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 font-bold
        ${isUser ? 'bg-accent/20 text-accent' : 'bg-bg2 border border-border text-green'}`}>
        {isUser ? 'Y' : '⬡'}
      </div>
      <div className={`min-w-0 ${isUser ? 'max-w-[75%]' : 'flex-1'}`}>
        {/* Agent events inside AI message */}
        {msg.events?.length > 0 && (
          <div className="bg-bg2/50 border border-border/50 rounded-lg p-3 mb-2 space-y-0.5">
            {msg.events.map((ev, i) => <AgentEvent key={i} event={ev} />)}
          </div>
        )}

        {/* Main message content */}
        {msg.content && (
          <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed
            ${isUser
              ? 'bg-accent/15 border border-accent/30 text-white'
              : 'bg-bg1 border border-border text-gray-200 shadow-sm'
            }`}
            dangerouslySetInnerHTML={{ __html: fmt(msg.content) }}
            style={{ wordBreak: 'break-word' }}
          />
        )}
        
        {/* Approve / Reject buttons */}
        {msg.pendingApproval && (
            <div className="mt-2 flex gap-2">
                <button 
                  onClick={() => msg.onApprove(msg.id)}
                  className="bg-green-600/20 hover:bg-green-600 text-green-400 hover:text-white px-3 py-1 rounded text-xs border border-green-600/50 transition-colors">
                  Approve Changes
                </button>
                <button 
                  onClick={() => msg.onReject(msg.id)}
                  className="bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white px-3 py-1 rounded text-xs border border-red-600/50 transition-colors">
                  Reject
                </button>
            </div>
        )}

        {/* Streaming cursor */}
        {msg.streaming && !msg.content && (
          <div className="bg-bg2 border border-border rounded-xl px-4 py-3 flex items-center gap-2">
            <div className="flex gap-1">
              {[0,1,2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-accent pulse"
                  style={{ animationDelay: `${i*200}ms` }} />
              ))}
            </div>
            <span className="text-xs text-gray-500">Agent working...</span>
          </div>
        )}

        {/* Edited files summary */}
        {msg.editedFiles?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.editedFiles.map((f, i) => (
              <span key={i} className="text-xs bg-green/10 border border-green/30 text-green px-2 py-0.5 rounded font-mono">
                ✏️ {f.split(/[\\/]/).pop()}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Suggested prompts
const SUGGESTIONS = [
  'Explain this entire project to me',
  'Find and fix all bugs',
  'Add proper error handling everywhere',
  'Add dark mode',
  'Write tests for the main functionality',
  'Refactor code to be cleaner',
  'Add loading states to UI',
  'Optimize performance',
]

export default function AgentChat({ project, model, ollamaOnline, selectedFiles, setSelectedFiles }) {
  const [messages, setMessages] = useState([])
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false)
  const [session, setSession] = useState('default')
  const [availableSessions, setAvailableSessions] = useState(['default'])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [testCmd, setTestCmd] = useState('') // added for agent loop
  const [recording, setRecording] = useState(false)
  const [agentMode, setAgentMode] = useState('coder') // 'coder', 'planner', 'reviewer'
  const [showTestCmd, setShowTestCmd] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState([]) // For drag and drop uploads
  const [isDragging, setIsDragging] = useState(false)
  const wsRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const currentMsgId = useRef(null)

  // Load/Reset on project change
  useEffect(() => {
    setInput('')
    setRunning(false)
    setStatusText('')
    setHasLoadedHistory(false)
    if (!project) {
       setMessages([])
       return
    }
    // Fetch chat sessions for this project
    fetch(`/api/projects/sessions?project_path=${encodeURIComponent(project.path)}`)
       .then(r => r.json())
       .then(d => {
           if (d.sessions) setAvailableSessions(d.sessions)
       }).catch(() => {})

    // Fetch chat history for this project and session
    fetch(`/api/projects/history?project_path=${encodeURIComponent(project.path)}&session_id=${encodeURIComponent(session)}`)
       .then(r => r.json())
       .then(d => {
           if (d.messages) setMessages(d.messages.map(m => ({ ...m, id: Date.now() + Math.random() })))
           else setMessages([])
           setHasLoadedHistory(true)
       }).catch(() => { setMessages([]); setHasLoadedHistory(true) })
  }, [project?.path, session])

  // Save history on messages change
  useEffect(() => {
      if (!project || !hasLoadedHistory) return
      // Prevent saving while streaming or pending to keep it clean
      if (messages.some(m => m.streaming || m.pendingApproval)) return
      
      fetch(`/api/projects/history?project_path=${encodeURIComponent(project.path)}&session_id=${encodeURIComponent(session)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages)
      }).catch(() => {})
  }, [messages, project, hasLoadedHistory, session])

  // Auto scroll & Request Notifications
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
    }
  }, [messages])

  // Connect WebSocket
  const getWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current
    const ws = new WebSocket(`${WS_BASE}/ws/agent`)
    wsRef.current = ws
    return ws
  }, [])

  const send = () => {
    const text = input.trim()
    if (!text || running || !project) return

    if (!ollamaOnline) {
      setMessages(m => [...m, {
        role: 'ai', content: '⚠️ **Ollama is offline.** Please start it:\n\n`ollama serve`\n\nThen try again.'
      }])
      return
    }

    setInput('')
    setRunning(true)

    // Add user message
    setMessages(m => [...m, { role: 'user', content: text }])

    // Add AI message placeholder
    const msgId = Date.now()
    currentMsgId.current = msgId
    setMessages(m => [...m, {
      id: msgId,
      role: 'ai',
      content: '',
      events: [],
      streaming: true,
      editedFiles: []
    }])

    const ws = getWs()
    let aiContent = ''
    let events = []

    const onMsg = (e) => {
      const data = JSON.parse(e.data)

      if (data.type === 'agent_event') {
        // Live agent activity (reading files, editing, etc.)
        events = [...events, { event: data.event, text: data.text }]
        setStatusText(data.text)
        setMessages(m => m.map(msg =>
          msg.id === msgId ? { ...msg, events } : msg
        ))

      } else if (data.type === 'chunk') {
        // AI text output
        aiContent += data.text
        setMessages(m => m.map(msg =>
          msg.id === msgId ? { ...msg, content: aiContent } : msg
        ))

      } else if (data.type === 'pending_approval') {
          // Waiting for user to click approve/reject
          setMessages(m => m.map(msg =>
            msg.id === msgId ? { ...msg, streaming: false, pendingApproval: true } : msg
          ))
          setStatusText('Waiting for approval...')

      } else if (data.type === 'done') {
        // All done
        setMessages(m => m.map(msg =>
          msg.id === msgId ? {
            ...msg,
            streaming: false,
            pendingApproval: false,
            content: aiContent + (data.loop_result || ''),
            editedFiles: data.edited_files || []
          } : msg
        ))
        
        // Basic agent loop trigger if test fails or if the AI ran a command autonomously
        if (data.loop_result && data.status !== 'rejected') {
            const isError = data.loop_result.startsWith('\n❌');
            const isAIExec = data.loop_result.includes('[Terminal Output') || data.loop_result.includes('[Web Search Results') || data.loop_result.includes('[Webpage Content');
            
            if (isError || isAIExec) {
               setTimeout(() => {
                  const autoReply = isError ? `The command failed:\n${data.loop_result}\n\nPlease fix the error.` : `Output:\n${data.loop_result}`;
                  setInput(autoReply);
                  
                  // Auto-loop the AI
                  if (isAIExec && !isError) {
                      const btn = document.getElementById('chat-send-btn')
                      if (btn && !btn.disabled) {
                          btn.dataset.autoMsg = autoReply
                          btn.click()
                      }
                  }
               }, 500);
            }
        }

        setRunning(false)
        setStatusText('')
        
        // Notifications
        if ('Notification' in window && Notification.permission === 'granted') {
            if (document.hidden) {
                new Notification('AiderWeb Task Complete', { body: 'The agent has finished working.' })
            }
        }
        
        if (data.status !== 'approved') {
            ws.removeEventListener('message', onMsg)
        }

      } else if (data.type === 'error') {
        setMessages(m => m.map(msg =>
          msg.id === msgId ? {
            ...msg,
            content: `❌ Error: ${data.text}\n\nMake sure Ollama is running and the model is downloaded.`,
            streaming: false
          } : msg
        ))
        setRunning(false)
        setStatusText('')
        ws.removeEventListener('message', onMsg)

      } else if (data.type === 'stopped') {
        setMessages(m => m.map(msg =>
          msg.id === msgId ? { ...msg, content: aiContent + '\n\n*[Stopped by user]*', streaming: false } : msg
        ))
        setRunning(false)
        setStatusText('')
        ws.removeEventListener('message', onMsg)
      }
    }

    ws.addEventListener('message', onMsg)

    const doSend = () => ws.send(JSON.stringify({
      type: 'run',
      path: project.path,
      model,
      message: text,
      selected_files: selectedFiles,
      mode: agentMode,
      test_cmd: testCmd, // pass to backend to run on success
      extra_files: droppedFiles.map(f => ({ name: f.name, content: f.content, type: f.type }))
    }))
    
    // Clear dropped files after sending
    setDroppedFiles([])

    if (ws.readyState === WebSocket.OPEN) doSend()
    else ws.addEventListener('open', doSend, { once: true })
  }

  const stop = () => {
    wsRef.current?.send(JSON.stringify({ type: 'stop' }))
  }
  
  const approveDiffs = (msgId) => {
      wsRef.current?.send(JSON.stringify({ type: 'approve' }))
      setMessages(m => m.map(msg => msg.id === msgId ? { ...msg, pendingApproval: false } : msg))
      setRunning(true)
  }
  
  const rejectDiffs = (msgId) => {
      wsRef.current?.send(JSON.stringify({ type: 'reject' }))
      setMessages(m => m.map(msg => msg.id === msgId ? { ...msg, pendingApproval: false } : msg))
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const onInputChange = (e) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px'
  }

  const handleVoice = () => {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
          alert('Speech recognition is not supported in this browser.')
          return
      }
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      const r = new SpeechRecognition()
      r.continuous = false
      r.interimResults = false
      
      r.onstart = () => setRecording(true)
      r.onresult = (e) => {
          const t = e.results[0][0].transcript
          setInput(prev => prev ? prev + ' ' + t : t)
          setRecording(false)
      }
      r.onerror = () => setRecording(false)
      r.onend = () => setRecording(false)
      
      r.start()
  }

  const clearChat = () => setMessages([])
  
  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return
    const formData = new FormData()
    
    // Limit to 5 files at a time to prevent overload
    Array.from(files).slice(0, 5).forEach(file => {
        if (file.size > 5 * 1024 * 1024) {
            alert(`File ${file.name} is larger than 5MB and was skipped.`)
            return
        }
        formData.append('file', file)
    })
    
    try {
        // Upload one by one due to simple fastAPI endpoint setup
        for (let i = 0; i < files.length; i++) {
            if (i >= 5) break
            const fd = new FormData()
            fd.append('file', files[i])
            
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: fd
            })
            
            if (res.ok) {
                const data = await res.json()
                setDroppedFiles(prev => [...prev, data])
            } else {
                const errorText = await res.text()
                alert(`Error uploading ${files[i].name}: ${errorText}`)
            }
        }
    } catch (e) {
        alert("Upload failed: " + e.message)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    handleFileUpload(e.dataTransfer.files)
  }

  const onDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }
  
  const onDragLeave = (e) => {
    e.preventDefault()
    setIsDragging(false)
  }
  
  const onPaste = (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    
    const files = []
    for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
            files.push(items[i].getAsFile())
        }
    }
    if (files.length > 0) handleFileUpload(files)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">

        {messages.length === 0 ? (
          /* Welcome screen */
          <div className="flex flex-col items-center justify-center h-full text-center gap-5 py-8">
            <div className="text-6xl">⬡</div>
            <div>
              <h1 className="text-2xl font-bold text-white mb-2">
                {project?.name || 'AiderWeb'}
              </h1>
              <p className="text-gray-500 text-sm max-w-md leading-relaxed">
                {project
                  ? `AI agent with full access to your entire project. Just describe what you want — the agent reads all files automatically and makes changes.`
                  : 'Open a project folder using the + tab button above to get started.'}
              </p>
            </div>

            {project && (
              <div className="w-full max-w-lg">
                <p className="text-xs text-gray-600 mb-3 text-center">Quick start:</p>
                <div className="grid grid-cols-2 gap-2">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => setInput(s)}
                      className="text-left px-3 py-2 bg-bg2 border border-border rounded-lg text-xs text-gray-400 hover:text-white hover:border-accent/50 hover:bg-bg3 transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!ollamaOnline && (
              <div className="flex items-center gap-2 px-4 py-2 bg-red/10 border border-red/30 rounded-lg text-xs text-red">
                <span>⚠️</span>
                <span>Ollama is offline. Run <code>ollama serve</code> to start it.</span>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) => <Message key={i} msg={{...msg, onApprove: approveDiffs, onReject: rejectDiffs}} />)
        )}

        <div ref={bottomRef} />
      </div>

      {/* Status bar when running */}
      {running && statusText && (
        <div className="flex items-center gap-2 px-4 py-2 bg-bg1 border-t border-border text-xs text-gray-400">
          <div className="spinner w-3 h-3 border border-border border-t-accent rounded-full flex-shrink-0" />
          <span className="flex-1 truncate">{statusText}</span>
          <button onClick={stop}
            className="text-red hover:text-red/70 flex-shrink-0 font-medium">
            Stop
          </button>
        </div>
      )}

      {/* Input area */}
      <div className={`border-t border-border bg-bg1 p-3 relative ${isDragging ? 'bg-accent/10 border-accent' : ''}`}
           onDrop={onDrop}
           onDragOver={onDragOver}
           onDragLeave={onDragLeave}
           onPaste={onPaste}
      >
        {isDragging && (
            <div className="absolute inset-0 z-10 bg-accent/20 backdrop-blur-[1px] flex items-center justify-center rounded-xl pointer-events-none">
                <span className="text-white font-bold bg-bg0 px-4 py-2 rounded-full border border-accent">Drop files to attach</span>
            </div>
        )}
        
        {/* Dropped Files UI */}
        {droppedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 px-1 max-h-24 overflow-y-auto">
                {droppedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-1 bg-bg2 border border-border px-2 py-1 rounded text-xs text-gray-300">
                        <span>{f.type === 'image' ? '🖼' : '📄'}</span>
                        <span className="truncate max-w-[150px]">{f.filename}</span>
                        <button onClick={() => setDroppedFiles(d => d.filter((_, idx) => idx !== i))} className="text-gray-500 hover:text-red ml-1">✕</button>
                    </div>
                ))}
            </div>
        )}
        {showTestCmd && (
          <div className="flex items-center gap-2 mb-2 px-1">
             <span className="text-xs text-gray-400">⚡ Auto-run after edits:</span>
             <input type="text"
               value={testCmd}
               onChange={e => setTestCmd(e.target.value)}
               placeholder="e.g. npm test or python main.py"
               className="bg-bg2 border border-border text-xs px-2 py-1 rounded w-64 text-white outline-none focus:border-accent"
             />
             <button onClick={() => { setTestCmd(''); setShowTestCmd(false) }} className="text-gray-500 hover:text-white">✕</button>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className={`flex-1 flex gap-2 bg-bg2 border rounded-xl px-3 py-2.5 transition-colors
            ${running ? 'border-accent/30' : 'border-border focus-within:border-accent'}`}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={onInputChange}
              onKeyDown={onKey}
              disabled={running}
              placeholder={
                !project ? 'Open a project first using the + tab...' :
                !ollamaOnline ? 'Ollama is offline — run: ollama serve' :
                running ? 'Agent is working...' :
                'Describe what you want to build, fix, or improve... (Enter to send)'
              }
              rows={1}
              style={{ maxHeight: 180 }}
              className="w-full bg-transparent text-white text-sm outline-none resize-none placeholder-gray-600 select-text leading-relaxed"
            />
            
            <button 
              onClick={handleVoice} 
              disabled={running}
              className={`w-6 h-6 flex items-center justify-center rounded-full self-end mb-0.5 flex-shrink-0 transition-colors
                 ${recording ? 'bg-red-500 text-white animate-pulse' : 'text-gray-500 hover:text-white hover:bg-bg3'}`}
              title="Voice Input">
              🎤
            </button>
          </div>

          <button
            id="chat-send-btn"
            onClick={(e) => {
                if (running) stop()
                else {
                    // check dataset for auto reply hack
                    if (e.target.dataset.autoMsg) {
                        const tmp = input
                        setInput(e.target.dataset.autoMsg)
                        setTimeout(() => {
                            // Needs state update tick
                            send()
                        }, 50)
                        delete e.target.dataset.autoMsg
                    } else {
                        send()
                    }
                }
            }}
            disabled={(!project && !running) || isDragging}
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all flex-shrink-0
              ${running
                ? 'bg-red/20 border border-red/50 text-red hover:bg-red hover:text-white'
                : 'bg-accent hover:bg-accent/80 text-white disabled:bg-bg3 disabled:text-gray-600 disabled:cursor-not-allowed'
              }`}
          >
            {running ? '■' : '▲'}
          </button>
        </div>

        <div className="flex items-center justify-between mt-2 px-1">
          <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
            <span className="hidden sm:inline">⬡ Reads entire project automatically</span>
            {project && <span className="hidden sm:inline">· {project.path.split(/[\\/]/).pop()}</span>}
            <button onClick={() => setShowTestCmd(!showTestCmd)} className={`px-2 py-0.5 rounded border transition-colors ${showTestCmd || testCmd ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border hover:text-gray-400'}`}>
               ⚡ Test Loop {testCmd ? 'ON' : 'OFF'}
            </button>
            <button onClick={() => {
                if (!project) return
                fetch(`/api/git/undo?path=${encodeURIComponent(project.path)}`, { method: 'POST' })
                    .then(r => r.json())
                    .then(d => {
                        if (d.ok) setMessages(m => [...m, { role: 'ai', content: '↩️ **Reverted last AI edit** (`git reset --hard HEAD~1`).\n\nThe project state has been restored to what it was before my last change.' }])
                        else alert("Failed to undo: " + d.error)
                    })
            }} className="px-2 py-0.5 rounded border border-border hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 transition-colors" title="Git reset hard HEAD~1">
               ↩️ Undo Last AI Edit
            </button>
          </div>
          
          <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                   const md = messages.map(m => `**${m.role.toUpperCase()}**:\n${m.content || m.events.map(e => `[${e.event}] ${e.text}`).join('\n')}`).join('\n\n---\n\n')
                   const blob = new Blob([md], {type: 'text/markdown'})
                   const url = URL.createObjectURL(blob)
                   const a = document.createElement('a')
                   a.href = url
                   a.download = `chat_export_${new Date().toISOString()}.md`
                   a.click()
                }} 
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors" title="Export Chat History">
                Export
              </button>
              <button onClick={clearChat} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
                Clear
              </button>
          </div>
        </div>
      </div>
    </div>
  )
}
