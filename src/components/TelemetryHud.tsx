import React from 'react';
import { ShieldAlert, Scan, Cpu } from 'lucide-react';
import { TelemetryState } from '../core/types';

export const TelemetryHud = ({ telemetry }: { telemetry: TelemetryState }) => (
  <div className="flex items-center gap-4 text-[10px] uppercase tracking-wider font-semibold">
    <div className="flex items-center gap-1.5 bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
      <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
      <span className="text-slate-400">PII gated:</span>
      <span className="text-emerald-400">{telemetry.piiRedacted}</span>
    </div>
    <div className="flex items-center gap-1.5 bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
      <Scan className="w-3.5 h-3.5 text-cyan-400" />
      <span className="text-slate-400">{telemetry.segmenter}:</span>
      <span className="text-cyan-400">{telemetry.samMs ? `${telemetry.samMs}ms` : '--'}</span>
    </div>
    <div className="flex items-center gap-1.5 bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
      <Cpu className="w-3.5 h-3.5 text-amber-400" />
      <span className="text-slate-400">Spark Open (Baseten):</span>
      <span className="text-amber-400">{telemetry.sparkMs ? `${telemetry.sparkMs}ms` : '--'}</span>
    </div>
  </div>
);
