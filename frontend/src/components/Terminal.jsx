import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const WS_BASE = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
const QUICK_CMDS = ['npm run dev', 'npm install', 'python main.py', 'git status', 'ls -la']

export default function Terminal({ project }) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const fitAddonRef = useRef(null)
  const wsRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [height, setHeight] = useState(240)
  const resizing = useRef(false)

  // Initialize XTerm only once
  useEffect(() => {
    if (!terminalRef.current) return
    
    const xterm = new XTerm({
      cursorBlink: true,
      fontFamily: '"Fira Code", monospace',
      fontSize: 13,
      theme: {
        background: '#1d1f21',
        foreground: '#c5c8c6',
        cursor: '#f81ce5'
      }
    })
    
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(terminalRef.current)
    fitAddon.fit()
    
    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(terminalRef.current)

    return () => {
      resizeObserver.disconnect()
      xterm.dispose()
    }
  }, [])

  // Connect WebSocket
  useEffect(() => {
    if (!project || !xtermRef.current) return
    
    const connect = () => {
      const ws = new WebSocket(`${WS_BASE}/ws/terminal`)
      wsRef.current = ws
      
      ws.onopen = () => {
        ws.send(JSON.stringify({ cwd: project.path }))
      }
      
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data)
        if (d.type === 'ready') {
          setConnected(true)
          xtermRef.current.clear()
          xtermRef.current.writeln(`\x1b[32m✔ Connected to project: ${project.path}\x1b[0m\r\n`)
          // Optional: We can send a test cmd or empty enter to get the prompt
          ws.send(JSON.stringify({ type: 'input', text: '\n' }))
        } else if (d.type === 'output') {
          // XTerm handles ANSI color codes automatically
          xtermRef.current.write(d.text)
        }
      }
      
      ws.onclose = () => {
        setConnected(false)
        xtermRef.current.writeln('\r\n\x1b[31m[Disconnected from Terminal WebSocket]\x1b[0m\r\n')
      }
    }
    
    connect()

    // Handle user typing
    const onData = xtermRef.current.onData(data => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', text: data }))
      }
    })

    return () => {
      onData.dispose()
      wsRef.current?.close()
    }
  }, [project?.path])
  
  const sendCmd = (cmd) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
          // send command + carriage return
          wsRef.current.send(JSON.stringify({ type: 'input', text: cmd + '\r' }))
          xtermRef.current.focus()
      }
  }

  // Resize Handle
  const onResizeDown = (e) => {
    resizing.current = true
    const startY = e.clientY, startH = height
    const onMove = (e) => { 
        if (resizing.current) {
            setHeight(Math.max(100, Math.min(800, startH + startY - e.clientY)))
            fitAddonRef.current?.fit()
        } 
    }
    const onUp = () => { resizing.current = false; window.removeEventListener('mousemove', onMove) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp, { once: true })
  }

  return (
    <div className="bg-[#1d1f21] border-t border-border flex-shrink-0 flex flex-col relative" style={{ height }}>
      {/* Resize bar */}
      <div className="h-1 absolute top-0 left-0 right-0 z-10 hover:bg-accent/30 cursor-ns-resize transition-colors" onMouseDown={onResizeDown} />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 bg-bg1 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Terminal</span>
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_5px_#22c55e]' : 'bg-red-500'}`} />
        </div>
        
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {QUICK_CMDS.map(cmd => (
            <button key={cmd} onClick={() => sendCmd(cmd)}
              className="text-[10px] font-mono text-gray-400 hover:text-white bg-bg2 hover:bg-bg3 px-2 py-0.5 rounded border border-border transition-all whitespace-nowrap">
              {cmd}
            </button>
          ))}
        </div>
      </div>

      {/* XTerm Container */}
      <div className="flex-1 w-full overflow-hidden p-2" ref={terminalRef} />
    </div>
  )
}
