import React, { useState, useRef, useEffect } from 'react';
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
} from 'lucide-react';

interface SpatialMask {
  id: string;
  bbox: [number, number, number, number];
  zone: 'LEFT' | 'CENTER' | 'RIGHT' | 'BOTTOM_PII';
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

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const [masks, setMasks] = useState<SpatialMask[]>([]);
  const [telemetry, setTelemetry] = useState({
    glimmerMs: 0,
    samMs: 0,
    sparkMs: 0,
    tokensSavedPct: 0,
    piiRedacted: 0,
  });

  const [steps, setSteps] = useState<ExecutionStep[]>([
    { id: 'edge_pii', title: 'Edge Cognitive Filter & PII Redaction', model: 'Muse Glimmer 30B', status: 'PENDING' },
    { id: 'sam_lock', title: 'Spatial Instance Segmentation', model: 'SAM 3.1 (Baseten)', status: 'PENDING' },
    { id: 'spark_plan', title: 'Multi-Tool DAG Reasoning', model: 'Muse Spark', status: 'PENDING' },
    { id: 'quarantine_and_claim', title: 'Tool: Quarantine & Supplier Claim', model: 'Action Engine', status: 'PENDING' },
    { id: 'mutate_inventory', title: 'Tool: Inventory SKU Mutation', model: 'Action Engine', status: 'PENDING' },
    { id: 'generate_studio_catalog', title: 'Tool: E-Commerce Studio Synthesis', model: 'Muse Image', status: 'PENDING' },
    { id: 'recalculate_margins_vm', title: 'Tool: Financial Margin Sandbox', model: 'Muse Code (node:vm)', status: 'PENDING' },
  ]);

