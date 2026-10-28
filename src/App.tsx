import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Cpu,
  Scan,
  CheckCircle2,
  AlertTriangle,
  Package,
  Sparkles,
  Terminal,
  Play,
  Camera,
  Loader2,
  Activity,
  Lock,
  Mic,
  RotateCcw,
  ShieldCheck,
  BrainCircuit,
} from 'lucide-react';

interface SpatialMask {
  id: string;
  label?: string;
  bbox: [number, number, number, number];
  zone?: string;
  spatialRegion2D?: string;
  assignedActionStatus?:
  | 'IDLE_OBSERVED'
  | 'IDLE'
  | 'QUARANTINED'
  | 'STOCK_MUTATED'
  | 'CATALOG_SYNTH'
  | 'PII_REDACTED';
  isSensitivePII: boolean;
  confidence: number;
}

interface ExecutionStep {
  id: string;
  title: string;
  model: string;
  status: 'PENDING' | 'RUNNING' | 'MUTATED';
  detail?: string;
  latencyMs?: number;
}

const DEFAULT_PROMPT =
  'El cooler de torre con tubos de cobre vino con una aleta golpeada, abrí reclamo al proveedor. Sumá al stock los dos módulos de memoria RAM y el disco SSD M.2. Armame la foto de estudio para la fuente de poder modular y recalculá precios con 32% de margen.';

const INITIAL_STEPS: ExecutionStep[] = [
  { id: 'edge_pii', title: 'Edge Cognitive Filter & PII Redaction', model: 'muse-spark-open-1026', status: 'PENDING' },
  { id: 'sam_lock', title: 'Spatial Instance Segmentation (N-Graph)', model: 'SAM 3.1 Vision', status: 'PENDING' },
  { id: 'spark_plan', title: 'Multi-Tool DAG Reasoning', model: 'muse-spark-open-1026 (Baseten)', status: 'PENDING' },
  { id: 'quarantine_and_claim', title: 'Tool: Quarantine & Supplier Claim', model: 'Action Engine', status: 'PENDING' },
  { id: 'mutate_inventory', title: 'Tool: Inventory SKU Auto-Upsert', model: 'Action Engine', status: 'PENDING' },
  { id: 'generate_studio_catalog', title: 'Tool: E-Commerce Studio Synthesis', model: 'Muse Image', status: 'PENDING' },
  { id: 'recalculate_margins_vm', title: 'Tool: Financial Margin Sandbox', model: 'Muse Code (node:vm)', status: 'PENDING' },
];

