import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Cpu,
  Scan,
  CheckCircle2,
  AlertTriangle,
  Package,
  Terminal,
  Play,
  Camera,
  Loader2,
  Activity,
  Mic,
  RotateCcw,
  BrainCircuit,
  Upload,
  XCircle,
  Zap,
  Sparkles,
} from 'lucide-react';

// --- TYPES ---
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
  _highlightDelta?: string;
  _repriced?: boolean;
}

interface ExecutionStep {
  id: string;
  title: string;
  model: string;
  status: 'PENDING' | 'RUNNING' | 'MUTATED' | 'FAILED';
  detail?: string;
  latencyMs?: number;
}

// --- CONSTANTS ---
const MAX_FRAME_SIDE = 960;

const MASK_STYLE_MAP: Record<string, string> = {
  IDLE_OBSERVED: 'border-slate-500/60 text-slate-300',
  IDLE: 'border-slate-500/60 text-slate-300',
  QUARANTINED: 'border-rose-500 text-rose-100 shadow-[0_0_12px_rgba(244,63,94,0.6)]',
  STOCK_MUTATED: 'border-emerald-400 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.6)]',
  CATALOG_SYNTH: 'border-cyan-400 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.6)]',
  PII_REDACTED: 'border-amber-400 bg-amber-400/20 text-amber-100',
};

const resolveMaskStyle = (status: string | undefined): string =>
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

const INITIAL_INVENTORY: InventoryItem[] = [
  { sku: 'SKU-DDR5-32GB-KIT', name: 'Fury Beast DDR5 32GB (2x16GB) Black', stock: 14, sellPriceUsd: 158.0 },
  { sku: 'SKU-NVME-2TB-GEN4', name: 'M.2 NVMe PCIe 4.0 SSD 2TB', stock: 8, sellPriceUsd: 185.0 },
];

// --- SUB-COMPONENTS ---

const TelemetryHud = ({ telemetry }: { telemetry: any }) => (
  <div className="flex items-center gap-4 text-[10px] uppercase tracking-wider font-semibold">
    <div className="flex items-center gap-1.5 bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
      <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
      <span className="text-slate-400">PII check:</span>
      <span className="text-emerald-400">{telemetry.glimmerMs || '--'}ms</span>
    </div>
    <div className="flex items-center gap-1.5 bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
      <Scan className="w-3.5 h-3.5 text-cyan-400" />
      <span className="text-slate-400">{telemetry.segmenter}:</span>
      <span className="text-cyan-400">{telemetry.samMs || '--'}ms</span>
    </div>
    <div className="flex items-center gap-1.5 bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
      <Cpu className="w-3.5 h-3.5 text-amber-400" />
      <span className="text-slate-400">Spark Open (Baseten):</span>
      <span className="text-amber-400">{telemetry.sparkMs || '--'}ms</span>
    </div>
  </div>
);

const ReasoningTerminal = ({ trace, isRunning }: { trace: string; isRunning: boolean }) => {
  const lines = trace.split('\n').filter(Boolean);
  return (
    <div className="border border-slate-800 bg-[#0A0C10] rounded-lg p-3 flex-1 flex flex-col min-h-0 relative shadow-inner">
      <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 border-b border-slate-800/80 pb-2 mb-2 flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-cyan-500" /> MUSE SPARK OPEN REASONING TRACE
      </div>
      <div className="text-[10px] font-mono text-slate-400 whitespace-pre-wrap leading-relaxed overflow-y-auto [scrollbar-width:none] flex-1">
        {lines.map((line, i) => {
          const match = line.match(/^\[(.*?)\]\s*(.*)$/);
          if (match) {
            const tag = match[1];
            const content = match[2];
            let tagColor = 'text-slate-300 bg-slate-800';
            if (tag === 'SCENE_GRAPH') tagColor = 'text-cyan-300 bg-cyan-950/60 border border-cyan-800/50';
            if (tag === 'SEMANTIC_BINDING') tagColor = 'text-emerald-300 bg-emerald-950/60 border border-emerald-800/50';
            if (tag === 'GUARDRAIL_AUDIT') tagColor = 'text-amber-300 bg-amber-950/60 border border-amber-800/50';
            if (tag === 'VISUAL_DNA') tagColor = 'text-purple-300 bg-purple-950/60 border border-purple-800/50';

            return (
              <div key={i} className="mb-1.5 flex flex-col sm:flex-row sm:items-start gap-1.5">
                <span className={`px-1.5 py-0.5 rounded-[3px] font-bold text-[9px] whitespace-nowrap ${tagColor}`}>
                  {tag}
                </span>
                <span className="text-slate-300 leading-snug">{content}</span>
              </div>
            );
          }
          return <div key={i} className="mb-1">{line}</div>;
        })}
        {isRunning && <span className="animate-pulse text-cyan-400 text-sm align-middle">▋</span>}
        {!isRunning && lines.length === 0 && (
          <div className="text-slate-600 italic mt-2">Awaiting spatial directives...</div>
        )}
      </div>
    </div>
  );
};

