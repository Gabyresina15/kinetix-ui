import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Mic,
  RotateCcw,
  Upload,
  XCircle,
  Zap,
  Sparkles,
  Package,
  Terminal,
  Play,
  AlertTriangle,
  Scan,
  CheckCircle2
} from 'lucide-react';

import {
  SpatialMask,
  InventoryItem,
  ExecutionStep,
  TelemetryState,
  SupplierClaim,
  StudioCatalogResult,
  VmExecutionResult,
  MaskStatus,
} from './core/types';
import { useSpatialCamera } from './core/useSpatialCamera';
import { useKinetixStream } from './core/useKinetixStream';
import { useDominoQueue } from './core/useDominoQueue';
import { TelemetryHud } from './components/TelemetryHud';
import { ReasoningTerminal } from './components/ReasoningTerminal';
import { AgentDagPanel } from './components/AgentDagPanel';

// --- CONSTANTS ---
const MASK_STYLE_MAP: Record<string, string> = {
  IDLE_OBSERVED: 'border-slate-500/60 text-slate-300',
  IDLE: 'border-slate-500/60 text-slate-300',
  QUARANTINED: 'border-rose-500 text-rose-100 shadow-[0_0_12px_rgba(244,63,94,0.6)]',
  STOCK_MUTATED: 'border-emerald-400 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.6)]',
  CATALOG_SYNTH: 'border-cyan-400 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.6)]',
  PII_REDACTED: 'border-amber-400 bg-amber-400/20 text-amber-100',
};

const resolveMaskStyle = (status: MaskStatus | undefined): string =>
  MASK_STYLE_MAP[status ?? 'IDLE_OBSERVED'] || MASK_STYLE_MAP.IDLE_OBSERVED;

const DEFAULT_PROMPT =
  'El cooler de torre con tubos de cobre vino con una aleta golpeada, abrí reclamo. Sumá al stock los dos módulos de memoria RAM y el disco SSD M.2. Armame la foto de estudio para la fuente de poder modular y recalculá precios con 32% de margen.';

const INITIAL_STEPS: ExecutionStep[] = [
  { id: 'edge_pii', title: 'Edge Cognitive Filter & PII Redaction', model: 'muse-spark-open-1026', status: 'PENDING' },
  { id: 'sam_lock', title: '2D Spatial Grounding & Pixel Crop', model: 'Muse Spark Vision + Sharp', status: 'PENDING' },
  { id: 'spark_plan', title: 'Multi-Tool DAG Planning', model: 'Muse Spark Open (Baseten)', status: 'PENDING' },
  { id: 'quarantine_and_claim', title: 'Tool: Quarantine & Supplier Claim', model: 'Action Engine', status: 'PENDING' },
  { id: 'mutate_inventory', title: 'Tool: Inventory SKU Auto-Upsert', model: 'Action Engine', status: 'PENDING' },
  { id: 'generate_studio_catalog', title: 'Tool: Crop-to-Studio Synthesis', model: 'Muse Image', status: 'PENDING' },
  { id: 'recalculate_margins_vm', title: 'Tool: Financial Margin Sandbox', model: 'Muse Code (node:vm)', status: 'PENDING' },
];

