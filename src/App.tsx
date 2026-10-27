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

const DEFAULT_PROMPT =
  'El envase de la izquierda vino roto, abrí reclamo. Sumá el pote del centro al stock, armá foto de estudio para el nuevo de la derecha y recalculá precios con 30% de margen.';

const INITIAL_STEPS: ExecutionStep[] = [
  { id: 'edge_pii', title: 'Edge Cognitive Filter & PII Redaction', model: 'Muse Glimmer 30B', status: 'PENDING' },
  { id: 'sam_lock', title: 'Spatial Instance Segmentation', model: 'SAM 3.1 (Baseten)', status: 'PENDING' },
  { id: 'spark_plan', title: 'Multi-Tool DAG Reasoning', model: 'Muse Spark', status: 'PENDING' },
  { id: 'quarantine_and_claim', title: 'Tool: Quarantine & Supplier Claim', model: 'Action Engine', status: 'PENDING' },
  { id: 'mutate_inventory', title: 'Tool: Inventory SKU Mutation', model: 'Action Engine', status: 'PENDING' },
  { id: 'generate_studio_catalog', title: 'Tool: E-Commerce Studio Synthesis', model: 'Muse Image', status: 'PENDING' },
  { id: 'recalculate_margins_vm', title: 'Tool: Financial Margin Sandbox', model: 'Muse Code (node:vm)', status: 'PENDING' },
];

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
  const [inventory, setInventory] = useState([
    { sku: 'SKU-SHAKER-V2', name: 'Titan Pro Shaker 700ml', stock: 45, sellPriceUsd: 21.0 },
    { sku: 'SKU-WHEY-2LB', name: 'IsoWhey Gold 2Lb Tub', stock: 18, sellPriceUsd: 62.0 },
  ]);
  const [latestClaim, setLatestClaim] = useState<any>(null);
  const [latestCatalog, setLatestCatalog] = useState<any>(null);
  const [vmExecution, setVmExecution] = useState<any>(null);
  const [voiceText, setVoiceText] = useState(DEFAULT_PROMPT);
  const [reasoningTrace, setReasoningTrace] = useState('');

  // ... rest of the component truncated for brevity in this call - full version is local
}