const INITIAL_HARDWARE_INVENTORY = [
  { sku: 'SKU-DDR5-32GB-KIT', name: 'Fury Beast DDR5 32GB (2x16GB) Black', stock: 14, sellPriceUsd: 158.0 },
  { sku: 'SKU-NVME-2TB-GEN4', name: 'M.2 NVMe PCIe 4.0 SSD 2TB', stock: 8, sellPriceUsd: 185.0 },
  { sku: 'SKU-RTX-TRIPLE-OC', name: 'GeForce RTX Triple-Fan OC Edition', stock: 5, sellPriceUsd: 840.0 },
];

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneImgRef = useRef<HTMLImageElement | null>(null);
  const [useHardwareBench, setUseHardwareBench] = useState(true);

  const [cameraActive, setCameraActive] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [flashEffect, setFlashEffect] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);

  const [masks, setMasks] = useState<SpatialMask[]>([]);
  const [telemetry, setTelemetry] = useState({
    glimmerMs: 0,
    samMs: 0,
    sparkMs: 0,
    tokensSavedPct: 68,
    piiRedacted: 0,
  });

  const [steps, setSteps] = useState<ExecutionStep[]>(INITIAL_STEPS);
  const [inventory, setInventory] = useState(INITIAL_HARDWARE_INVENTORY);
  const [latestClaim, setLatestClaim] = useState<any>(null);
  const [latestCatalog, setLatestCatalog] = useState<any>(null);
  const [vmExecution, setVmExecution] = useState<any>(null);
  const [voiceText, setVoiceText] = useState(DEFAULT_PROMPT);
  const [reasoningTrace, setReasoningTrace] = useState('');

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'environment' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
        setUseHardwareBench(false);
      }
    } catch (err) {
      console.warn('Camera fallback active', err);
    }
  };

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/hardware-bench.jpg';
    img.onload = () => {
      sceneImgRef.current = img;
    };
  }, []);

  const updateStep = (id: string, patch: Partial<ExecutionStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  // Captura optimizada a 960x540 (~75KB) para no superar nunca el bodyLimit de Fastify
  const captureFrameBase64 = (): string | null => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const targetW = 960;
      const targetH = 540;
      canvas.width = targetW;
      canvas.height = targetH;

      if (cameraActive && !useHardwareBench && videoRef.current) {
        ctx.drawImage(videoRef.current, 0, 0, targetW, targetH);
        return canvas.toDataURL('image/jpeg', 0.78);
      }

      if (sceneImgRef.current && sceneImgRef.current.complete) {
        ctx.drawImage(sceneImgRef.current, 0, 0, targetW, targetH);
        return canvas.toDataURL('image/jpeg', 0.78);
      }
    } catch (err) {
      console.warn('Frame capture skipped:', err);
    }
    return null;
  };

  const triggerOrchestration = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setIsFrozen(true);
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 180);

    const frameBase64 = captureFrameBase64();
    if (videoRef.current && cameraActive && !useHardwareBench) {
      videoRef.current.pause();
    }

    setMasks([]);
    setReasoningTrace('');
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'PENDING', detail: undefined })));
    updateStep('edge_pii', { status: 'RUNNING' });

    try {
      const response = await fetch('http://localhost:4000/api/orchestrate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameBase64, voiceTranscript: voiceText }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} from orchestrator`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const eventMatch = chunk.match(/event:\s*(.+)/);
          const dataMatch = chunk.match(/data:\s*(.+)/);
          if (!eventMatch || !dataMatch) continue;

          const eventName = eventMatch[1].trim();
          let payload: any;
          try {
            payload = JSON.parse(dataMatch[1].trim());
          } catch {
            continue;
          }

          if (eventName === 'EDGE_PII_SHIELD') {
            const redactedLen = Array.isArray(payload.redactedMasks) ? payload.redactedMasks.length : 0;
            setTelemetry((t) => ({
              ...t,
              glimmerMs: payload.latencyMs || 38,
              tokensSavedPct: payload.cloudTokensSavedPct || 68,
              piiRedacted: redactedLen,
            }));
            updateStep('edge_pii', {
              status: 'MUTATED',
              latencyMs: payload.latencyMs || 38,
              detail: `Zero-Trust Edge Filter Active (${redactedLen} PII shields)`,
            });
            updateStep('sam_lock', { status: 'RUNNING' });
          }

          if (eventName === 'SPATIAL_LOCK') {
            const incomingObjects = Array.isArray(payload.objects) ? payload.objects : [];
            setMasks(incomingObjects);
            setTelemetry((t) => ({ ...t, samMs: payload.latencyMs || 285 }));
            updateStep('sam_lock', {
              status: 'MUTATED',
              latencyMs: payload.latencyMs || 285,
              detail: `${incomingObjects.length} spatial nodes indexed in 2D scene graph`,
            });
            updateStep('spark_plan', { status: 'RUNNING' });
          }

          if (eventName === 'SPARK_REASONING_TRACE') {
            setReasoningTrace(payload.reasoning || '');
          }

          if (eventName === 'SPARK_PLAN_LOCKED') {
            setTelemetry((t) => ({ ...t, sparkMs: payload.latencyMs || 440 }));
            updateStep('spark_plan', {
              status: 'MUTATED',
              latencyMs: payload.latencyMs || 440,
              detail: payload.plan?.summary || 'Spatial DAG plan locked',
            });
            ['quarantine_and_claim', 'mutate_inventory', 'generate_studio_catalog', 'recalculate_margins_vm'].forEach(
              (id) => updateStep(id, { status: 'RUNNING' })
            );
          }

          if (eventName === 'TOOL_MUTATED') {
            const { tool, targetMaskId, result } = payload;
            const resolvedMaskId = targetMaskId || result?.maskId;

            if (resolvedMaskId) {
              setMasks((prev) =>
                prev.map((m) =>
                  m.id === resolvedMaskId
                    ? {
                      ...m,
                      assignedActionStatus:
                        tool === 'quarantine_and_claim'
                          ? 'QUARANTINED'
                          : tool === 'mutate_inventory'
                            ? 'STOCK_MUTATED'
                            : 'CATALOG_SYNTH',
                    }
                    : m
                )
              );
            }

            if (tool === 'quarantine_and_claim' && result) {
              setLatestClaim(result);
              updateStep(tool, {
                status: 'MUTATED',
                detail: `Claim #${result.id} held by Zero-Trust ($${result.amountUsd} USD)`,
              });
            }

            if (tool === 'mutate_inventory' && result) {
              // Auto-Upsert en el frontend: actualiza si existe o lo inserta si es nuevo
              setInventory((prev) => {
                const exists = prev.some((item) => item.sku === result.sku);
                if (exists) {
                  return prev.map((item) =>
                    item.sku === result.sku
                      ? { ...item, stock: result.stock, sellPriceUsd: result.sellPriceUsd ?? item.sellPriceUsd }
                      : item
                  );
                }
                return [
                  {
                    sku: result.sku,
                    name: result.name || 'Hardware Component',
                    stock: result.stock || 1,
                    sellPriceUsd: result.sellPriceUsd || 149.0,
                  },
                  ...prev,
                ];
              });
              updateStep(tool, {
                status: 'MUTATED',
                detail: `${result.sku} -> ${result.stock} units in MongoDB`,
              });
            }

            if (tool === 'generate_studio_catalog' && result) {
              setLatestCatalog(result);
              updateStep(tool, {
                status: 'MUTATED',
                detail: `Published "${result.title}"`,
              });
            }

            if (tool === 'recalculate_margins_vm' && result) {
              setVmExecution(result);
              setInventory((prev) =>
                prev.map((item, idx) =>
                  idx === 0 ? { ...item, sellPriceUsd: result.finalPrice || item.sellPriceUsd } : item
                )
              );
              updateStep(tool, {
                status: 'MUTATED',
                detail: `New margin price in VM: $${result.finalPrice} USD`,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('SSE Stream Error:', err);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, cameraActive, useHardwareBench, voiceText]);

  const authorizeGuardrailClaim = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:4000/api/confirm-guardrail', { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.claim) {
        setLatestClaim(data.claim);
        updateStep('quarantine_and_claim', {
          detail: `Claim #${data.claim.id} AUTHORIZED (${data.claim.dispatchChannel})`,
        });
      }
    } catch (err) {
      console.error('Guardrail confirm failed', err);
    }
  }, []);

  const resetDemoState = useCallback(async () => {
    try {
      await fetch('http://localhost:4000/api/reset-demo', { method: 'POST' });
    } catch {
      // Continúa reset local
    }
    setMasks([]);
    setReasoningTrace('');
    setLatestClaim(null);
    setLatestCatalog(null);
    setVmExecution(null);
    setIsFrozen(false);
    setVoiceText(DEFAULT_PROMPT);
    setTelemetry({ glimmerMs: 0, samMs: 0, sparkMs: 0, tokensSavedPct: 68, piiRedacted: 0 });
    setInventory(INITIAL_HARDWARE_INVENTORY);
    setSteps(INITIAL_STEPS);
    if (videoRef.current && cameraActive && !useHardwareBench) {
      videoRef.current.play();
    }
  }, [cameraActive, useHardwareBench]);

  const toggleMicListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Usá Chrome o Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-AR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListeningMic(true);

    recognition.onresult = (event: any) => {
      let text = '';
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript + ' ';
      }
      setVoiceText(text.trim());
    };

    recognition.onend = () => {
      setIsListeningMic(false);
    };

    recognition.start();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' && !isRunning) {
        e.preventDefault();
        triggerOrchestration();
      }
      if (e.code === 'KeyC') {
        e.preventDefault();
        authorizeGuardrailClaim();
      }
      if (e.code === 'KeyR') {
        e.preventDefault();
        resetDemoState();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerOrchestration, authorizeGuardrailClaim, resetDemoState, isRunning]);

  const savedPct = telemetry.tokensSavedPct || 68;

  return (
    <div className="h-screen w-screen bg-[#090A0F] text-slate-200 flex flex-col select-none">
      <canvas ref={canvasRef} className="hidden" />

      <header className="h-14 border-b border-slate-800 bg-[#0D1017] px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#22d3ee] animate-pulse" />
          <span className="font-bold tracking-widest text-sm text-white">KINETIX OS</span>
          <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-semibold">
            SPATIAL ERP v2026.1 // KINETIX LABS
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/50 font-bold tracking-wider">
            LIVE · BASETEN
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400">Edge Shield:</span>
            <span className="text-emerald-400 font-bold">{telemetry.glimmerMs || '--'}ms</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Scan className="w-4 h-4 text-cyan-400" />
            <span className="text-slate-400">SAM 3.1:</span>
            <span className="text-cyan-400 font-bold">{telemetry.samMs || '--'}ms</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-amber-400" />
            <span className="text-slate-400">Spark Open (Baseten):</span>
            <span className="text-amber-400 font-bold">{telemetry.sparkMs || '--'}ms</span>
          </div>

          <div className="px-3 py-1 rounded bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>
              Cloud Offload: <strong className="text-white">{savedPct}%</strong>
            </span>
          </div>

          <button
            onClick={() => setUseHardwareBench(true)}
            className={`px-2.5 py-1 rounded border text-[10px] font-bold cursor-pointer ${useHardwareBench
              ? 'border-cyan-400 bg-cyan-950/60 text-cyan-300'
              : 'border-slate-700 text-slate-400'
              }`}
          >
            Bench Scene
          </button>
          <button
            onClick={startCamera}
            className={`px-2.5 py-1 rounded border text-[10px] font-bold cursor-pointer ${!useHardwareBench && cameraActive
              ? 'border-cyan-400 bg-cyan-950/60 text-cyan-300'
              : 'border-slate-700 text-slate-400'
              }`}
          >
            Live Cam
          </button>
          <button
            onClick={resetDemoState}
            title="Shortcut: [R] key"
            className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1.5 cursor-pointer transition"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            <span>[R] RESET</span>
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        <section className="col-span-5 flex flex-col gap-3 border border-slate-800 bg-[#0D1017] rounded-lg p-3 relative">
          <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
            <span className="flex items-center gap-2 font-semibold text-slate-200">
              <Camera className="w-4 h-4 text-cyan-400" /> WORKSPACE SPATIAL FEED (SAM 3.1 N-GRAPH)
            </span>
            <span
              className={`px-2 py-0.5 rounded font-bold flex items-center gap-1.5 ${isFrozen
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                : 'text-emerald-400'
                }`}
            >
              {isFrozen ? (
                <>
                  <Lock className="w-3 h-3" /> FRAME LOCKED (SEGMENTING)
                </>
              ) : (
                '● READY (10 OBJECTS IN FOV)'
              )}
            </span>
          </div>

          <div
            className={`relative flex-1 bg-[#050608] rounded overflow-hidden flex items-center justify-center transition-all duration-300 ${isFrozen
              ? 'border-2 border-amber-400/80 shadow-[inset_0_0_30px_rgba(245,158,11,0.15)]'
              : 'border border-slate-800'
              }`}
          >
            {useHardwareBench && (
              <img
                src="/hardware-bench.jpg"
                alt="Hardware Bench"
                className={`w-full h-full object-contain transition-all duration-300 ${isFrozen ? 'brightness-90 contrast-110' : 'opacity-95'
                  }`}
              />
            )}

            {cameraActive && !useHardwareBench && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transition-all duration-300 ${isFrozen ? 'brightness-75 contrast-125' : 'opacity-90'
                  }`}
              />
            )}

            {flashEffect && <div className="absolute inset-0 bg-white/60 z-30 pointer-events-none" />}

            {isFrozen && (
              <div className="absolute top-3 right-3 z-20 bg-amber-950/90 border border-amber-400/70 text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded tracking-wider uppercase shadow-lg">
                SNAPSHOT LOCKED // N-OBJECT GRAPH ACTIVE
              </div>
            )}

            {!cameraActive && !useHardwareBench && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs gap-1.5 pointer-events-none">
                <Scan className="w-6 h-6 text-slate-700 mb-1" />
                <span className="tracking-widest font-semibold text-slate-400">
                  [ SYNTHETIC WORKSPACE COUNTERTOP ]
                </span>
              </div>
            )}

            {/* RENDERIZADO DE LAS N MÁSCARAS DINÁMICAS (SIN CRASH) */}
            {masks.map((mask) => {
              const [x, y, w, h] = mask.bbox || [0, 0, 0.1, 0.1];
              const style: React.CSSProperties = {
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
              };

              if (mask.isSensitivePII) {
                return (
                  <div
                    key={mask.id}
                    style={{
                      ...style,
                      backgroundImage:
                        'repeating-linear-gradient(45deg, rgba(6,78,59,0.55) 0px, rgba(6,78,59,0.55) 10px, rgba(2,44,34,0.85) 10px, rgba(2,44,34,0.85) 20px)',
                    }}
                    className="absolute backdrop-blur-xl border-2 border-emerald-400 rounded-md flex flex-col items-center justify-center p-2 z-20 shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all duration-300"
                  >
                    <div className="flex items-center gap-1 bg-slate-950/95 border border-emerald-400/80 px-2 py-0.5 rounded">
                      <ShieldAlert className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-[10px] font-extrabold text-emerald-300">[PII REDACTED]</span>
                    </div>
                  </div>
                );
              }

              const rawStatus = mask.assignedActionStatus || 'IDLE_OBSERVED';

              const styleMap: Record<
                string,
                { box: string; badge: string; label: string; isActive: boolean }
              > = {
                QUARANTINED: {
                  box: 'border-2 border-rose-500 bg-rose-500/25 text-rose-200 shadow-[0_0_25px_rgba(244,63,94,0.45)] z-20',
                  badge: 'bg-rose-950/95 border-rose-400 text-rose-200',
                  label: `QUARANTINE // ${mask.label || mask.id}`,
                  isActive: true,
                },
                STOCK_MUTATED: {
                  box: 'border-2 border-emerald-400 bg-emerald-400/25 text-emerald-200 shadow-[0_0_25px_rgba(52,211,153,0.45)] z-20',
                  badge: 'bg-emerald-950/95 border-emerald-400 text-emerald-200',
                  label: `STOCK INBOUND // ${mask.label || mask.id}`,
                  isActive: true,
                },
                CATALOG_SYNTH: {
                  box: 'border-2 border-cyan-400 bg-cyan-400/25 text-cyan-200 shadow-[0_0_25px_rgba(34,211,238,0.45)] z-20',
                  badge: 'bg-cyan-950/95 border-cyan-400 text-cyan-200',
                  label: `8K STUDIO // ${mask.label || mask.id}`,
                  isActive: true,
                },
                IDLE_OBSERVED: {
                  box: 'border border-slate-400/50 bg-slate-900/15 text-slate-300 z-10',
                  badge: 'bg-slate-950/85 border-slate-600 text-slate-300',
                  label: mask.label || mask.id,
                  isActive: false,
                },
                IDLE: {
                  box: 'border border-slate-400/50 bg-slate-900/15 text-slate-300 z-10',
                  badge: 'bg-slate-950/85 border-slate-600 text-slate-300',
                  label: mask.label || mask.id,
                  isActive: false,
                },
              };

              const styleConfig = styleMap[rawStatus] || styleMap.IDLE_OBSERVED;

              return (
                <div
                  key={mask.id}
                  style={style}
                  className={`absolute rounded-md transition-all duration-300 ${styleConfig.box}`}
                >
                  <div
                    className={`text-[9px] font-bold px-1.5 py-0.5 inline-flex items-center gap-1 border-b border-r rounded-br shadow ${styleConfig.badge}`}
                  >
                    {styleConfig.isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-current animate-ping" />
                    )}
                    <span className="truncate max-w-[160px]">{styleConfig.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-[#090A0F] border border-slate-800 rounded p-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Command:</span>
              <input
                type="text"
                value={voiceText}
                onChange={(e) => setVoiceText(e.target.value)}
                placeholder="Escribí el comando acá o usá MIC..."
                className="flex-1 bg-[#0c0e14] border border-slate-800 text-cyan-300 text-sm px-3 py-2 rounded outline-none focus:border-cyan-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={toggleMicListening}
                disabled={isRunning}
                className={`px-3 py-3 rounded border font-bold text-xs flex items-center gap-1.5 cursor-pointer transition ${isListeningMic
                  ? 'bg-rose-500/20 border-rose-400 text-rose-300 animate-pulse'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                  }`}
              >
                <Mic className="w-4 h-4 text-cyan-400" />
                {isListeningMic ? 'LISTENING...' : 'MIC'}
              </button>

              <button
                onClick={triggerOrchestration}
                disabled={isRunning}
                className={`flex-1 py-3 rounded font-extrabold text-xs tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${isRunning
                  ? 'bg-amber-500/20 border border-amber-400 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                  : 'bg-cyan-400 hover:bg-cyan-300 text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.3)]'
                  }`}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    EXECUTING SPATIAL DAG... (STREAMING SSE)
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    TRIGGER GOLDEN PATH (SPACEBAR / CLICK)
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="col-span-3 border border-slate-800 bg-[#0D1017] rounded-lg p-3 flex flex-col gap-3 overflow-hidden">
          <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amber-400" /> AGENT EXECUTION DAG (SSE)
          </div>

          <div className="flex-1 relative pl-4 border-l-2 border-slate-800 space-y-2.5 overflow-y-auto pr-1">
            {steps.map((step) => {
              const badgeColors = {
                PENDING: 'border-slate-800 bg-[#090A0F] text-slate-500',
                RUNNING:
                  'border-cyan-400 bg-cyan-950/50 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.2)] animate-pulse',
                MUTATED: 'border-emerald-500/70 bg-emerald-950/25 text-emerald-300',
              };

              return (
                <div
                  key={step.id}
                  className={`p-2 rounded border text-xs transition-all ${badgeColors[step.status]}`}
                >
                  <div className="flex items-center justify-between font-bold mb-0.5">
                    <span>{step.title}</span>
                    {step.status === 'RUNNING' && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
                    {step.status === 'MUTATED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <div className="text-[10px] text-slate-400 flex justify-between">
                    <span>{step.model}</span>
                    {step.latencyMs && <span className="text-cyan-400 font-bold">{step.latencyMs}ms</span>}
                  </div>
                  {step.detail && (
                    <div className="mt-1 pt-1 border-t border-slate-800/80 text-[10px] text-white">
                      {step.detail}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-[#050608] border border-amber-500/40 rounded p-2.5 text-[10px]">
            <div className="flex items-center gap-1.5 text-amber-400 font-bold mb-1">
              <BrainCircuit className="w-3.5 h-3.5" />
              <span>MUSE SPARK OPEN REASONING TRACE</span>
            </div>
            <div className="text-slate-300 leading-relaxed max-h-24 overflow-y-auto whitespace-pre-line">
              {reasoningTrace || 'Awaiting spatial coordinates & voice stream...'}
            </div>
          </div>
        </section>

        <section className="col-span-4 flex flex-col gap-3 overflow-y-auto">
          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-400" /> LIVE INVENTORY STATE (AUTO-UPSERT)
            </div>
            <div className="space-y-2">
              {inventory.map((item) => (
                <div
                  key={item.sku}
                  className="bg-[#090A0F] border border-slate-800 p-2.5 rounded flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-white">{item.name}</div>
                    <div className="text-[10px] text-slate-500">{item.sku}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold">{item.stock} units</div>
                    <div className="text-[11px] text-cyan-300 font-semibold">
                      ${Number(item.sellPriceUsd).toFixed(2)} USD
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" /> SUPPLIER CLAIM & ZERO-TRUST GUARDRAIL
              </span>
              {latestClaim?.mongoId && (
                <span className="text-[9px] text-emerald-400 font-mono bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800">
                  DB_TX: {latestClaim.mongoId.slice(0, 10)}...
                </span>
              )}
            </div>
            {latestClaim ? (
              <div className="bg-rose-950/30 border border-rose-500/60 rounded p-2.5 text-xs space-y-2">
                <div className="flex gap-2.5 items-center">
                  {latestClaim.cropBase64 && latestClaim.cropBase64.startsWith('data:image') && (
                    <img
                      src={latestClaim.cropBase64}
                      alt="Defect Crop"
                      className="w-12 h-12 rounded border border-rose-400 object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1">
                    <div className="flex justify-between font-bold text-rose-300">
                      <span>TICKET #{latestClaim.id}</span>
                      <span>-${Number(latestClaim.amountUsd).toFixed(2)} USD</span>
                    </div>
                    <div className="text-[11px] text-slate-200 mt-0.5">{latestClaim.reason}</div>
                  </div>
                </div>

                {latestClaim.guardrailStatus === 'HELD_WAITING_VOICE_AUTH' ? (
                  <div className="pt-1 flex flex-col gap-1.5">
                    <div className="text-[10px] text-amber-400 font-bold">
                      ⚠ ZERO-TRUST GUARDRAIL: Financial Impact &gt;$100 USD Held
                    </div>
                    <button
                      onClick={authorizeGuardrailClaim}
                      className="w-full py-1.5 px-2 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(245,158,11,0.3)] transition"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      [PRESS C] AUTHORIZE & DISPATCH CLAIM
                    </button>
                  </div>
                ) : (
                  <div className="text-[10px] bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-bold px-2 py-1 rounded flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    AUTHORIZED BY OPERATOR // SENT VIA {latestClaim.dispatchChannel}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-slate-600 py-3 text-center">No active defect claims</div>
            )}
          </div>

          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" /> CROP-TO-STUDIO SYNTHESIS (MUSE IMAGE)
              </span>
              {latestCatalog?.mongoId && (
                <span className="text-[9px] text-cyan-400 font-mono bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800">
                  DB_TX: {latestCatalog.mongoId.slice(0, 10)}...
                </span>
              )}
            </div>

            {latestCatalog ? (
              <div className="bg-cyan-950/20 border border-cyan-500/50 rounded p-2.5 text-xs space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                      {latestCatalog.status}
                    </span>
                    <div className="font-bold text-white mt-1 truncate">{latestCatalog.title}</div>
                  </div>
                </div>

                <div className="grid grid-cols-11 items-center gap-2 bg-[#050608] p-2 rounded border border-slate-800">
                  <div className="col-span-5 flex flex-col items-center">
                    <div className="relative w-full aspect-square rounded border border-slate-600 overflow-hidden bg-slate-950">
                      <img
                        src={latestCatalog.sourceCropUrl}
                        alt="SAM 3.1 Raw Crop"
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute top-1 left-1 bg-slate-950/90 border border-slate-700 text-[8px] px-1.5 py-0.5 rounded text-slate-300 font-bold">
                        1. SAM 3.1 CROP
                      </span>
                    </div>
                    <span className="text-[9px] text-slate-400 mt-1">Raw Countertop Pixel Crop</span>
                  </div>

                  <div className="col-span-1 flex flex-col items-center justify-center text-cyan-400 font-extrabold text-sm">
                    <span>➔</span>
                  </div>

                  <div className="col-span-5 flex flex-col items-center">
                    <div className="relative w-full aspect-square rounded border-2 border-cyan-400 overflow-hidden bg-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.3)]">
                      <img
                        src={latestCatalog.studioImageUrl}
                        alt="Muse Image 8K Studio"
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute top-1 left-1 bg-cyan-950/90 border border-cyan-400/60 text-[8px] px-1.5 py-0.5 rounded text-cyan-200 font-bold">
                        2. MUSE IMAGE 8K
                      </span>
                    </div>
                    <span className="text-[9px] text-cyan-300 font-semibold mt-1">Studio E-Commerce Asset</span>
                  </div>
                </div>

                {latestCatalog.visualDna && (
                  <div className="grid grid-cols-2 gap-1.5 bg-[#090A0F] p-2 rounded border border-cyan-900/50 text-[9px]">
                    <div className="truncate">
                      <span className="text-cyan-400 font-bold">GEOMETRY: </span>
                      <span className="text-slate-200">{latestCatalog.visualDna.containerGeometry}</span>
                    </div>
                    <div className="truncate">
                      <span className="text-cyan-400 font-bold">PALETTE: </span>
                      <span className="text-slate-200">{latestCatalog.visualDna.exactColorPalette}</span>
                    </div>
                    <div className="truncate">
                      <span className="text-cyan-400 font-bold">OCR BRAND: </span>
                      <span className="text-slate-200">{latestCatalog.visualDna.detectedBrandOrText}</span>
                    </div>
                    <div className="truncate">
                      <span className="text-cyan-400 font-bold">MATERIAL: </span>
                      <span className="text-slate-200">{latestCatalog.visualDna.surfaceMaterial}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-slate-600 py-3 text-center">
                Awaiting target mask spatial crop...
              </div>
            )}
          </div>

          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3 flex-1">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-amber-400" /> MUSE CODE FINANCIAL SANDBOX (node:vm)
            </div>
            {vmExecution ? (
              <pre className="bg-[#050608] border border-slate-800 p-2.5 rounded text-[10px] text-emerald-300 overflow-x-auto leading-relaxed">
                {vmExecution.cleanCodeShownInUI}
                {'\n\n'}// Output Price: ${vmExecution.finalPrice} USD (Fallback: {String(vmExecution.usedFallback)})
              </pre>
            ) : (
              <div className="text-[11px] text-slate-600 py-3 text-center">VM idle</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}