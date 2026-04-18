import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, 
  Eye, 
  Brain, 
  Zap, 
  ShieldCheck, 
  Terminal, 
  Play, 
  Square, 
  Wallet, 
  AlertTriangle,
  CheckCircle2,
  RefreshCcw,
  Clock,
  Database,
  Lock,
  MessageSquare,
  Cpu,
  Layers,
  Search,
  Settings,
  X,
  Network,
  Bug
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LogEntry {
  time: string;
  stage: string;
  data: any;
}

const NeuralBackground = () => {
  const nodes = useMemo(() => Array.from({ length: 15 }).map(() => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 4 + 2,
    delay: Math.random() * 2
  })), []);

  return (
    <div className="fixed inset-0 pointer-events-none opacity-20 overflow-hidden">
      <svg className="w-full h-full">
        {nodes.map((node, i) => (
          <React.Fragment key={i}>
            {nodes.slice(i + 1, i + 4).map((target, j) => (
              <line
                key={j}
                x1={`${node.x}%`}
                y1={`${node.y}%`}
                x2={`${target.x}%`}
                y2={`${target.y}%`}
                stroke="var(--accent-cyan)"
                strokeWidth="0.5"
                opacity="0.2"
              />
            ))}
            <circle
              cx={`${node.x}%`}
              cy={`${node.y}%`}
              r={node.size}
              fill="var(--accent-cyan)"
              className="neural-node"
              style={{ animationDelay: `${node.delay}s` }}
            />
          </React.Fragment>
        ))}
      </svg>
    </div>
  );
};