const AgentDagPanel = ({ steps, piiRedacted }: { steps: ExecutionStep[]; piiRedacted: number }) => (
  <div className="border border-slate-800 bg-[#0A0C10] rounded-lg p-3">
    <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 border-b border-slate-800/80 pb-2 mb-2 flex items-center gap-2">
      <BrainCircuit className="w-3.5 h-3.5 text-amber-500" /> AGENT EXECUTION DAG (SSE)
    </div>
    <div className="space-y-1.5">
      {steps
        .filter((step) => step.id !== 'edge_pii' || piiRedacted > 0)
        .map((step) => (
          <div key={step.id} className={`border rounded-[4px] p-2 text-[11px] transition-colors duration-300 ${step.status === 'RUNNING' ? 'border-cyan-500/50 bg-cyan-950/20' : step.status === 'FAILED' ? 'border-rose-500/50 bg-rose-950/20' : 'border-slate-800/60 bg-[#0D1017]'}`}>
            <div className="flex justify-between items-center">
              <span className={`font-semibold ${step.status === 'FAILED' ? 'text-rose-400' : 'text-slate-200'}`}>{step.title}</span>
              {step.status === 'MUTATED' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 drop-shadow-[0_0_4px_#34d399]" />
              ) : step.status === 'FAILED' ? (
                <XCircle className="w-3.5 h-3.5 text-rose-500 drop-shadow-[0_0_4px_#f43f5e]" />
              ) : step.status === 'RUNNING' ? (
                <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full border border-slate-600" />
              )}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 mt-1 font-bold">{step.model}</div>
            {step.detail && <div className={`text-[10px] mt-1 font-medium ${step.status === 'FAILED' ? 'text-rose-300' : 'text-slate-300'}`}>{step.detail}</div>}
            {step.latencyMs !== undefined && (
              <div className="text-[9px] font-mono text-cyan-600 mt-1">{step.latencyMs}ms</div>
            )}
          </div>
        ))}
    </div>
  </div>
);