  const [inventory, setInventory] = useState([
    { sku: 'SKU-SHAKER-V2', name: 'Titan Pro Shaker 700ml', stock: 45, sellPriceUsd: 21.0 },
    { sku: 'SKU-WHEY-2LB', name: 'IsoWhey Gold 2Lb Tub', stock: 18, sellPriceUsd: 62.0 },
  ]);
  const [latestClaim, setLatestClaim] = useState<any>(null);
  const [latestCatalog, setLatestCatalog] = useState<any>(null);
  const [vmExecution, setVmExecution] = useState<any>(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      console.warn('Camera fallback active (demo mode without physical webcam)', err);
    }
  };

  useEffect(() => {
    startCamera();
  }, []);

  const updateStep = (id: string, patch: Partial<ExecutionStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const triggerOrchestration = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setIsFrozen(true);
    if (videoRef.current && cameraActive) videoRef.current.pause();

    setMasks([]);
    setSteps((prev) => prev.map((s) => ({ ...s, status: 'PENDING', detail: undefined })));
    updateStep('edge_pii', { status: 'RUNNING' });

    try {
      const response = await fetch('http://localhost:4000/api/orchestrate-stream', {
        method: 'POST',
      });

      if (!response.body) throw new Error('No SSE body');
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
          const payload = JSON.parse(dataMatch[1].trim());

          if (eventName === 'EDGE_PII_SHIELD') {
            setTelemetry((t) => ({
              ...t,
              glimmerMs: payload.latencyMs,
              tokensSavedPct: payload.cloudTokensSavedPct,
              piiRedacted: payload.redactedMasks.length,
            }));
            updateStep('edge_pii', {
              status: 'MUTATED',
              latencyMs: payload.latencyMs,
              detail: `${payload.redactedMasks.length} PII region blurred on-device`,
            });
            updateStep('sam_lock', { status: 'RUNNING' });
          }

          if (eventName === 'SPATIAL_LOCK') {
            setMasks(payload.objects);
            setTelemetry((t) => ({ ...t, samMs: payload.latencyMs }));
            updateStep('sam_lock', {
              status: 'MUTATED',
              latencyMs: payload.latencyMs,
              detail: `${payload.objects.length} spatial polygons locked [LEFT, CENTER, RIGHT]`,
            });
            updateStep('spark_plan', { status: 'RUNNING' });
          }

          if (eventName === 'SPARK_PLAN_LOCKED') {
            setTelemetry((t) => ({ ...t, sparkMs: payload.latencyMs }));
            updateStep('spark_plan', {
              status: 'MUTATED',
              latencyMs: payload.latencyMs,
              detail: payload.plan.summary,
            });
            ['quarantine_and_claim', 'mutate_inventory', 'generate_studio_catalog', 'recalculate_margins_vm'].forEach(
              (id) => updateStep(id, { status: 'RUNNING' })
            );
          }

          if (eventName === 'TOOL_MUTATED') {
            const { tool, result } = payload;
            if (tool === 'quarantine_and_claim') {
              setLatestClaim(result);
              updateStep(tool, {
                status: 'MUTATED',
                detail: `Claim #${result.id} opened ($${result.amountUsd} USD)`,
              });
            }
            if (tool === 'mutate_inventory') {
              setInventory((prev) =>
                prev.map((item) => (item.sku === result.sku ? { ...item, stock: result.stock } : item))
              );
              updateStep(tool, {
                status: 'MUTATED',
                detail: `${result.sku} stock mutated -> ${result.stock} units`,
              });
            }
            if (tool === 'generate_studio_catalog') {
              setLatestCatalog(result);
              updateStep(tool, {
                status: 'MUTATED',
                detail: `Published "${result.title}"`,
              });
            }
            if (tool === 'recalculate_margins_vm') {
              setVmExecution(result);
              setInventory((prev) =>
                prev.map((item) =>
                  item.sku === 'SKU-WHEY-2LB' ? { ...item, sellPriceUsd: result.finalPrice } : item
                )
              );
              updateStep(tool, {
                status: 'MUTATED',
                detail: `New price calculated in VM: $${result.finalPrice} USD`,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('SSE Stream Error:', err);
    } finally {
      setIsRunning(false);
      setTimeout(() => {
        setIsFrozen(false);
        if (videoRef.current && cameraActive) videoRef.current.play();
      }, 4000);
    }
  };

  return (
    <div className="h-screen w-screen bg-[#090A0F] text-slate-200 flex flex-col select-none">
      <header className="h-14 border-b border-slate-800 bg-[#0D1017] px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-bold tracking-widest text-sm text-white">KINETIX OS</span>
          <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
            SPATIAL ERP v2026.1
          </span>
        </div>

        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400">Glimmer Edge PII:</span>
            <span className="text-emerald-400 font-bold">{telemetry.glimmerMs || '--'}ms</span>
          </div>
          <div className="flex items-center gap-2">
            <Scan className="w-4 h-4 text-cyan-400" />
            <span className="text-slate-400">SAM 3.1 Lock:</span>
            <span className="text-cyan-400 font-bold">{telemetry.samMs || '--'}ms</span>
          </div>
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amber-400" />
            <span className="text-slate-400">Spark DAG:</span>
            <span className="text-amber-400 font-bold">{telemetry.sparkMs || '--'}ms</span>
          </div>
          <div className="px-3 py-1 rounded bg-emerald-950/60 border border-emerald-800/80 text-emerald-300">
            Cloud Offload Saved: <strong>{telemetry.tokensSavedPct || 68}%</strong>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        <section className="col-span-5 flex flex-col gap-3 border border-slate-800 bg-[#0D1017] rounded-lg p-3 relative">
          <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/80 pb-2">
            <span className="flex items-center gap-2 font-semibold text-slate-200">
              <Camera className="w-4 h-4 text-cyan-400" /> WORKSPACE SPATIAL FEED (SAM 3.1)
            </span>
            <span className={isFrozen ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
              {isFrozen ? '● FRAME LOCKED (SEGMENTING)' : '● LIVE 60FPS'}
            </span>
          </div>

          <div className="relative flex-1 bg-[#050608] rounded border border-slate-800 overflow-hidden flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover opacity-85"
            />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 text-xs gap-2">
                <span>[ SIMULATED WORKSPACE COUNTERTOP ]</span>
                <span className="text-[11px] text-slate-500">4 Physical Objects Ready in Scene</span>
              </div>
            )}

            {masks.map((mask) => {
              const [x, y, w, h] = mask.bbox;
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
                    style={style}
                    className="absolute backdrop-blur-xl bg-slate-900/70 border-2 border-dashed border-emerald-400 rounded flex flex-col items-center justify-center p-2 transition-all duration-300"
                  >
                    <ShieldAlert className="w-5 h-5 text-emerald-400 mb-1" />
                    <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/90 px-1.5 py-0.5 rounded">
                      [PII REDACTED AT EDGE]
                    </span>
                  </div>
                );
              }

              const colorMap = {
                LEFT: 'border-rose-500 bg-rose-500/20 text-rose-300',
                CENTER: 'border-emerald-400 bg-emerald-400/20 text-emerald-200',
                RIGHT: 'border-cyan-400 bg-cyan-400/20 text-cyan-200',
                BOTTOM_PII: '',
              };

              const labelMap = {
                LEFT: 'QUARANTINE_DEFECT',
                CENTER: 'STOCK_INBOUND (+12)',
                RIGHT: 'NEW_CATALOG_SYNTH',
                BOTTOM_PII: 'PII',
              };

              return (
                <div
                  key={mask.id}
                  style={style}
                  className={`absolute border-2 rounded transition-all duration-300 ${colorMap[mask.zone]}`}
                >
                  <div className="bg-slate-950/90 text-[10px] font-bold px-1.5 py-0.5 inline-block border-b border-r border-current">
                    {mask.zone} :: {labelMap[mask.zone]} ({Math.round(mask.confidence * 100)}%)
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-[#090A0F] border border-slate-800 rounded p-3 flex flex-col gap-2">
            <div className="text-[11px] text-slate-400 leading-relaxed">
              <span className="text-cyan-400 font-bold">VOICE TRANSCRIBE: </span>
              "El envase de la izquierda vino roto, abrí reclamo. Sumá el pote del centro al stock, armá foto de estudio para el nuevo de la derecha y recalculá precios con 30% de margen."
            </div>
            <button
              onClick={triggerOrchestration}
              disabled={isRunning}
              className="w-full py-2.5 rounded bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 text-slate-950 font-bold text-xs tracking-wider flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              {isRunning ? 'EXECUTING SPATIAL DAG...' : 'TRIGGER GOLDEN PATH (SPACEBAR / CLICK)'}
            </button>
          </div>
        </section>

        <section className="col-span-3 border border-slate-800 bg-[#0D1017] rounded-lg p-3 flex flex-col">
          <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amber-400" /> AGENT EXECUTION DAG (SSE)
          </div>

          <div className="flex-1 relative pl-4 border-l-2 border-slate-800 space-y-3 overflow-y-auto">
            {steps.map((step) => {
              const badgeColors = {
                PENDING: 'border-slate-800 bg-[#090A0F] text-slate-500',
                RUNNING: 'border-cyan-400 bg-cyan-950/40 text-cyan-200 animate-pulse',
                MUTATED: 'border-emerald-500/60 bg-emerald-950/20 text-emerald-300',
              };

              return (
                <div
                  key={step.id}
                  className={`p-2.5 rounded border text-xs transition-all ${badgeColors[step.status]}`}
                >
                  <div className="flex items-center justify-between font-bold mb-1">
                    <span>{step.title}</span>
                    {step.status === 'MUTATED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <div className="text-[10px] text-slate-400 flex justify-between">
                    <span>{step.model}</span>
                    {step.latencyMs && <span className="text-cyan-400">{step.latencyMs}ms</span>}
                  </div>
                  {step.detail && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 text-[11px] text-white">
                      {step.detail}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="col-span-4 flex flex-col gap-3 overflow-y-auto">
          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-400" /> LIVE INVENTORY STATE
            </div>
            <div className="space-y-2">
              {inventory.map((item) => (
                <div
                  key={item.sku}
                  className="bg-[#090A0F] border border-slate-800 p-2 rounded flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-white">{item.name}</div>
                    <div className="text-[10px] text-slate-500">{item.sku}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold">{item.stock} units</div>
                    <div className="text-[11px] text-cyan-300">${item.sellPriceUsd.toFixed(2)} USD</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" /> SUPPLIER CLAIM & QUARANTINE
            </div>
            {latestClaim ? (
              <div className="bg-rose-950/20 border border-rose-500/50 rounded p-2.5 text-xs space-y-1">
                <div className="flex justify-between font-bold text-rose-300">
                  <span>TICKET #{latestClaim.id}</span>
                  <span>-${latestClaim.amountUsd.toFixed(2)} USD</span>
                </div>
                <div className="text-[11px] text-slate-300">{latestClaim.reason}</div>
                <div className="text-[10px] text-amber-400 font-semibold pt-1">
                  ⚠ ZERO-TRUST GUARDRAIL: Waiting Verbal Confirmation (&gt;$100)
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-600 py-3 text-center">No active defect claims</div>
            )}
          </div>

          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" /> MUSE IMAGE STUDIO CATALOG
            </div>
            {latestCatalog ? (
              <div className="bg-cyan-950/20 border border-cyan-500/40 rounded p-2.5 text-xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                    {latestCatalog.status}
                  </span>
                  <div className="font-bold text-white mt-1">{latestCatalog.title}</div>
                  <div className="text-[10px] text-slate-400">Synthesized from RIGHT mask crop</div>
                </div>
                <div className="h-12 w-12 rounded bg-gradient-to-br from-cyan-500/30 to-slate-900 border border-cyan-400 flex items-center justify-center text-[9px] text-cyan-200 font-bold text-center p-1">
                  8K STUDIO RENDER
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-600 py-3 text-center">Awaiting new product mask...</div>
            )}
          </div>

          <div className="border border-slate-800 bg-[#0D1017] rounded-lg p-3 flex-1">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2 mb-2 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-amber-400" /> MUSE CODE FINANCIAL SANDBOX (node:vm)
            </div>
            {vmExecution ? (
              <pre className="bg-[#050608] border border-slate-800 p-2 rounded text-[10px] text-emerald-300 overflow-x-auto">
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