export default function App() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<any>(null);
  const [memory, setMemory] = useState<any>(null);
  const [command, setCommand] = useState('');
  const [isCommandLoading, setIsCommandLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const fetchMemory = async () => {
    try {
      const res = await fetch('/api/memory');
      const data = await res.json();
      setMemory(data);
    } catch (err) {
      console.error('Failed to fetch memory:', err);
    }
  };

  const fetchDebugData = async () => {
    try {
      const res = await fetch('/api/debug/state');
      const data = await res.json();
      setDebugData(data);
    } catch (err) {
      console.error('Failed to fetch debug state:', err);
    }
  };

  const handleControl = async (action: 'start' | 'stop' | 'set_interval', interval?: number) => {
    try {
      await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, interval })
      });
      if (action === 'start') setIsRunning(true);
      if (action === 'stop') setIsRunning(false);
      fetchStatus();
      if (isDebugOpen) fetchDebugData();
    } catch (err) {
      console.error('Failed to control agent:', err);
    }
  };

  const sendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || isCommandLoading) return;

    setIsCommandLoading(true);
    try {
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      setCommand('');
    } catch (err) {
      console.error('Failed to send command:', err);
    } finally {
      setIsCommandLoading(false);
    }
  };

  // Real-time log streaming via WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/logs`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') {
          setLogs(msg.logs);
        } else if (msg.type === 'log') {
          setLogs(prev => [msg.entry, ...prev].slice(0, 100));
        }
      } catch (_) { /* ignore malformed frames */ }
    };

    ws.onerror = () => {
      // Fallback: fetch logs once if WebSocket fails
      fetch('/api/logs').then(r => r.json()).then(setLogs).catch(() => {});
    };

    return () => ws.close();
  }, []);

  // Poll status and debug state (lightweight — no log fetching)
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
      if (isDebugOpen) fetchDebugData();
    }, 2000);
    return () => clearInterval(interval);
  }, [isDebugOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs]);

  /**
   * Maps a log stage name to its Tailwind color classes for the audit badge.
   * Covers the actual stage names emitted by the server modules.
   */
  const getStageColor = (stage: string): string => {
    if (stage === 'observe') return 'text-immersive-cyan border-immersive-cyan/20 bg-immersive-cyan/5';
    if (stage.includes('reflect')) return 'text-blue-400 border-blue-500/20 bg-blue-500/5';
    if (stage.includes('executor') || stage === 'act') return 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5';
    if (stage.includes('sniper') || stage.includes('rule') || stage.includes('validator') || stage === 'decide') return 'text-immersive-amber border-immersive-amber/20 bg-immersive-amber/5';
    if (stage.includes('plan') || stage === 'think_and_act' || stage === 'think') return 'text-purple-400 border-purple-500/20 bg-purple-500/5';
    return 'text-white/40 border-white/10 bg-white/5';
  };

  /**
   * Returns true when the latest log entry belongs to the given cognitive node.
   */
  const isStageActive = (nodeId: string, latestStage: string): boolean => {
    switch (nodeId) {
      case 'observe':  return latestStage === 'observe';
      case 'think':    return latestStage.includes('plan') || latestStage === 'think_and_act' || latestStage === 'think';
      case 'decide':   return latestStage.includes('sniper') || latestStage.includes('rule') || latestStage.includes('validator') || latestStage === 'decide';
      case 'act':      return latestStage.includes('executor') || latestStage === 'act';
      case 'reflect':  return latestStage.includes('reflect');
      default:         return false;
    }
  };

  const renderDataPreview = (data: any) => {
    const safeString = (val: any): string => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') {
        return val.type || val.action || val.status || JSON.stringify(val).slice(0, 20);
      }
      return String(val);
    };

    if (Array.isArray(data)) {
      return (
        <div className="space-y-1 mt-1">
          {data.slice(0, 2).map((item, i) => (
            <div key={i} className="text-[10px] bg-white/5 p-1 rounded border border-white/5 font-mono text-immersive-dim">
              {safeString(item.type || item.action || item.status || 'ENTRY')}: {safeString(item.value || item.target?.type || item.outcome || '...')}
            </div>
          ))}
        </div>
      );
    }
    return <div className="text-[10px] opacity-60 font-mono mt-1 overflow-hidden whitespace-nowrap overflow-ellipsis">{JSON.stringify(data).slice(0, 50)}</div>;
  };

  return (
    <div className="h-screen flex flex-col font-sans overflow-hidden bg-immersive-bg relative">
      <NeuralBackground />
      
      {/* Top Header */}
      <header className="h-16 px-8 flex items-center justify-between relative z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-immersive-cyan/10 flex items-center justify-center border border-immersive-cyan/20">
            <Cpu className="text-immersive-cyan w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white/90">
            RSEA <span className="text-immersive-cyan font-mono text-sm opacity-60">v1.2 // CORE</span>
          </h1>
        </div>

        <div className="flex items-center gap-6 glass px-6 py-2 rounded-full border border-white/5">
          <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest text-immersive-dim">
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-immersive-cyan shadow-[0_0_8px_var(--accent-cyan)] pulse' : 'bg-immersive-red'}`} />
            LOOP: {isRunning ? 'PROCESS' : 'IDLE'}
          </div>
          <div className="h-4 w-[1px] bg-white/10" />
          <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest text-immersive-dim">
            UPTIME: {status?.uptime ? Math.floor(status.uptime / 60).toString().padStart(2, '0') + ':' + Math.floor(status.uptime % 60).toString().padStart(2, '0') : '00:00'}
          </div>
          <button 
            onClick={() => handleControl(isRunning ? 'stop' : 'start')}
            className={`flex items-center gap-2 px-4 py-1 rounded-full border transition-all font-mono text-[10px] uppercase tracking-widest
              ${isRunning ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20' : 'bg-immersive-cyan/10 border-immersive-cyan/30 text-immersive-cyan hover:bg-immersive-cyan/20'}`}
          >
            {isRunning ? 'Abort' : 'Initiate'}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <button className="p-2 text-white/40 hover:text-white transition-colors">
            <Search className="w-5 h-5" />
          </button>
          <button 
            onClick={() => { fetchDebugData(); setIsDebugOpen(true); }}
            className={`p-2 transition-colors ${isDebugOpen ? 'text-immersive-cyan shadow-[0_0_15px_rgba(0,242,255,0.3)]' : 'text-white/40 hover:text-white'}`}
          >
            <Bug className="w-5 h-5" />
          </button>
          <button className="p-2 text-white/40 hover:text-white transition-colors">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Bento Layout */}
      <main className="flex-1 p-6 grid grid-cols-12 grid-rows-6 gap-4 relative z-10 overflow-hidden">
        
        {/* Memory Bento */}
        <div className="col-span-3 row-span-3 glass-card p-6 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[11px] font-mono tracking-[0.2em] text-immersive-dim">MEMORY_CORE</h2>
            <button 
              onClick={() => { fetchMemory(); setIsMemoryOpen(true); }}
              className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-immersive-cyan hover:bg-white/10"
            >
              <Database className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-4 font-mono text-[11px]">
            <div className="group cursor-default">
              <div className="text-white/40 mb-1 flex justify-between">
                <span>SHORT_TERM</span>
                <span>{memory?.shortTerm?.length || 0}/50</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-immersive-cyan"
                  initial={{ width: 0 }}
                  animate={{ width: `${((memory?.shortTerm?.length || 0) / 50) * 100}%` }}
                />
              </div>
            </div>
            <div className="group cursor-default">
              <div className="text-white/40 mb-1 flex justify-between">
                <span>LONG_TERM</span>
                <span>{memory?.longTerm ? Object.keys(memory.longTerm).length : 0}</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-immersive-amber"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((memory?.longTerm ? Object.keys(memory.longTerm).length : 0) / 100 * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-auto grid grid-cols-2 gap-2">
            <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-center">
              <div className="text-[9px] text-white/30 uppercase mb-1">Engaged</div>
              <div className="text-lg font-bold text-immersive-cyan">142</div>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-center">
              <div className="text-[9px] text-white/30 uppercase mb-1">Success</div>
              <div className="text-lg font-bold text-emerald-400">98%</div>
            </div>
          </div>
        </div>

        {/* Cognitive Workflow Bento */}
        <div className="col-span-6 row-span-4 glass-card p-8 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8">
            <Layers className="w-12 h-12 text-immersive-cyan/10" />
          </div>
          <h2 className="text-[11px] font-mono tracking-[0.2em] text-immersive-dim mb-8">COGNITIVE_SYNAPSE</h2>
          
          <div className="flex-1 flex items-center justify-between relative px-8">
            {[
              { id: 'observe', label: 'Observe', icon: Eye },
              { id: 'think', label: 'Think', icon: Brain },
              { id: 'decide', label: 'Decide', icon: CheckCircle2 },
              { id: 'act', label: 'Act', icon: Zap },
              { id: 'reflect', label: 'Reflect', icon: Network }
            ].map((node, i) => {
              const isActive = logs.length > 0 && isStageActive(node.id, logs[0].stage);
              return (
                <div key={node.id} className="relative flex flex-col items-center">
                  <motion.div 
                    animate={isActive ? { scale: 1.1, borderColor: '#00f2ff' } : { scale: 1 }}
                    className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border glass flex items-center justify-center relative z-10 transition-all duration-500
                      ${isActive ? 'shadow-[0_0_30px_rgba(0,242,255,0.2)] bg-immersive-cyan/5' : 'border-white/5 opacity-40'}
                    `}
                  >
                    <node.icon className={`w-6 h-6 sm:w-8 sm:h-8 ${isActive ? 'text-immersive-cyan' : 'text-white'}`} />
                  </motion.div>
                  <span className={`mt-4 text-[9px] sm:text-[10px] font-mono tracking-widest ${isActive ? 'text-white font-bold' : 'text-white/20'}`}>
                    {node.label.toUpperCase()}
                  </span>
                  
                  {i < 4 && (
                    <div className="absolute left-[110%] top-1/2 -translate-y-1/2 w-8 sm:w-12 h-[1px] bg-white/5 overflow-hidden">
                      <motion.div 
                        className="h-full w-full bg-immersive-cyan"
                        animate={isActive ? { x: ['-100%', '100%'] } : { x: '-100%' }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Audit Stream Bento */}
        <div className="col-span-3 row-span-6 glass-card p-6 flex flex-col">
          <h2 className="text-[11px] font-mono tracking-[0.2em] text-immersive-dim mb-6">AUDIT_PROTOCOL</h2>
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4"
          >
            <AnimatePresence mode="popLayout">
              {logs.map((log, idx) => (
                <motion.div 
                  key={log.time + idx}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white/[0.03] p-4 rounded-xl border border-white/5 relative group"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${getStageColor(log.stage)}`}>{log.stage.toUpperCase()}</span>
                    <span className="text-[8px] font-mono opacity-30">{new Date(log.time).toLocaleTimeString([], { hour12: false })}</span>
                  </div>
                  <div className="text-immersive-dim leading-relaxed italic">
                    {renderDataPreview(log.data)}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Economy Bento */}
        <div className="col-span-3 row-span-3 glass-card p-6 flex flex-col">
          <h2 className="text-[11px] font-mono tracking-[0.2em] text-immersive-dim mb-4">WALLET_DYNAMICS</h2>
          <div className="flex-1 flex flex-col justify-center">
            <div className="text-3xl font-bold text-white mb-2">1,402.50 <span className="text-sm font-mono opacity-30">CRS</span></div>
            <div className="text-emerald-400 font-mono text-[10px] flex items-center gap-1">
              <Activity className="w-3 h-3" /> +12.4% THIS_WINDOW
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] text-white/30 truncate">RESERVE_LOCK</span>
              <Lock className="w-3 h-3 text-immersive-red" />
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full w-4/5 bg-immersive-red/40" />
            </div>
          </div>
        </div>

        {/* Stats Bento */}
        <div className="col-span-6 row-span-2 glass-card p-6 flex items-center justify-between relative overflow-hidden">
          
          <div className="flex-1 flex flex-col justify-center h-full pr-8 border-r border-white/5">
            <h3 className="text-[9px] font-mono tracking-[0.2em] text-immersive-cyan mb-2 flex items-center gap-2">
              <Activity className="w-3 h-3" />
              ACTIVE_DIRECTIVE
            </h3>
            <p className="text-xs text-white/80 leading-relaxed max-w-sm limit-2-lines">
              {status?.goals?.primary || "Awaiting primary objective..."}
            </p>
          </div>

          <div className="w-1/3 h-full flex flex-col justify-center gap-2 pl-8">
            <div className="flex justify-between text-[10px] font-mono">
              <span className="opacity-40">CPU_IDLE</span>
              <span className="text-immersive-cyan">4%</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-2">
              <motion.div 
                className="h-full bg-immersive-cyan"
                animate={{ width: ['2%', '6%', '4%'] }}
                transition={{ repeat: Infinity, duration: 2 }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="opacity-40">AUTO_GOALS</span>
              <span className="text-immersive-amber">{status?.goals?.subTasks?.length || 0}</span>
            </div>
          </div>
        </div>

      </main>

      {/* Global Command Console Footer */}
      <footer className="h-20 px-6 py-3 glass border-t border-white/5 relative z-50 flex items-center gap-6">
        <div className="flex items-center gap-3 text-white/20">
          <Terminal className="w-5 h-5" />
          <div className="h-6 w-[1px] bg-white/5" />
        </div>
        
        <form onSubmit={sendCommand} className="flex-1 flex gap-4">
          <div className="flex-1 relative group">
            <input 
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="SYSTEM_OVERRIDE_INPUT > Await data..."
              className="w-full bg-white/[0.02] border border-white/5 rounded-xl py-3 px-6 text-sm font-mono text-immersive-cyan placeholder:text-white/10 focus:outline-none focus:border-immersive-cyan/30 focus:bg-white/[0.04] transition-all"
              disabled={isCommandLoading}
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
              <span className="text-[10px] font-mono text-white/5 tracking-widest uppercase">Direct_Synapse_Link</span>
            </div>
          </div>
          
          <button 
            type="submit"
            disabled={!command.trim() || isCommandLoading}
            className={`px-8 rounded-xl flex items-center gap-3 font-mono text-xs uppercase tracking-widest transition-all
              ${!command.trim() || isCommandLoading 
                ? 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed' 
                : 'bg-immersive-cyan/10 border border-immersive-cyan/30 text-immersive-cyan hover:bg-immersive-cyan/20 active:scale-95 shadow-[0_0_20px_rgba(0,242,255,0.05)]'}
            `}
          >
            {isCommandLoading ? (
              <RefreshCcw className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {isCommandLoading ? 'TRANSMITTING' : 'EXECUTE'}
          </button>
        </form>

        <div className="hidden xl:flex items-center gap-6 px-4 border-l border-white/5">
          <div className="flex flex-col">
            <span className="text-[8px] text-white/20 uppercase tracking-tighter">LATENCY</span>
            <span className="text-xs font-bold text-emerald-400">12ms</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] text-white/20 uppercase tracking-tighter">SECURITY</span>
            <ShieldCheck className="w-4 h-4 text-immersive-cyan" />
          </div>
        </div>
      </footer>

      {/* Debug Tools Modal */}
      <AnimatePresence>
        {isDebugOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-4xl max-h-[85vh] glass-card flex flex-col shadow-2xl relative overflow-hidden ring-1 ring-white/10"
            >
              <div className="h-14 px-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3 text-white/60 font-mono text-sm tracking-widest">
                  <Bug className="w-4 h-4 text-immersive-red" />
                  DEVELOPER_TOOLS // RSEA_INSPECTOR
                </div>
                <button 
                  onClick={() => setIsDebugOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 font-mono text-[11px] bg-[#0a0a0c] text-white/70 space-y-8 custom-scrollbar">
                
                {/* Loop State */}
                <section>
                  <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
                    <div className="text-immersive-cyan uppercase tracking-[0.2em]">Loop Telemetry</div>
                    
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleControl('start')}
                        disabled={debugData?.loop?.isRunning}
                        className={`p-1.5 rounded flex items-center justify-center border transition-all ${debugData?.loop?.isRunning ? 'opacity-30 cursor-not-allowed bg-transparent border-transparent text-white' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'}`}
                        title="Start Loop"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleControl('stop')}
                        disabled={!debugData?.loop?.isRunning}
                        className={`p-1.5 rounded flex items-center justify-center border transition-all ${!debugData?.loop?.isRunning ? 'opacity-30 cursor-not-allowed bg-transparent border-transparent text-white' : 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20'}`}
                        title="Stop Loop"
                      >
                        <Square className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                    <div className="p-3 bg-white/[0.02] rounded border border-white/5">
                      <div className="text-white/30 uppercase text-[9px] mb-1">State</div>
                      <div className={debugData?.loop?.isRunning ? 'text-emerald-400' : 'text-immersive-red'}>
                        {debugData?.loop?.isRunning ? 'RUNNING' : 'HALTED'}
                      </div>
                    </div>
                    <div className="p-3 bg-white/[0.02] rounded border border-white/5">
                      <div className="text-white/30 uppercase text-[9px] mb-1">Cycle Count</div>
                      <div className="text-white/90">{debugData?.loop?.cycleCount || 0}</div>
                    </div>
                    <div className="p-3 bg-white/[0.02] rounded border border-white/5">
                      <div className="text-white/30 uppercase text-[9px] mb-1">Last Exec Time</div>
                      <div className="text-white/90">{debugData?.loop?.lastExecutionTime || 0}ms</div>
                    </div>
                    <div className="p-3 bg-white/[0.02] rounded border border-white/5 relative group">
                      <div className="text-white/30 uppercase text-[9px] mb-1">Interval</div>
                      <div className="text-white/90 flex items-center justify-between">
                        {debugData?.loop?.interval || 0}ms
                      </div>
                      
                      <div className="absolute top-1 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleControl('set_interval', 2000)} className="px-1 text-[8px] bg-white/10 hover:bg-white/20 rounded">2s</button>
                        <button onClick={() => handleControl('set_interval', 5000)} className="px-1 text-[8px] bg-white/10 hover:bg-white/20 rounded">5s</button>
                        <button onClick={() => handleControl('set_interval', 10000)} className="px-1 text-[8px] bg-white/10 hover:bg-white/20 rounded">10s</button>
                      </div>
                    </div>
                  </div>
                  {debugData?.loop?.lastError && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded">
                      <div className="uppercase text-[9px] mb-1 opacity-70">Last Error</div>
                      {debugData.loop.lastError}
                    </div>
                  )}
                </section>

                {/* Agent Goals */}
                <section>
                  <div className="text-immersive-amber mb-2 uppercase tracking-[0.2em] border-b border-white/10 pb-2">Active Objectives</div>
                  <div className="bg-white/[0.02] p-4 rounded border border-white/5 mt-4">
                    <div className="text-white/40 uppercase text-[9px] mb-1">Primary Directive</div>
                    <div className="text-immersive-main mb-4 leading-relaxed">{debugData?.goals?.primary}</div>
                    
                    <div className="text-white/40 uppercase text-[9px] mb-2">Subtasks</div>
                    <ul className="space-y-2">
                      {debugData?.goals?.subTasks?.map((task: string, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-immersive-cyan">{'>'}</span> {task}
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                {/* Memory Internals */}
                <section>
                  <div className="text-purple-400 mb-2 uppercase tracking-[0.2em] border-b border-white/10 pb-2">Memory Allocation</div>
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="p-3 bg-white/[0.02] rounded border border-white/5 flex justify-between items-center">
                      <div className="text-white/40 uppercase text-[9px]">Short Term Buffer</div>
                      <div className="text-white/90">{debugData?.memoryStats?.shortTermCount || 0} / 50 records</div>
                    </div>
                    <div className="p-3 bg-white/[0.02] rounded border border-white/5 flex justify-between items-center">
                      <div className="text-white/40 uppercase text-[9px]">Long Term Synapses</div>
                      <div className="text-white/90">{debugData?.memoryStats?.longTermCount || 0} records</div>
                    </div>
                  </div>
                </section>

                {/* Environment */}
                <section>
                  <div className="text-white/50 mb-2 uppercase tracking-[0.2em] border-b border-white/10 pb-2">System Spec</div>
                  <div className="mt-4 p-4 bg-white/[0.02] rounded border border-white/5">
                    <pre className="text-white/60">
                      NODE_ENV: {debugData?.nodeEnv}{'\n'}
                      AGENT_FRAMEWORK: v1.2 (RSEA){'\n'}
                      MEMORY_FILE: /data/memory.db (SQLite){'\n'}
                      LOGGING_FILE: /data/logs.json
                    </pre>
                  </div>
                </section>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Memory Dashboard Modal */}
      <AnimatePresence>
        {isMemoryOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-5xl max-h-[85vh] glass-card flex flex-col shadow-2xl relative overflow-hidden"
            >
              <div className="h-16 px-8 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3 text-immersive-cyan font-mono text-sm tracking-widest">
                  <Database className="w-5 h-5" />
                  MEMORY_CORE_VAULT // {memory?.longTerm ? Object.keys(memory.longTerm).length : 0}_RECORDS
                </div>
                <button 
                  onClick={() => setIsMemoryOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-hidden grid grid-cols-2 gap-[1px] bg-white/5">
                {/* Short-term Memory Column */}
                <div className="bg-immersive-bg/40 p-8 flex flex-col overflow-hidden">
                  <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-6 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-immersive-cyan" />
                    Neural Buffer [Temporal]
                  </div>
                  <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-3">
                    {memory?.shortTerm?.slice().reverse().map((event: any, i: number) => (
                      <div key={i} className="p-3 rounded-xl border border-white/5 bg-white/[0.02] font-mono text-[11px] group">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-white/40">{(event.type ?? 'event').toUpperCase()}</span>
                          <span className="text-white/20 text-[9px]">{new Date(event.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-immersive-dim truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:break-all transition-all">
                          {event.data !== undefined ? JSON.stringify(event.data) : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Long-term Memory Column */}
                <div className="bg-immersive-bg/40 p-8 flex flex-col overflow-hidden text-immersive-main">
                  <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-6 flex items-center gap-2">
                    <Brain className="w-4 h-4 text-immersive-amber" />
                    Persistent Synapse [Knowledge]
                  </div>
                  <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-6">
                    {memory?.longTerm && Object.entries(memory.longTerm).map(([key, value]: [string, any]) => (
                      <div key={key} className="space-y-2">
                        <div className="text-immersive-cyan font-mono text-[11px] uppercase tracking-widest flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-immersive-cyan shadow-[0_0_8px_rgba(0,242,255,1)]" />
                          {key}
                        </div>
                        <div className="p-4 rounded-2xl border border-white/5 bg-white/[0.01] text-[11px] font-mono leading-relaxed text-white/60">
                          {typeof value === 'object' ? (
                            <pre className="whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
                          ) : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="h-12 px-8 border-t border-white/5 flex items-center text-[10px] text-white/20 font-mono gap-6 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <Activity className="w-3 h-3 text-emerald-500" />
                  SNAPSHOT_STABLE_V1.0
                </div>
                <div className="ml-auto flex items-center gap-4">
                  <span>AES-256_ENCRYPTED</span>
                  <div className="w-1 h-3 bg-white/10" />
                  <span>READ_ONLY_PROTOCOL</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}


