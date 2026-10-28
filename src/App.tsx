import { useState, useRef, useEffect, useCallback } from 'react';
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
  Upload,
} from 'lucide-react';

type MaskStatus =
  | 'IDLE_OBSERVED'
  | 'IDLE'
  | 'QUARANTINED'
  | 'STOCK_MUTATED'
  | 'CATALOG_SYNTH'
  | 'PII_REDACTED';

interface SpatialMask {
  id: string;
  label?: string;
  bbox: [number, number, number, number];
  zone?: string;
  spatialRegion2D?: string;
  assignedActionStatus?: MaskStatus;
  isSensitivePII: boolean;
  confidence: number;
}

interface InventoryItem {
  sku: string;
  name: string;
  stock: number;
  sellPriceUsd?: number;
}

const MASK_STYLE_MAP: Record<string, string> = {
  IDLE_OBSERVED: 'border-slate-500/60',
  IDLE: 'border-slate-500/60',
  QUARANTINED: 'border-rose-500',
  STOCK_MUTATED: 'border-emerald-400',
  CATALOG_SYNTH: 'border-cyan-400',
  PII_REDACTED: 'border-amber-400 bg-amber-400/20',
};

const resolveMaskStyle = (status: string | undefined): string =>
  MASK_STYLE_MAP[status ?? 'IDLE_OBSERVED'] || MASK_STYLE_MAP.IDLE_OBSERVED;

const MAX_FRAME_SIDE = 1280;

interface ExecutionStep {
  id: string;
  title: string;
  model: string;
  status: 'PENDING' | 'RUNNING' | 'MUTATED';
  detail?: string;
  latencyMs?: number;
}

const DEFAULT_PROMPT =
  'El objeto dañado vino roto, abrí reclamo. Sumá al stock las unidades que ves y armá foto de estudio del producto principal. Recalculá precios con 30% de margen.';

const INITIAL_STEPS: ExecutionStep[] = [
  { id: 'edge_pii', title: 'Edge Cognitive Filter & PII Redaction', model: 'muse-spark-open-1026', status: 'PENDING' },
  { id: 'sam_lock', title: 'Spatial Instance Segmentation (N-Graph)', model: 'SAM 3.1 Vision', status: 'PENDING' },
  { id: 'spark_plan', title: 'Multi-Tool DAG Reasoning', model: 'muse-spark-open-1026 (Baseten)', status: 'PENDING' },
  { id: 'quarantine_and_claim', title: 'Tool: Quarantine & Supplier Claim', model: 'Action Engine', status: 'PENDING' },
  { id: 'mutate_inventory', title: 'Tool: Inventory SKU Auto-Upsert', model: 'Action Engine', status: 'PENDING' },
  { id: 'generate_studio_catalog', title: 'Tool: E-Commerce Studio Synthesis', model: 'Muse Image', status: 'PENDING' },
  { id: 'recalculate_margins_vm', title: 'Tool: Financial Margin Sandbox', model: 'Muse Code (node:vm)', status: 'PENDING' },
];

