export type MaskStatus =
  | 'IDLE_OBSERVED'
  | 'IDLE'
  | 'QUARANTINED'
  | 'STOCK_MUTATED'
  | 'CATALOG_SYNTH'
  | 'PII_REDACTED';

export interface SpatialMask {
  id: string;
  label?: string;
  bbox: [number, number, number, number];
  zone?: string;
  spatialRegion2D?: string;
  assignedActionStatus?: MaskStatus;
  isSensitivePII: boolean;
  confidence: number;
  cropBase64?: string;
}

export interface InventoryItem {
  sku: string;
  name: string;
  stock: number;
  sellPriceUsd?: number;
  _highlightDelta?: string;
  _repriced?: boolean;
}

export interface ExecutionStep {
  id: string;
  title: string;
  model: string;
  status: 'PENDING' | 'RUNNING' | 'MUTATED' | 'FAILED';
  detail?: string;
  latencyMs?: number;
}

export interface TelemetryState {
  glimmerMs: number;
  samMs: number;
  sparkMs: number;
  segmenter: string;
  tokensSavedPct: number;
  piiRedacted: number;
}

export interface SupplierClaim {
  id: string;
  amountUsd: number;
  reason: string;
  guardrailStatus: 'HELD_WAITING_VOICE_AUTH' | 'AUTHORIZED_AND_DISPATCHED' | 'AUTO_APPROVED';
  thresholdUsd?: number;
  cropBase64?: string;
  dispatchChannel?: string;
  mongoId?: string;
  maskId?: string;
}

export interface VisualDna {
  containerGeometry: string;
  exactColorPalette: string;
  detectedBrandOrText: string;
  surfaceMaterial: string;
}

export interface StudioCatalogResult {
  title: string;
  sourceCropUrl: string;
  studioImageUrl: string;
  synthesisLatencyMs?: number;
  visualDna?: VisualDna;
}

export interface VmExecutionResult {
  finalPrice: number;
  executedCode: string;
  usedFallback: boolean;
  updatedSku?: string;
}

export type ToolMutationPayload =
  | { tool: 'quarantine_and_claim'; targetMaskId?: string; result: SupplierClaim & { maskId?: string } }
  | {
      tool: 'mutate_inventory';
      targetMaskId?: string;
      result: {
        sku: string;
        name?: string;
        stock: number;
        previousStock?: number;
        delta?: number;
        sellPriceUsd?: number;
        maskId?: string;
      };
    }
  | { tool: 'generate_studio_catalog'; targetMaskId?: string; result: StudioCatalogResult & { maskId?: string } }
  | { tool: 'recalculate_margins_vm'; targetMaskId?: string; result: VmExecutionResult & { maskId?: string } };

export type KinetixSseEvent =
  | { event: 'VISION_SCAN_STARTED'; data: Record<string, unknown> }
  | { event: 'EDGE_PII_SHIELD'; data: { redactedMasks?: SpatialMask[]; latencyMs?: number } }
  | {
      event: 'SPATIAL_LOCK';
      data: {
        objects?: SpatialMask[];
        samUsed?: boolean;
        samLatencyMs?: number;
        samRefined?: number;
        latencyMs?: number;
        sparkLatencyMs?: number;
      };
    }
  | { event: 'SPARK_REASONING_TRACE'; data: { reasoning?: string } }
  | { event: 'SPARK_PLAN_LOCKED'; data: { latencyMs?: number; plan?: { summary?: string } } }
  | { event: 'TOOL_MUTATED'; data: ToolMutationPayload }
  | { event: 'ORCHESTRATION_COMPLETE'; data: { storeState?: { inventory?: InventoryItem[] } } };