// --- MAIN APP ---

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sceneImgRef = useRef<HTMLImageElement | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const visualQueue = useRef<Array<() => Promise<void>>>([]);
  const isQueueRunning = useRef(false);

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [sourceDims, setSourceDims] = useState<{ w: number; h: number } | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const [cameraActive, setCameraActive] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [flashEffect, setFlashEffect] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isListeningMic, setIsListeningMic] = useState(false);
  const [shouldAutoTrigger, setShouldAutoTrigger] = useState(false);

  const [masks, setMasks] = useState<SpatialMask[]>([]);
  const [activePulse, setActivePulse] = useState<{ id: string; actionText: string } | null>(null);

  const [telemetry, setTelemetry] = useState({
    glimmerMs: 0, samMs: 0, sparkMs: 0, segmenter: 'Sharp crop', tokensSavedPct: 0, piiRedacted: 0,
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
        return canvas.toDataURL('image/jpeg', 0.72);
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

  // --- STAGGERED DOMINO QUEUE ENGINE ---
  const processVisualQueue = async () => {
    if (isQueueRunning.current) return;
    isQueueRunning.current = true;

    while (visualQueue.current.length > 0) {
      const task = visualQueue.current.shift();
      if (task) {
        await task();
        // 180ms delay to create the cinematic cascading effect
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    }
    isQueueRunning.current = false;
  };

  const enqueueVisualTask = (task: () => Promise<void> | void) => {
    visualQueue.current.push(async () => {
      await task();
    });
    processVisualQueue();
  };

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

  // --- ORCHESTRATION TRIGGER ---
  const triggerOrchestration = useCallback(async () => {
    if (isRunning) return;
    
    // UI Flash & Reset
    setIsRunning(true);
    setIsFrozen(true);
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 150);

    const frameBase64 = captureFrameBase64();
    if (videoRef.current && cameraActive) {
      videoRef.current.pause();
    }

    // Reset Engine State
    abortControllerRef.current = new AbortController();
    visualQueue.current = [];
    isQueueRunning.current = false;

    setMasks([]);
    setReasoningTrace('');
    setLatestClaim(null);
    setLatestCatalog(null);
    setVmExecution(null);
    setInventory(INITIAL_INVENTORY);
    setTelemetry({ glimmerMs: 0, samMs: 0, sparkMs: 0, segmenter: 'Sharp crop', tokensSavedPct: 0, piiRedacted: 0 });
    setSteps(
      INITIAL_STEPS.map((s, idx) => ({
        ...s,
        status: idx === 0 ? 'RUNNING' : 'PENDING',
        detail: idx === 0 ? 'Scanning the frame and planning the DAG...' : undefined,
      }))
    );

    try {
      const response = await fetch('http://localhost:4000/api/orchestrate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameBase64, voiceTranscript: voiceText }),
        signal: abortControllerRef.current.signal,
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

          if (eventName === 'VISION_SCAN_STARTED') {
            enqueueVisualTask(() => {
              updateStep('edge_pii', { status: 'RUNNING', detail: 'Muse Spark Open is reading the frame' });
            });
          }

          if (eventName === 'EDGE_PII_SHIELD') {
            const redactedLen = Array.isArray(payload.redactedMasks) ? payload.redactedMasks.length : 0;
            enqueueVisualTask(() => {
              setTelemetry((t) => ({ ...t, glimmerMs: payload.latencyMs || t.glimmerMs, piiRedacted: redactedLen }));
              updateStep('edge_pii', { status: 'MUTATED', latencyMs: payload.latencyMs, detail: `PII shields: ${redactedLen}` });
            });
          }

          if (eventName === 'SPATIAL_LOCK') {
            const incomingObjects = Array.isArray(payload.objects) ? payload.objects : [];
            enqueueVisualTask(() => {
              setMasks(incomingObjects);
              setTelemetry((t) => ({
                ...t,
                samMs: payload.samUsed ? payload.samLatencyMs : payload.latencyMs || t.samMs,
                sparkMs: payload.sparkLatencyMs || t.sparkMs,
                segmenter: payload.samUsed ? 'SAM 3.1' : 'Sharp crop',
              }));
              updateStep('sam_lock', {
                status: 'MUTATED',
                model: payload.samUsed ? 'SAM 3.1' : 'Muse Spark Vision + Sharp',
                latencyMs: payload.samUsed ? payload.samLatencyMs : payload.latencyMs,
                detail: payload.samUsed
                  ? `SAM 3.1 tightened ${payload.samRefined} boxes`
                  : `${incomingObjects.length} actionable objects cropped`,
              });
              updateStep('spark_plan', { status: 'RUNNING' });
            });
          }

          if (eventName === 'SPARK_REASONING_TRACE') {
            // High-frequency stream, don't enqueue to avoid massive delays on trace writing
            setReasoningTrace(payload.reasoning || '');
          }

          if (eventName === 'SPARK_PLAN_LOCKED') {
            enqueueVisualTask(() => {
              setTelemetry((t) => ({ ...t, sparkMs: payload.latencyMs || 440 }));
              updateStep('spark_plan', { status: 'MUTATED', latencyMs: payload.latencyMs || 440, detail: payload.plan?.summary || 'Spatial DAG plan locked' });
              
              // Light up all tool spinners simultaneously so they are ready for the domino completion
              ['quarantine_and_claim', 'mutate_inventory', 'generate_studio_catalog', 'recalculate_margins_vm'].forEach(
                (id) => updateStep(id, { status: 'RUNNING', detail: 'Executing operation...' })
              );
            });
          }

          if (eventName === 'TOOL_MUTATED') {
            const { tool, targetMaskId, result } = payload;
            const resolvedMaskId = targetMaskId || result?.maskId;

            // Enqueue the heavy UI changes for the Domino Effect
            enqueueVisualTask(() => {
              if (resolvedMaskId) {
                setMasks((prev) => prev.map((m) =>
                  m.id === resolvedMaskId ? { ...m, assignedActionStatus: getMaskStatusForTool(tool) } : m
                ));
                // Spatial-to-Text Pulse Effect
                setActivePulse({ id: resolvedMaskId, actionText: getPulseActionText(tool) });
                setTimeout(() => setActivePulse(null), 350);
              }

              if (tool === 'quarantine_and_claim' && result) {
                setLatestClaim(result);
                const held = result.guardrailStatus === 'HELD_WAITING_VOICE_AUTH';
                updateStep(tool, {
                  status: 'MUTATED',
                  detail: held ? `Claim #${result.id} (-$${Number(result.amountUsd).toFixed(2)}) exceeds auto-limit` : `Claim #${result.id} auto-approved`,
                });
              }

              if (tool === 'mutate_inventory' && result) {
                setInventory((prev) => {
                  const exists = prev.some((item) => item.sku === result.sku);
                  if (exists) {
                    return prev.map((item) =>
                      item.sku === result.sku
                        ? { ...item, stock: result.stock, sellPriceUsd: result.sellPriceUsd ?? item.sellPriceUsd, _highlightDelta: `+${result.delta ?? 1}` }
                        : item
                    );
                  }
                  return [{ sku: result.sku, name: result.name || 'Component', stock: result.stock ?? 1, sellPriceUsd: result.sellPriceUsd ?? 149.0, _highlightDelta: `+${result.delta ?? 1}` }, ...prev];
                });
                const mutationLine = `${result.sku}: ${result.previousStock ?? '?'}→${result.stock} (+${result.delta ?? 1})`;
                updateStep(tool, { status: 'MUTATED', detail: mutationLine });
                
                // Clear the row highlight after 2s
                setTimeout(() => {
                  setInventory((current) => current.map(item => item.sku === result.sku ? { ...item, _highlightDelta: undefined } : item));
                }, 2000);
              }

              if (tool === 'generate_studio_catalog' && result) {
                setLatestCatalog(result);
                updateStep(tool, { status: 'MUTATED', latencyMs: result.synthesisLatencyMs, detail: `Published "${result.title}"` });
              }

              if (tool === 'recalculate_margins_vm' && result) {
                setVmExecution(result);
                const targetSku = result.updatedSku || 'SKU-DDR5-32GB-KIT';
                setInventory((prev) => prev.map((item) =>
                    item.sku === targetSku ? { ...item, sellPriceUsd: result.finalPrice, _repriced: true } : item
                ));
                updateStep(tool, { status: 'MUTATED', detail: `${targetSku} repriced to $${result.finalPrice} USD` });
                
                setTimeout(() => {
                  setInventory((current) => current.map(item => item.sku === targetSku ? { ...item, _repriced: undefined } : item));
                }, 2000);
              }
            });
          }

          if (eventName === 'ORCHESTRATION_COMPLETE') {
            enqueueVisualTask(() => {
              setIsRunning(false);
              // Avoid blindly overwriting inventory here so we don't kill our micro-interactions
            });
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('SSE Stream Error:', err);
      enqueueVisualTask(() => {
        setIsRunning(false);
        setIsFrozen(false);
      });
    }
  }, [isRunning, cameraActive, uploadedImage, voiceText]);

  const abortRun = () => {
    abortControllerRef.current?.abort();
    visualQueue.current = []; // Nuke the queue
    isQueueRunning.current = false;
    setIsRunning(false);
    setIsFrozen(false);
    setActivePulse(null);
    setSteps((prev) => prev.map((s) => (s.status === 'RUNNING' || s.status === 'PENDING' ? { ...s, status: 'FAILED', detail: 'Aborted by operator' } : s)));
  };

  const authorizeGuardrailClaim = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:4000/api/confirm-guardrail', { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.claim) {
        setLatestClaim(data.claim);
        updateStep('quarantine_and_claim', { detail: `Claim #${data.claim.id} AUTHORIZED (LOCAL_LEDGER)` });
      }
    } catch (err) {
      console.error('Guardrail confirm failed', err);
    }
  }, []);

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
    visualQueue.current = [];
    isQueueRunning.current = false;
    abortControllerRef.current?.abort();
    setVoiceText(DEFAULT_PROMPT);
    setTelemetry({ glimmerMs: 0, samMs: 0, sparkMs: 0, segmenter: 'Sharp crop', tokensSavedPct: 0, piiRedacted: 0 });
    setInventory(INITIAL_INVENTORY);
    setSteps(INITIAL_STEPS);
    if (videoRef.current && cameraActive) videoRef.current.play();
  }, [cameraActive]);

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
      if (e.code === 'Space' && !isRunning) { e.preventDefault(); triggerOrchestration(); }
      if (e.code === 'KeyC') { e.preventDefault(); authorizeGuardrailClaim(); }
      if (e.code === 'KeyR') { e.preventDefault(); resetDemoState(); }
      if (e.code === 'Escape' && isRunning) { e.preventDefault(); abortRun(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerOrchestration, authorizeGuardrailClaim, resetDemoState, isRunning]);

  const renderMask = (m: SpatialMask) => {
    const [x, y, w, h] = m.bbox;
    const isApproximate = m.confidence === undefined || m.confidence < 0.1;
    const isActive = activePulse?.id === m.id;
    
    // Default Tactical Styling
    let borderStyle = isApproximate ? 'border-dashed border-amber-500/80' : resolveMaskStyle(m.assignedActionStatus);
    let extraClasses = 'transition-all duration-300';
    let opacity = isApproximate ? 0.7 : (m.confidence ? Math.max(0.4, m.confidence) : 1);
    
    // Kinetic Spatial-to-Text Pulse Override
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
        className={`absolute border-2 ${borderStyle} rounded-[2px] pointer-events-none ${extraClasses}`}
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, opacity }}
      >
        {/* Tactical Corner Brackets */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t-[3px] border-l-[3px] -translate-x-[2px] -translate-y-[2px] border-current opacity-70" />
        <div className="absolute top-0 right-0 w-2 h-2 border-t-[3px] border-r-[3px] translate-x-[2px] -translate-y-[2px] border-current opacity-70" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b-[3px] border-l-[3px] -translate-x-[2px] translate-y-[2px] border-current opacity-70" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b-[3px] border-r-[3px] translate-x-[2px] translate-y-[2px] border-current opacity-70" />

        <div className="absolute -top-6 left-0 text-[10px] bg-slate-950/90 border border-slate-700/50 px-1.5 py-0.5 rounded text-slate-100 whitespace-nowrap font-medium tracking-wide shadow-lg">
          {m.label || m.id} {isApproximate ? <span className="text-amber-400 font-bold ml-1">[ APPROX ]</span> : (m.confidence ? <span className="text-cyan-400 font-bold ml-1">[ {(m.confidence * 100).toFixed(1)}% ]</span> : '')}
        </div>

        {/* Action Badge Overdrive for the Pulse */}
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
      
      {/* UI Flash Shutter */}
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
                <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={(e) => setSourceDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} className="w-full h-full object-cover" />
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

            {/* Tactical LiDAR Scanner Overlay */}
            {isRunning && masks.length === 0 && (cameraActive || uploadedImage) && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden bg-[linear-gradient(to_right,#22d3ee08_1px,transparent_1px),linear-gradient(to_bottom,#22d3ee08_1px,transparent_1px)] bg-[size:32px_32px]">
                <div className="absolute left-0 right-0 h-[3px] bg-cyan-400 shadow-[0_0_24px_#22d3ee]" style={{ animation: 'kinetix-scan 2s ease-in-out infinite' }} />
                <div className="absolute bottom-4 right-4 text-[10px] font-mono tracking-widest text-cyan-300 bg-slate-950/80 border border-cyan-500/40 px-2 py-1 rounded shadow-lg flex items-center gap-2">
                  <Zap className="w-3 h-3 text-cyan-400 animate-pulse" /> SPATIAL MAPPING IN PROGRESS
                </div>
              </div>
            )}
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
          <div className="border border-slate-800 bg-[#0A0C10] rounded-lg p-3 shadow-inner">
            <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 border-b border-slate-800/80 pb-2 mb-2 flex items-center gap-2">
              <Package className="w-3.5 h-3.5 text-emerald-500" /> LIVE INVENTORY STATE (UPSERT)
            </div>
            <div className="space-y-2">
              {inventory.map((item) => (
                <div key={item.sku} className={`flex justify-between items-center text-[11px] border-b border-slate-800/50 pb-1.5 transition-all duration-500 ${item._highlightDelta || item._repriced ? 'bg-emerald-950/20 rounded px-1' : ''}`}>
                  <div>
                    <div className="text-slate-200 font-semibold">{item.name}</div>
                    <div className="text-slate-500 text-[9px] font-mono tracking-wider">{item.sku}</div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className="flex items-center gap-1.5">
                      {item._highlightDelta && <span className="bg-emerald-500 text-slate-950 font-bold px-1 rounded-[2px] text-[9px] animate-pulse">{item._highlightDelta}</span>}
                      <span className="text-emerald-400 font-bold">{item.stock} units</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {item._repriced && <span className="bg-cyan-500 text-slate-950 font-bold px-1 rounded-[2px] text-[8px]">REPRICED</span>}
                      <span className="text-slate-400 text-[10px] font-mono">${item.sellPriceUsd?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
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
          <div className="border border-slate-800 bg-[#0A0C10] rounded-lg p-3 shadow-inner flex-1 flex flex-col min-h-0">
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
        </section>
      </main>
    </div>
  );
}