const INITIAL_INVENTORY: InventoryItem[] = [
  { sku: 'SKU-DDR5-32GB-KIT', name: 'Fury Beast DDR5 32GB (2x16GB) Black', stock: 14, sellPriceUsd: 158.0 },
  { sku: 'SKU-NVME-2TB-GEN4', name: 'M.2 NVMe PCIe 4.0 SSD 2TB', stock: 8, sellPriceUsd: 185.0 },
];

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sceneImgRef = useRef<HTMLImageElement | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [sourceDims, setSourceDims] = useState<{ w: number; h: number } | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

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
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
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
        setUploadedImage(null);
      }
    } catch (err) {
      console.warn('Camera fallback active', err);
    }
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleImageUpload = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        sceneImgRef.current = img;
        setSourceDims({ w: img.naturalWidth, h: img.naturalHeight });
        setUploadedImage(dataUrl);
        setCameraActive(false);
        setMasks([]);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const stageBox = (() => {
    if (!sourceDims || !stageSize.w || !stageSize.h) return null;
    const scale = Math.min(stageSize.w / sourceDims.w, stageSize.h / sourceDims.h);
    return { w: sourceDims.w * scale, h: sourceDims.h * scale };
  })();

  const updateStep = (id: string, patch: Partial<ExecutionStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const captureFrameBase64 = (): string | null => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const drawSource = (source: CanvasImageSource, srcW: number, srcH: number) => {
        const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(srcW, srcH));
        canvas.width = Math.round(srcW * scale);
        canvas.height = Math.round(srcH * scale);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.82);
      };

      if (cameraActive && videoRef.current && videoRef.current.videoWidth > 0) {
        return drawSource(videoRef.current, videoRef.current.videoWidth, videoRef.current.videoHeight);
      }

      if (uploadedImage && sceneImgRef.current && sceneImgRef.current.complete) {
        return drawSource(sceneImgRef.current, sceneImgRef.current.naturalWidth, sceneImgRef.current.naturalHeight);
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
    if (videoRef.current && cameraActive) {
      videoRef.current.pause();
    }

    // FULL CLEAN START — never keep previous run data
    setMasks([]);
    setReasoningTrace('');
    setLatestClaim(null);
    setLatestCatalog(null);
    setVmExecution(null);
    setTelemetry({ glimmerMs: 0, samMs: 0, sparkMs: 0, tokensSavedPct: 68, piiRedacted: 0 });
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
                    stock: result.stock ?? 1,
                    sellPriceUsd: result.sellPriceUsd ?? 149.0,
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

          if (eventName === 'ORCHESTRATION_COMPLETE' && payload.storeState) {
            if (Array.isArray(payload.storeState.inventory)) {
              setInventory(payload.storeState.inventory);
            }
          }
        }
      }
    } catch (err) {
      console.error('SSE Stream Error:', err);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, cameraActive, uploadedImage, voiceText]);

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
    setInventory(INITIAL_INVENTORY);
    setSteps(INITIAL_STEPS);
    if (videoRef.current && cameraActive) {
      videoRef.current.play();
    }
  }, [cameraActive]);

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

  const renderMask = (m: SpatialMask) => {
    const [x, y, w, h] = m.bbox;
    return (
      <div
        key={m.id}
        className={`absolute border-2 ${resolveMaskStyle(m.assignedActionStatus)} rounded pointer-events-none`}
        style={{
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${w * 100}%`,
          height: `${h * 100}%`,
        }}
      >
        <div className="absolute -top-5 left-0 text-[9px] bg-black/80 px-1 rounded text-white whitespace-nowrap">
          {m.label || m.id}
        </div>
      </div>
    );
  };

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
            onClick={() => fileInputRef.current?.click()}
            className={`px-2.5 py-1 rounded border text-[10px] font-bold cursor-pointer flex items-center gap-1 ${uploadedImage ? 'border-cyan-400 bg-cyan-950/60 text-cyan-300' : 'border-slate-700 text-slate-400'
              }`}
          >
            <Upload className="w-3 h-3" /> Upload Image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handleImageUpload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            onClick={startCamera}
            className={`px-2.5 py-1 rounded border text-[10px] font-bold cursor-pointer ${cameraActive ? 'border-cyan-400 bg-cyan-950/60 text-cyan-300' : 'border-slate-700 text-slate-400'
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
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/50 font-bold">
              {isFrozen ? 'FRAME LOCKED (SEGMENTING)' : 'LIVE FEED'}
            </span>
          </div>

          <div
            ref={stageRef}
            className="relative flex-1 min-h-0 bg-black rounded border border-slate-800 overflow-hidden flex items-center justify-center"
          >
            {cameraActive && (
              <div
                className="relative"
                style={stageBox ? { width: stageBox.w, height: stageBox.h } : { width: '100%', height: '100%' }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={(e) =>
                    setSourceDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
                  }
                  className="w-full h-full"
                />
                {masks.map((m) => renderMask(m))}
              </div>
            )}
            {!cameraActive && uploadedImage && (
              <div
                className="relative"
                style={stageBox ? { width: stageBox.w, height: stageBox.h } : { width: '100%', height: '100%' }}
              >
                <img src={uploadedImage} alt="Workspace" className="w-full h-full" />
                {masks.map((m) => renderMask(m))}
              </div>
            )}
            {!cameraActive && !uploadedImage && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 text-slate-500 hover:text-cyan-300 cursor-pointer"
              >
                <Upload className="w-8 h-8" />
                <span className="text-[11px]">Upload any workspace image or start Live Cam</span>
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={toggleMicListening}
              className={`px-3 py-2 rounded border text-xs font-bold flex items-center gap-1.5 ${isListeningMic ? 'border-rose-500 bg-rose-950 text-rose-300' : 'border-slate-700 text-slate-300'
                }`}
            >
              <Mic className="w-4 h-4" /> MIC
            </button>
            <button
              onClick={triggerOrchestration}
              disabled={isRunning}
              className="flex-1 py-2 rounded bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2"
            >
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isRunning ? 'PROCESSING...' : 'TRIGGER GOLDEN PATH (SPACEBAR / CLICK)'}
            </button>
          </div>

          <textarea
            value={voiceText}
            onChange={(e) => setVoiceText(e.target.value)}
            className="w-full bg-[#090A0F] border border-slate-800 rounded p-2 text-[11px] text-slate-300 resize-none h-16"
          />
        </section>

        <section className="col-span-4 flex flex-col gap-3 overflow-auto">
          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-amber-400" /> AGENT EXECUTION DAG (SSE)
            </div>
            <div className="space-y-2">
              {steps.map((step) => (
                <div key={step.id} className="border border-slate-800/80 rounded p-2 text-[11px]">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-200">{step.title}</span>
                    {step.status === 'MUTATED' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : step.status === 'RUNNING' ? (
                      <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border border-slate-600" />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{step.model}</div>
                  {step.detail && <div className="text-[10px] text-slate-300 mt-1">{step.detail}</div>}
                  {step.latencyMs !== undefined && (
                    <div className="text-[10px] text-slate-500 mt-0.5">{step.latencyMs}ms</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3 flex-1">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" /> MUSE SPARK OPEN REASONING TRACE
            </div>
            <pre className="text-[10px] text-slate-400 whitespace-pre-wrap leading-relaxed max-h-48 overflow-auto">
              {reasoningTrace || 'Waiting for spatial reasoning...'}
            </pre>
          </div>
        </section>

        <section className="col-span-3 flex flex-col gap-3 overflow-auto">
          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-400" /> LIVE INVENTORY STATE (AUTO-UPSERT)
            </div>
            <div className="space-y-1.5">
              {inventory.length === 0 ? (
                <div className="text-[11px] text-slate-600 py-3 text-center">No inventory mutations yet</div>
              ) : (
                inventory.map((item) => (
                  <div key={item.sku} className="flex justify-between text-[11px] border-b border-slate-800/60 pb-1">
                    <div>
                      <div className="text-slate-200 font-medium">{item.name}</div>
                      <div className="text-slate-500 text-[10px]">{item.sku}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-emerald-400 font-bold">{item.stock} units</div>
                      <div className="text-slate-400 text-[10px]">${item.sellPriceUsd?.toFixed(2)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" /> SUPPLIER CLAIM & ZERO-TRUST GUARDRAIL
            </div>
            {latestClaim ? (
              <div className="border border-rose-500/60 rounded p-2.5 text-xs space-y-2">
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
                      ⚠ ZERO-TRUST GUARDRAIL: Financial Action Held (-${Number(latestClaim.amountUsd).toFixed(2)} USD)
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
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" /> CROP-TO-STUDIO SYNTHESIS (MUSE IMAGE)
            </div>
            {latestCatalog ? (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-cyan-300">{latestCatalog.title}</div>
                <div className="text-[9px] text-slate-500 font-bold tracking-wider">
                  BEFORE / AFTER: RAW SAM CROP &rarr; MUSE IMAGE 8K
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[9px] text-slate-500 mb-1">BEFORE // RAW SAM CROP</div>
                    <img
                      src={latestCatalog.sourceCropUrl}
                      alt="Raw SAM crop"
                      className="w-full aspect-square object-cover rounded border border-slate-700"
                    />
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500 mb-1">AFTER // MUSE IMAGE 8K</div>
                    <img
                      src={latestCatalog.studioImageUrl}
                      alt="Muse Image studio render"
                      className="w-full aspect-square object-cover rounded border border-cyan-800"
                    />
                  </div>
                </div>
                {latestCatalog.visualDna && (
                  <div className="flex flex-wrap gap-1.5 bg-[#090A0F] p-2 rounded border border-cyan-900/50 text-[9px]">
                    {[
                      ['GEOMETRY', latestCatalog.visualDna.containerGeometry],
                      ['PALETTE', latestCatalog.visualDna.exactColorPalette],
                      ['OCR BRAND', latestCatalog.visualDna.detectedBrandOrText],
                      ['MATERIAL', latestCatalog.visualDna.surfaceMaterial],
                    ].map(([name, value]) => (
                      <span
                        key={name}
                        title={String(value)}
                        className="px-2 py-0.5 rounded-full border border-cyan-800 bg-cyan-950/50 max-w-full truncate"
                      >
                        <span className="text-cyan-400 font-bold">{name}: </span>
                        <span className="text-slate-200">{value}</span>
                      </span>
                    ))}
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