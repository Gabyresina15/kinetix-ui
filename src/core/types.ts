// --- 1. MÁQUINA DE ESTADOS FINITA (FSM) Y ESTADOS DEL DAG ---
export type OrchestrationPhase =
  | 'LIVE_IDLE'
  | 'SCANNING_SCENE'
  | 'EXECUTING_DAG'
  | 'FRAME_LOCKED'
  | 'ABORTED'
  | 'FAULT';

export type DagNodeId =
  | 'edge_pii'
  | 'sam_lock'
  | 'spark_plan'
  | 'quarantine_and_claim'
  | 'mutate_inventory'
  | 'generate_studio_catalog'
  | 'recalculate_margins_vm';

export type DagNodeStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'MUTATED'
  | 'HELD_GUARDRAIL'
  | 'FAILED'
  | 'ABORTED'
  | 'SKIPPED';

export type MaskStatus =
  | 'IDLE_OBSERVED'
  | 'QUARANTINED'
  | 'STOCK_MUTATED'
  | 'CATALOG_SYNTH'
  | 'PII_REDACTED';

// --- 2. CONTRATO ESPACIAL Y ENTIDADES ERP ---
export interface SpatialMask {
  id: string;
  label: string;
  bbox: [number, number, number, number]; // [xMin, yMin, width, height] en rango [0..1]
  centroid?: [number, number];
  spatialRegion2D?: string;
  assignedActionStatus: MaskStatus;
  isSensitivePII: boolean;
  confidence: number;
  cropBase64?: string;
}

export interface InventoryItem {
  sku: string;
  name: string;
  stock: number;
  standardInboundLot?: number;
  baseCostUsd: number;
  sellPriceUsd: number;
  _highlightDelta?: string;
  _repriced?: boolean;
}

export interface SupplierClaim {
  id: string;
  mongoId?: string;
  maskId: string;
  objectLabel: string;
  reason: string;
  amountUsd: number;
  thresholdUsd: number;
  cropBase64?: string;
  guardrailStatus: 'HELD_WAITING_VOICE_AUTH' | 'AUTHORIZED_AND_DISPATCHED' | 'AUTO_APPROVED';
  dispatchChannel?: string;
  externalReceiptId?: string;
  timestamp: string;
}

export interface VisualDna {
  containerGeometry: string;
  exactColorPalette: string;
  detectedBrandOrText: string;
  surfaceMaterial: string;
}

export interface StudioCatalogResult {
  id: string;
  mongoId?: string;
  maskId: string;
  title: string;
  visualDna: VisualDna;
  promptUsed: string;
  sourceCropUrl: string;
  studioImageUrl: string;
  usedLiveApi: boolean;
  synthesisLatencyMs: number;
}

export interface VmExecutionResult {
  finalPrice: number;
  executedCode: string; // Unificado entre orchestratorCore.ts y el Frontend
  usedFallback: boolean;
  updatedSku: string;
  targetMarginPercent: number;
  taxRatePercent: number;
}

export interface InventoryMutationResult extends InventoryItem {
  previousStock: number;
  delta: number;
  mongoId: string;
  maskId: string;
}

// --- 3. UNIÓN DISCRIMINADA DE HERRAMIENTAS Y STREAM SSE ---
export type ToolMutationPayload =
  | { tool: 'quarantine_and_claim'; targetMaskId: string; status: DagNodeStatus; latencyMs: number; result: SupplierClaim }
  | { tool: 'mutate_inventory'; targetMaskId: string; status: DagNodeStatus; latencyMs: number; result: InventoryMutationResult }
  | { tool: 'generate_studio_catalog'; targetMaskId: string; status: DagNodeStatus; latencyMs: number; result: StudioCatalogResult }
  | { tool: 'recalculate_margins_vm'; targetMaskId?: string; status: DagNodeStatus; latencyMs: number; result: VmExecutionResult };

export type KinetixSseEvent =
  | { event: 'VISION_SCAN_STARTED'; data: { model: string; timestamp: number } }
  | { event: 'EDGE_PII_SHIELD'; data: { model: string; latencyMs: number; redactedMasks: Array<{ id: string; bbox: [number, number, number, number] }> } }
  | {
      event: 'SPATIAL_LOCK';
      data: {
        model: string;
        latencyMs: number;
        sparkLatencyMs: number;
        samUsed: boolean;
        samLatencyMs: number;
        samRefined: number;
        objects: SpatialMask[];
      };
    }
  | { event: 'SPARK_REASONING_TRACE'; data: { model: string; reasoning: string } }
  | { event: 'SPARK_PLAN_LOCKED'; data: { model: string; latencyMs: number; plan: { summary: string; requestedTools: DagNodeId[] } } }
  | { event: 'TOOL_MUTATED'; data: ToolMutationPayload }
  | { event: 'TOOL_FAILED'; data: { tool: DagNodeId; targetMaskId?: string; error: string; latencyMs: number } }
  | { event: 'ORCHESTRATION_COMPLETE'; data: { totalElapsedMs: number; storeState: { inventory: InventoryItem[] } } }
  | { event: 'ORCHESTRATION_ERROR'; data: { message: string } };