export default function App() {
  const {
    videoRef,
    canvasRef,
    sceneImgRef,
    uploadedImage,
    sourceDims,
    cameraActive,
    startCamera,
    handleImageUpload,
    captureFrameBase64,
  } = useSpatialCamera();

  const { runStream, abortStream } = useKinetixStream();
  const { enqueue, clearQueue } = useDominoQueue(180);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [isFrozen, setIsFrozen] = useState(false);
  const [flashEffect, setFlashEffect] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);
  const [shouldAutoTrigger, setShouldAutoTrigger] = useState(false);

  const [masks, setMasks] = useState<SpatialMask[]>([]);
  const [activePulse, setActivePulse] = useState<{ id: string; actionText: string } | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);

  const speakTactical = useCallback((msg: string) => {
    if (!ttsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(msg);
    u.lang = 'en-US';
    u.rate = 1.08;
    u.pitch = 0.92;
    window.speechSynthesis.speak(u);
  }, [ttsEnabled]);

  const [telemetry, setTelemetry] = useState<TelemetryState>({
    glimmerMs: 0, samMs: 0, sparkMs: 0, segmenter: 'Sharp crop', tokensSavedPct: 0, piiRedacted: 0,
  });

  const [steps, setSteps] = useState<ExecutionStep[]>(INITIAL_STEPS);
  const [inventory, setInventory] = useState<InventoryItem[]>([{ sku: 'LOADING', name: 'Syncing live ledger with Kinetix Backend...', stock: 0 }]);
  const [latestClaim, setLatestClaim] = useState<SupplierClaim | null>(null);
  const [latestCatalog, setLatestCatalog] = useState<StudioCatalogResult | null>(null);
  const [vmExecution, setVmExecution] = useState<VmExecutionResult | null>(null);
  const [voiceText, setVoiceText] = useState(DEFAULT_PROMPT);
  const [reasoningTrace, setReasoningTrace] = useState('');

  const fetchLiveLedger = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:4000/api/live-ledger');
      const data = await res.json();
      if (data.ok && Array.isArray(data.inventory)) {
        setInventory(data.inventory);
      }
    } catch (err) {
      console.error('Failed to sync live ledger', err);
    }
  }, []);

  useEffect(() => {
    fetchLiveLedger();
  }, [fetchLiveLedger]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const stageBox = (() => {
    if (!sourceDims || !stageSize.w || !stageSize.h) return null;
    const scale = Math.min(stageSize.w / sourceDims.w, stageSize.h / sourceDims.h);
    return { w: sourceDims.w * scale, h: sourceDims.h * scale };
  })();

  const updateStep = useCallback((id: string, patch: Partial<ExecutionStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const getMaskStatusForTool = (tool: string): MaskStatus => {
    switch (tool) {
      case 'quarantine_and_claim': return 'QUARANTINED';
      case 'mutate_inventory': return 'STOCK_MUTATED';
      case 'generate_studio_catalog': return 'CATALOG_SYNTH';
      default: return 'IDLE_OBSERVED';
    }
  };

  const getPulseActionText = (tool: string): string => {
    switch (tool) {
      case 'quarantine_and_claim': return 'QUARANTINED';
      case 'mutate_inventory': return '+ STOCK';
      case 'generate_studio_catalog': return '8K SYNTH';
      case 'recalculate_margins_vm': return 'REPRICED';
      default: return 'UPDATED';
    }
  };

  const triggerOrchestration = useCallback(async () => {
    // Abortar proactivamente cualquier stream anterior fantasma
    abortStream();

    setIsRunning(true);
    setIsFrozen(true);
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 150);

    const frameBase64 = captureFrameBase64();
    if (videoRef.current && cameraActive) {
      videoRef.current.pause();
    }

    clearQueue();
    setMasks([]);
    setReasoningTrace('');
    setLatestClaim(null);
    setLatestCatalog(null);
    setVmExecution(null);
    setTelemetry({ glimmerMs: 0, samMs: 0, sparkMs: 0, segmenter: 'Sharp crop', tokensSavedPct: 0, piiRedacted: 0 });
    setSteps(
      INITIAL_STEPS.map((s, idx) => ({
        ...s,
        status: idx === 0 ? 'RUNNING' : 'PENDING',
        detail: idx === 0 ? 'Scanning the frame and planning the DAG...' : undefined,
      }))
    );
    await fetchLiveLedger(); // Refresca inventario limpio justo antes de correr

    await runStream(
      frameBase64,
      voiceText,
      (eventObj) => {
        const { event, data } = eventObj;

        if (event === 'VISION_SCAN_STARTED') {
          enqueue(() => {
            updateStep('edge_pii', { status: 'RUNNING', detail: 'Muse Spark Open is reading the frame' });
          });
        }

        if (event === 'EDGE_PII_SHIELD') {
          const redactedLen = Array.isArray(data.redactedMasks) ? data.redactedMasks.length : 0;
          enqueue(() => {
            setTelemetry((t) => ({ ...t, glimmerMs: data.latencyMs || t.glimmerMs, piiRedacted: redactedLen }));
            updateStep('edge_pii', { status: 'MUTATED', latencyMs: data.latencyMs, detail: `PII shields: ${redactedLen}` });
          });
        }

        if (event === 'SPATIAL_LOCK') {
          const incomingObjects = Array.isArray(data.objects) ? data.objects : [];
          enqueue(() => {
            setMasks(incomingObjects);
            setTelemetry((t) => ({
              ...t,
              samMs: data.samUsed ? data.samLatencyMs! : data.latencyMs || t.samMs,
              sparkMs: data.sparkLatencyMs || t.sparkMs,
              segmenter: data.samUsed ? 'SAM 3.1' : 'Sharp crop',
            }));
            updateStep('sam_lock', {
              status: 'MUTATED',
              model: data.samUsed ? 'SAM 3.1' : 'Muse Spark Vision + Sharp',
              latencyMs: data.samUsed ? data.samLatencyMs : data.latencyMs,
              detail: data.samUsed
                ? `SAM 3.1 tightened ${data.samRefined} boxes`
                : `${incomingObjects.length} actionable objects cropped`,
            });
            updateStep('spark_plan', { status: 'RUNNING' });
          });
        }

        if (event === 'SPARK_REASONING_TRACE') {
          setReasoningTrace(data.reasoning || '');
        }

        if (event === 'SPARK_PLAN_LOCKED') {
          enqueue(() => {
            setTelemetry((t) => ({ ...t, sparkMs: data.latencyMs || 440 }));
            updateStep('spark_plan', { status: 'MUTATED', latencyMs: data.latencyMs || 440, detail: data.plan?.summary || 'Spatial DAG plan locked' });

            ['quarantine_and_claim', 'mutate_inventory', 'generate_studio_catalog', 'recalculate_margins_vm'].forEach(
              (id) => updateStep(id, { status: 'RUNNING', detail: 'Executing operation...' })
            );
          });
        }

        if (event === 'TOOL_MUTATED') {
          const { tool, targetMaskId, result } = data;
          const resolvedMaskId = targetMaskId || (result as any)?.maskId;

          enqueue(() => {
            if (resolvedMaskId) {
              setMasks((prev) => prev.map((m) =>
                m.id === resolvedMaskId ? { ...m, assignedActionStatus: getMaskStatusForTool(tool) } : m
              ));
              setActivePulse({ id: resolvedMaskId, actionText: getPulseActionText(tool) });
              setTimeout(() => setActivePulse(null), 350);
            }

            if (tool === 'quarantine_and_claim' && result) {
              const claimResult = result as SupplierClaim;
              setLatestClaim(claimResult);
              const held = claimResult.guardrailStatus === 'HELD_WAITING_VOICE_AUTH';
              updateStep(tool, {
                status: 'MUTATED',
                detail: held ? `Claim #${claimResult.id} (-$${Number(claimResult.amountUsd).toFixed(2)}) exceeds auto-limit` : `Claim #${claimResult.id} auto-approved`,
              });
            }

            if (tool === 'mutate_inventory' && result) {
              const invResult = result as any;
              setInventory((prev) => {
                const exists = prev.some((item) => item.sku === invResult.sku);
                if (exists) {
                  return prev.map((item) =>
                    item.sku === invResult.sku
                      ? { ...item, stock: invResult.stock, sellPriceUsd: invResult.sellPriceUsd ?? item.sellPriceUsd, _highlightDelta: `+${invResult.delta ?? 1}` }
                      : item
                  );
                }
                return [{ sku: invResult.sku, name: invResult.name || 'Component', stock: invResult.stock ?? 1, sellPriceUsd: invResult.sellPriceUsd ?? 149.0, _highlightDelta: `+${invResult.delta ?? 1}` }, ...prev];
              });
              const mutationLine = `${invResult.sku}: ${invResult.previousStock ?? '?'}→${invResult.stock} (+${invResult.delta ?? 1})`;
              updateStep(tool, { status: 'MUTATED', detail: mutationLine });
              
              setTimeout(() => {
                setInventory((current) => current.map(item => item.sku === invResult.sku ? { ...item, _highlightDelta: undefined } : item));
              }, 2000);
            }

            if (tool === 'generate_studio_catalog' && result) {
              const catResult = result as StudioCatalogResult;
              setLatestCatalog(catResult);
              updateStep(tool, { status: 'MUTATED', latencyMs: catResult.synthesisLatencyMs, detail: `Published "${catResult.title}"` });
            }

            if (tool === 'recalculate_margins_vm' && result) {
              const vmResult = result as VmExecutionResult;
              setVmExecution(vmResult);
              const targetSku = vmResult.updatedSku || 'SKU-DDR5-32GB-KIT';
              setInventory((prev) => prev.map((item) =>
                  item.sku === targetSku ? { ...item, sellPriceUsd: vmResult.finalPrice, _repriced: true } : item
              ));
              updateStep(tool, { status: 'MUTATED', detail: `${targetSku} repriced to $${vmResult.finalPrice} USD` });

              setTimeout(() => {
                setInventory((current) => current.map(item => item.sku === targetSku ? { ...item, _repriced: undefined } : item));
              }, 2000);
            }
          });
        }

        if (event === 'ORCHESTRATION_COMPLETE') {
          enqueue(() => {
            setIsRunning(false);
            setSteps((prev) => prev.map(s => s.status === 'RUNNING' ? { ...s, status: 'PENDING', detail: 'Tool skipped (not requested by prompt)' } : s));
            speakTactical("Spatial lock complete. Actionable assets indexed. Check reasoning trace for zero-trust interventions.");

            if (data.storeState && Array.isArray(data.storeState.inventory)) {
              setInventory(data.storeState.inventory);
            }
          });
        }
      },
      (err) => {
        console.error('SSE Stream Error:', err);
        enqueue(() => {
          setIsRunning(false);
          setIsFrozen(false);
        });
      }
    );
  }, [isRunning, cameraActive, uploadedImage, voiceText, captureFrameBase64, clearQueue, enqueue, speakTactical, runStream, updateStep, fetchLiveLedger]);

  const abortRun = useCallback(() => {
    abortStream();
    clearQueue();
    setIsRunning(false);
    setIsFrozen(false);
    setActivePulse(null);
    setSteps((prev) => prev.map((s) => (s.status === 'RUNNING' || s.status === 'PENDING' ? { ...s, status: 'FAILED', detail: 'Aborted by operator' } : s)));
  }, [abortStream, clearQueue]);

  const authorizeGuardrailClaim = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:4000/api/confirm-guardrail', { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.claim) {
        setLatestClaim(data.claim);
        updateStep('quarantine_and_claim', { detail: `Claim #${data.claim.id} AUTHORIZED (${data.claim.dispatchChannel})` });
        speakTactical("Supplier claim authorized and dispatched to Telegram.");
      }
    } catch (err) {
      console.error('Guardrail confirm failed', err);
    }
  }, [speakTactical, updateStep]);

  const resetDemoState = useCallback(async () => {
    try {
      await fetch('http://localhost:4000/api/reset-demo', { method: 'POST' });
    } catch {}
    setMasks([]);
    setReasoningTrace('');
    setLatestClaim(null);
    setLatestCatalog(null);
    setVmExecution(null);
    setIsFrozen(false);
    setIsRunning(false);
    setActivePulse(null);
    clearQueue();
    abortStream();
    setVoiceText(DEFAULT_PROMPT);
    setTelemetry({ glimmerMs: 0, samMs: 0, sparkMs: 0, segmenter: 'Sharp crop', tokensSavedPct: 0, piiRedacted: 0 });
    setSteps(INITIAL_STEPS);
    await fetchLiveLedger();
    if (videoRef.current && cameraActive) videoRef.current.play();
  }, [cameraActive, clearQueue, abortStream, fetchLiveLedger]);

  const toggleMicListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert('Chrome or Edge required for WebSpeech API.');

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-AR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => setIsListeningMic(true);
    recognition.onresult = (event: any) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript + ' ';
      setVoiceText(text.trim());
    };
    recognition.onend = () => {
      setIsListeningMic(false);
      setShouldAutoTrigger(true);
    };
    recognition.start();
  };

  useEffect(() => {
    if (shouldAutoTrigger) {
      setShouldAutoTrigger(false);
      if (voiceText.trim().split(/\s+/).length >= 3 && !isRunning) {
        triggerOrchestration();
      }
    }
  }, [shouldAutoTrigger, voiceText, isRunning, triggerOrchestration]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (voiceText.trim().length > 0) {
          triggerOrchestration();
        }
      }
      if (e.code === 'KeyC') { e.preventDefault(); authorizeGuardrailClaim(); }
      if (e.code === 'KeyR') { e.preventDefault(); resetDemoState(); }
      if (e.code === 'Escape') { e.preventDefault(); abortRun(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerOrchestration, authorizeGuardrailClaim, resetDemoState, isRunning, abortRun, voiceText]);

  const renderMask = (m: SpatialMask) => {
    const [x, y, w, h] = m.bbox;
    const isApproximate = m.confidence === undefined || m.confidence < 0.1;
    const isActive = activePulse?.id === m.id;
    
    let borderStyle = isApproximate ? 'border-dashed border-amber-500/80' : resolveMaskStyle(m.assignedActionStatus);
    let extraClasses = 'transition-all duration-300';
    let opacity = isApproximate ? 0.7 : (m.confidence ? Math.max(0.4, m.confidence) : 1);
    
    if (isActive) {
      borderStyle = 'border-white';
      extraClasses = 'ring-4 ring-white/80 scale-[1.03] bg-white/15 z-50 transition-all duration-150 shadow-[0_0_30px_rgba(255,255,255,0.6)]';
      opacity = 1;
    } else if (!isApproximate && m.confidence > 0.85) {
      extraClasses += ' shadow-[0_0_8px_currentColor]';
    }

    return (
      <div
        key={m.id}
        onClick={() => setSelectedMaskId(m.id === selectedMaskId ? null : m.id)}
        className={`absolute border-2 ${m.id === selectedMaskId ? 'border-amber-400 bg-amber-400/20 z-40' : borderStyle} rounded-[2px] pointer-events-auto cursor-pointer ${extraClasses}`}
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, opacity }}
      >
        <div className="absolute top-0 left-0 w-2 h-2 border-t-[3px] border-l-[3px] -translate-x-[2px] -translate-y-[2px] border-current opacity-70" />
        <div className="absolute top-0 right-0 w-2 h-2 border-t-[3px] border-r-[3px] translate-x-[2px] -translate-y-[2px] border-current opacity-70" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b-[3px] border-l-[3px] -translate-x-[2px] translate-y-[2px] border-current opacity-70" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b-[3px] border-r-[3px] translate-x-[2px] translate-y-[2px] border-current opacity-70" />

        <div className="absolute -top-6 left-0 text-[10px] bg-slate-950/90 border border-slate-700/50 px-1.5 py-0.5 rounded text-slate-100 whitespace-nowrap font-medium tracking-wide shadow-lg">
          {m.label || m.id} {isApproximate ? <span className="text-amber-400 font-bold ml-1">[ APPROX ]</span> : (m.confidence ? <span className="text-cyan-400 font-bold ml-1">[ {(m.confidence * 100).toFixed(1)}% ]</span> : '')}
        </div>

        {isActive && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white text-black font-extrabold text-[11px] tracking-widest px-3 py-1 rounded shadow-[0_0_20px_white] animate-pulse">
            {activePulse.actionText}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen w-screen bg-[#06080A] text-slate-200 flex flex-col select-none overflow-hidden font-sans">
      <style>{`@keyframes kinetix-scan { 0% { top: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } }`}</style>
      
      <div className={`fixed inset-0 z-[100] pointer-events-none bg-cyan-200/20 backdrop-brightness-150 transition-opacity duration-200 ${flashEffect ? 'opacity-100' : 'opacity-0'}`} />

      <canvas ref={canvasRef} className="hidden" />

      <header className="h-14 border-b border-slate-800 bg-[#0A0C10] px-6 flex items-center justify-between shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee] animate-pulse" />
          <span className="font-bold tracking-widest text-[13px] text-white">KINETIX OS</span>
          <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-cyan-950/40 text-cyan-400 border border-cyan-800/60 font-semibold tracking-wider">
            SPATIAL ERP v2026.1 // KINETIX LABS
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-500/40 font-bold tracking-wider">
            LIVE · BASETEN
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <button onClick={() => setTtsEnabled(!ttsEnabled)} className={`px-2 py-1 rounded border text-[10px] font-bold cursor-pointer uppercase transition-colors ${ttsEnabled ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300' : 'border-slate-700 bg-slate-900 text-slate-500'}`}>
            TTS: {ttsEnabled ? 'ON' : 'OFF'}
          </button>

          <TelemetryHud telemetry={telemetry} />

          <button onClick={() => fileInputRef.current?.click()} className={`px-2.5 py-1.5 rounded border text-[10px] font-bold cursor-pointer flex items-center gap-1.5 uppercase tracking-wide transition-colors ${uploadedImage ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
            <Upload className="w-3.5 h-3.5" /> Upload Image
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { handleImageUpload(e.target.files?.[0]); e.target.value = ''; }} />
          
          <button onClick={startCamera} className={`px-2.5 py-1.5 rounded border text-[10px] font-bold cursor-pointer uppercase tracking-wide transition-colors ${cameraActive ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
            Live Cam
          </button>
          
          <button onClick={resetDemoState} title="Shortcut: [R] key" className="px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1.5 cursor-pointer transition uppercase text-[10px] font-bold">
            <RotateCcw className="w-3.5 h-3.5 text-cyan-500" />
            <span>[R] RESET</span>
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-3 p-3 overflow-hidden min-h-0">
        
        {/* LEFT COLUMN: SPATIAL FEED */}
        <section className="col-span-5 flex flex-col gap-3 border border-slate-800 bg-[#0A0C10] rounded-xl p-3 relative shadow-lg">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest border-b border-slate-800/80 pb-2">
            <span className="flex items-center gap-2 font-bold text-slate-300">
              <Camera className="w-4 h-4 text-cyan-500" /> WORKSPACE SPATIAL FEED
            </span>
            <span className={`px-2 py-0.5 rounded font-bold border ${isRunning ? 'bg-amber-950/80 text-amber-300 border-amber-500/50 animate-pulse' : isFrozen ? 'bg-rose-950/80 text-rose-300 border-rose-500/50' : 'bg-emerald-950/80 text-emerald-400 border-emerald-500/50'}`}>
              {isRunning ? 'SCANNING SCENE' : isFrozen ? 'FRAME LOCKED' : 'LIVE FEED'}
            </span>
          </div>

          <div ref={stageRef} className="relative flex-1 min-h-0 bg-[#050608] rounded-md border border-slate-800 overflow-hidden flex items-center justify-center shadow-inner">
            {cameraActive && (
              <div className="relative" style={stageBox ? { width: stageBox.w, height: stageBox.h } : { width: '100%', height: '100%' }}>
                <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={(e) => {
                  const target = e.currentTarget as HTMLVideoElement;
                  if (sourceDims?.w !== target.videoWidth || sourceDims?.h !== target.videoHeight) {
                    console.warn('Video loaded, but dimensions ignored since we set them inside hook', target.videoWidth);
                  }
                }} className="w-full h-full object-cover" />
                {masks.map(renderMask)}
              </div>
            )}
            {!cameraActive && uploadedImage && (
              <div className="relative" style={stageBox ? { width: stageBox.w, height: stageBox.h } : { width: '100%', height: '100%' }}>
                <img src={uploadedImage} alt="Workspace" className="w-full h-full object-cover" />
                {masks.map(renderMask)}
              </div>
            )}
            {!cameraActive && !uploadedImage && (
              <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-3 text-slate-600 hover:text-cyan-400 cursor-pointer transition-colors">
                <Upload className="w-10 h-10" />
                <span className="text-[11px] font-medium tracking-wide uppercase">Upload image or start Live Cam</span>
              </button>
            )}

            {isRunning && masks.length === 0 && (cameraActive || uploadedImage) && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden bg-[linear-gradient(to_right,#22d3ee08_1px,transparent_1px),linear-gradient(to_bottom,#22d3ee08_1px,transparent_1px)] bg-[size:32px_32px]">
                <div className="absolute left-0 right-0 h-[3px] bg-cyan-400 shadow-[0_0_24px_#22d3ee]" style={{ animation: 'kinetix-scan 2s ease-in-out infinite' }} />
                <div className="absolute bottom-4 right-4 text-[10px] font-mono tracking-widest text-cyan-300 bg-slate-950/80 border border-cyan-500/40 px-2 py-1 rounded shadow-lg flex items-center gap-2">
                  <Zap className="w-3 h-3 text-cyan-400 animate-pulse" /> SPATIAL MAPPING IN PROGRESS
                </div>
              </div>
            )}

            {/* Human-in-the-Loop Popover (AI Suggestion + Supervisor Triage) */}
            {selectedMaskId && (() => {
              const selectedMask = masks.find((m) => m.id === selectedMaskId);
              const rawLabel = (selectedMask?.label || selectedMaskId).replace(/\s*\[PENDING.*?\]/i, '').trim();
              const suggestedSku = `SKU-${rawLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18) || 'ASSET'}`;
              const hasPendingTriage = inventory.some((item) => item.sku.startsWith('SKU-TRIAGE-'));

              const commitStockWithSku = (finalSku: string) => {
                const cleanSku = finalSku.trim().toUpperCase() || suggestedSku;
                setInventory((prev) => {
                  if (prev.some((item) => item.sku.startsWith('SKU-TRIAGE-'))) {
                    return prev.map((item) =>
                      item.sku.startsWith('SKU-TRIAGE-')
                        ? { ...item, sku: cleanSku, name: `${rawLabel} (Verified)`, _highlightDelta: 'CLEARED' }
                        : item
                    );
                  }
                  const exists = prev.some((item) => item.sku === cleanSku);
                  if (exists) {
                    return prev.map((item) =>
                      item.sku === cleanSku ? { ...item, stock: item.stock + 1, _highlightDelta: '+1' } : item
                    );
                  }
                  return [{ sku: cleanSku, name: rawLabel, stock: 1, sellPriceUsd: 115.0, _highlightDelta: '+1' }, ...prev];
                });
                updateStep('mutate_inventory', { status: 'MUTATED', detail: `Supervisor confirmed ${cleanSku} (+1)` });
                setActivePulse({ id: selectedMaskId, actionText: hasPendingTriage ? 'CLEARED' : '+1 STOCK' });
                setMasks((prev) =>
                  prev.map((m) => (m.id === selectedMaskId ? { ...m, assignedActionStatus: 'STOCK_MUTATED', label: cleanSku } : m))
                );
                setTimeout(() => setActivePulse(null), 350);
                setTimeout(() => {
                  setInventory((curr) => curr.map((item) => (item.sku === cleanSku ? { ...item, _highlightDelta: undefined } : item)));
                }, 2000);
                setSelectedMaskId(null);
              };

              return (
                <div className="absolute bottom-4 right-4 bg-slate-950/95 border border-amber-500/60 rounded-lg p-3 w-72 shadow-[0_0_25px_rgba(0,0,0,0.85)] backdrop-blur-sm z-50 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex justify-between items-start mb-2 border-b border-slate-800 pb-2">
                    <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1.5 uppercase tracking-wider">
                      <Scan className="w-3 h-3" /> SUPERVISOR TRIAGE & OVERRIDE
                    </span>
                    <button onClick={() => setSelectedMaskId(null)} className="text-slate-500 hover:text-white cursor-pointer">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-200 mb-2">
                    <span className="truncate">{rawLabel}</span>
                    <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/50">
                      AI: {((selectedMask?.confidence ?? 0.95) * 100).toFixed(0)}%
                    </span>
                  </div>

                  <div className="mb-2.5">
                    <label className="block text-[8px] uppercase tracking-wider text-slate-400 font-bold mb-1">
                      AI Suggested SKU (Press Enter to Confirm)
                    </label>
                    <input
                      key={selectedMaskId}
                      id="supervisor-sku-input"
                      type="text"
                      defaultValue={suggestedSku}
                      className="w-full bg-slate-900 border border-amber-500/50 rounded px-2 py-1 text-[10px] font-mono text-amber-200 focus:outline-none focus:border-cyan-400"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitStockWithSku(e.currentTarget.value);
                      }}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => {
                        const inputEl = document.getElementById('supervisor-sku-input') as HTMLInputElement | null;
                        commitStockWithSku(inputEl?.value || suggestedSku);
                      }}
                      className="w-full py-1.5 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700 rounded text-[10px] font-bold text-emerald-300 uppercase tracking-widest transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Package className="w-3 h-3" /> {hasPendingTriage ? 'CONFIRM & CLEAR TRIAGE' : 'CONFIRM & ADD +1 STOCK'}
                    </button>

                    <button
                      onClick={() => {
                        const inputEl = document.getElementById('supervisor-sku-input') as HTMLInputElement | null;
                        const confirmedSku = (inputEl?.value || suggestedSku).trim().toUpperCase();
                        updateStep('quarantine_and_claim', { status: 'MUTATED', detail: `Supervisor claim opened for ${confirmedSku}` });
                        setLatestClaim({
                          id: `CLM-${Math.floor(100 + Math.random() * 900)}`,
                          amountUsd: 85,
                          reason: `Defecto verificado en triaje sobre ${rawLabel} (${confirmedSku})`,
                          guardrailStatus: 'HELD_WAITING_VOICE_AUTH',
                          thresholdUsd: 50,
                          cropBase64: selectedMask?.cropBase64,
                        });
                        setActivePulse({ id: selectedMaskId, actionText: 'QUARANTINED' });
                        setMasks((prev) => prev.map((m) => (m.id === selectedMaskId ? { ...m, assignedActionStatus: 'QUARANTINED', label: confirmedSku } : m)));
                        setTimeout(() => setActivePulse(null), 350);
                        setSelectedMaskId(null);
                      }}
                      className="w-full py-1.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 rounded text-[10px] font-bold text-rose-300 uppercase tracking-widest transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <AlertTriangle className="w-3 h-3" /> QUARANTINE & OPEN CLAIM
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="flex gap-2">
            <button onClick={toggleMicListening} className={`px-4 py-2 rounded-md border text-[11px] font-bold flex items-center gap-2 tracking-wide transition-all ${isListeningMic ? 'border-rose-500 bg-rose-950/50 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)]' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'}`}>
              <Mic className={`w-4 h-4 ${isListeningMic ? 'animate-pulse' : ''}`} /> MIC
            </button>
            
            {!isRunning ? (
              <button onClick={triggerOrchestration} className="flex-1 py-2 rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                <Play className="w-4 h-4 fill-slate-950" /> TRIGGER GOLDEN PATH (SPACEBAR)
              </button>
            ) : (
              <button onClick={abortRun} className="flex-1 py-2 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(225,29,72,0.4)]">
                <XCircle className="w-4 h-4" /> [ESC] ABORT ORCHESTRATION
              </button>
            )}
          </div>

          <textarea
            value={voiceText}
            onChange={(e) => setVoiceText(e.target.value)}
            className="w-full bg-[#050608] border border-slate-800 rounded-md p-3 text-[11px] font-mono text-slate-300 resize-none h-20 shadow-inner focus:outline-none focus:border-cyan-800 transition-colors"
          />
        </section>

        {/* MIDDLE COLUMN: DAG & TERMINAL */}
        <section className="col-span-4 flex flex-col gap-3 overflow-y-auto min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <AgentDagPanel steps={steps} piiRedacted={telemetry.piiRedacted} />
          <ReasoningTerminal trace={reasoningTrace} isRunning={isRunning} />
        </section>

        {/* RIGHT COLUMN: ERP MICRO-INTERACTIONS */}
        <section className="col-span-3 flex flex-col gap-3 overflow-y-auto min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          
          {/* INVENTORY CARD */}
          <div className="border border-slate-800 bg-[#0A0C10] rounded-lg p-3 shadow-inner flex flex-col max-h-[35vh]">
            <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 border-b border-slate-800/80 pb-2 mb-2 flex items-center gap-2 shrink-0">
              <Package className="w-3.5 h-3.5 text-emerald-500" />
              <span>LIVE INVENTORY STATE (UPSERT)</span>
              <span className="ml-auto text-[8px] bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-slate-400 font-mono">{inventory.length} SKUs</span>
            </div>
            <div className="space-y-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-h-0 pb-1 pr-1">
              {inventory.map((item) => {
                const isTriage = item.sku.startsWith('SKU-TRIAGE-');
                return (
                  <div key={item.sku} className={`flex justify-between items-center text-[11px] border-b border-slate-800/50 pb-1.5 transition-all duration-500 ${isTriage ? 'bg-amber-950/20' : (item._highlightDelta || item._repriced ? 'bg-emerald-950/20 rounded px-1' : '')}`}>
                    <div>
                      <div className={`font-semibold ${isTriage ? 'text-amber-200' : 'text-slate-200'}`}>{item.name}</div>
                      <div className={`text-[9px] font-mono tracking-wider flex items-center gap-1 ${isTriage ? 'text-amber-500/80 font-bold' : 'text-slate-500'}`}>
                        {item.sku}
                        {isTriage && <span className="bg-amber-500/20 text-amber-300 px-1 rounded-[2px] text-[7px] border border-amber-500/30">TRIAGE HOLD</span>}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <div className="flex items-center gap-1.5">
                        {item._highlightDelta && <span className={`${isTriage ? 'bg-amber-500' : 'bg-emerald-500'} text-slate-950 font-bold px-1 rounded-[2px] text-[9px] animate-pulse`}>{item._highlightDelta}</span>}
                        <span className={`${isTriage ? 'text-amber-400' : 'text-emerald-400'} font-bold`}>{item.stock} units</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {item._repriced && <span className="bg-cyan-500 text-slate-950 font-bold px-1 rounded-[2px] text-[8px]">REPRICED</span>}
                        <span className={`${isTriage ? 'text-amber-500/60' : 'text-slate-400'} text-[10px] font-mono`}>${item.sellPriceUsd?.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* GUARDRAIL CLAIM CARD */}
          <div className="border border-slate-800 bg-[#0A0C10] rounded-lg p-3 shadow-inner">
            <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 border-b border-slate-800/80 pb-2 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" /> SUPPLIER CLAIM & GUARDRAIL
            </div>
            {latestClaim ? (
              <div className="border border-rose-500/40 bg-rose-950/10 rounded p-2.5 text-xs space-y-2.5 transition-all duration-300">
                <div className="flex gap-3 items-center">
                  {latestClaim.cropBase64 && latestClaim.cropBase64.startsWith('data:image') && (
                    <div className="relative w-12 h-12 rounded border border-rose-500/60 overflow-hidden shrink-0">
                       <img src={latestClaim.cropBase64} alt="Defect" className="w-full h-full object-cover" />
                       <div className="absolute inset-0 bg-rose-500/10 mix-blend-overlay pointer-events-none" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex justify-between font-bold text-rose-300 tracking-wide text-[11px]">
                      <span>TICKET #{latestClaim.id}</span>
                      <span>-${Number(latestClaim.amountUsd).toFixed(2)} USD</span>
                    </div>
                    <div className="text-[10px] text-slate-300 mt-1 leading-snug">{latestClaim.reason}</div>
                  </div>
                </div>

                {latestClaim.guardrailStatus === 'HELD_WAITING_VOICE_AUTH' ? (
                  <div className="pt-2 border-t border-rose-500/30 flex flex-col gap-2">
                    <div className="text-[9px] text-amber-400 font-bold uppercase tracking-wide">
                      ⚠ ZERO-TRUST GUARDRAIL: Claim (-${Number(latestClaim.amountUsd).toFixed(2)} USD) exceeds $50 auto-limit — Held
                    </div>
                    <button onClick={authorizeGuardrailClaim} className="w-full py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-amber-950 font-extrabold text-[10px] uppercase tracking-widest transition-colors shadow-[0_0_10px_rgba(245,158,11,0.3)]">
                      [PRESS C] AUTHORIZE & DISPATCH CLAIM
                    </button>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-emerald-500/30 flex flex-col gap-1.5">
                    <div className="text-[9px] text-emerald-400 font-bold flex items-center justify-center gap-1.5 py-1 bg-emerald-950/50 border border-emerald-800/50 rounded uppercase tracking-wide">
                      <CheckCircle2 className="w-3 h-3" /> AUTHORIZED BY OPERATOR // SENT VIA {latestClaim.dispatchChannel}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-slate-600 text-center py-4 italic">No claims processed in current session</div>
            )}
          </div>

          {/* STUDIO SYNTHESIS CARD */}
          <div className="border border-slate-800 bg-[#0A0C10] rounded-lg p-3 shadow-inner shrink-0 flex flex-col min-h-0">
            <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 border-b border-slate-800/80 pb-2 mb-2 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> CROP-TO-STUDIO SYNTHESIS (MUSE IMAGE)
            </div>
            {latestCatalog ? (
              <div className="flex flex-col gap-2 overflow-y-auto [scrollbar-width:none]">
                <div className="text-[11px] font-bold text-cyan-100">{latestCatalog.title}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="text-[8px] uppercase tracking-wider text-slate-500 font-bold">BEFORE // RAW CAMERA CROP</div>
                    <div className="relative rounded border border-slate-700 overflow-hidden aspect-video bg-[#050608]">
                       <img src={latestCatalog.sourceCropUrl} alt="Raw" className="w-full h-full object-cover opacity-70 grayscale-[30%]" />
                       <div className="absolute top-1 left-1 bg-black/80 backdrop-blur px-1 py-0.5 rounded-[2px] text-[8px] font-mono text-slate-300">RAW_CROP</div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[8px] uppercase tracking-wider text-slate-500 font-bold">AFTER // MUSE IMAGE 8K</div>
                    <div className="relative rounded border border-cyan-800/60 overflow-hidden aspect-video bg-[#050608] shadow-[0_0_12px_rgba(34,211,238,0.15)]">
                       <img src={latestCatalog.studioImageUrl} alt="Studio" className="w-full h-full object-cover" />
                       <div className="absolute top-1 right-1 bg-cyan-950/80 backdrop-blur border border-cyan-500/50 px-1 py-0.5 rounded-[2px] text-[8px] font-mono text-cyan-300">SYNTH_8K</div>
                    </div>
                  </div>
                </div>
                {latestCatalog.visualDna && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <div className="bg-slate-900 border border-slate-700/60 rounded px-1.5 py-1 flex items-center gap-1.5 truncate">
                      <span className="text-[8px] font-bold text-cyan-500 tracking-wider">GEOMETRY:</span>
                      <span className="text-[9px] text-slate-300 truncate font-medium">{latestCatalog.visualDna.containerGeometry}</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-700/60 rounded px-1.5 py-1 flex items-center gap-1.5 truncate">
                      <span className="text-[8px] font-bold text-cyan-500 tracking-wider">PALETTE:</span>
                      <span className="text-[9px] text-slate-300 truncate font-medium">{latestCatalog.visualDna.exactColorPalette}</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-700/60 rounded px-1.5 py-1 flex items-center gap-1.5 truncate">
                      <span className="text-[8px] font-bold text-cyan-500 tracking-wider">OCR BRAND:</span>
                      <span className="text-[9px] text-slate-300 truncate font-medium">{latestCatalog.visualDna.detectedBrandOrText}</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-700/60 rounded px-1.5 py-1 flex items-center gap-1.5 truncate">
                      <span className="text-[8px] font-bold text-cyan-500 tracking-wider">MATERIAL:</span>
                      <span className="text-[9px] text-slate-300 truncate font-medium">{latestCatalog.visualDna.surfaceMaterial}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
               <div className="text-[10px] text-slate-600 text-center py-4 italic flex-1 flex items-center justify-center">Awaiting product spatial targeting...</div>
            )}
          </div>

          {/* MUSE CODE FINANCIAL SANDBOX CARD */}
          <div className="border border-slate-800 bg-[#0A0C10] rounded-lg p-3 shadow-inner shrink-0 flex flex-col min-h-0">
            <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 border-b border-slate-800/80 pb-2 mb-2 flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-amber-400" /> MUSE CODE FINANCIAL SANDBOX (node:vm)
            </div>
            {vmExecution ? (
              <div className="space-y-1.5">
                <pre className="text-[9px] font-mono text-cyan-300 bg-[#050608] p-2 rounded border border-slate-800/80 overflow-x-auto leading-relaxed">
                  {vmExecution.executedCode}
                </pre>
                <div className="text-[10px] font-mono text-emerald-400">
                  {`// Output Price: $${Number(vmExecution.finalPrice).toFixed(2)} USD (fallback: ${Boolean(vmExecution.usedFallback)})`}
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-slate-600 text-center py-3 italic">Awaiting margin sandbox execution...</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}