export interface FaultProfile {
  latencyMs: number;
  jitterMs: number;
  dropRate: number;
  duplicateRate: number;
  reorderRate: number;
}

export interface TransportMetrics {
  sent: number;
  delivered: number;
  dropped: number;
  duplicated: number;
  reordered: number;
}

export const DEFAULT_FAULT_PROFILE: FaultProfile = {
  latencyMs: 0,
  jitterMs: 0,
  dropRate: 0,
  duplicateRate: 0,
  reorderRate: 0,
};

export function createTransportMetrics(): TransportMetrics {
  return { sent: 0, delivered: 0, dropped: 0, duplicated: 0, reordered: 0 };
}

export function clampFaultProfile(profile: Partial<FaultProfile>): FaultProfile {
  return {
    latencyMs: Math.min(500, Math.max(0, Math.round(profile.latencyMs ?? 0))),
    jitterMs: Math.min(250, Math.max(0, Math.round(profile.jitterMs ?? 0))),
    dropRate: Math.min(1, Math.max(0, profile.dropRate ?? 0)),
    duplicateRate: Math.min(1, Math.max(0, profile.duplicateRate ?? 0)),
    reorderRate: Math.min(1, Math.max(0, profile.reorderRate ?? 0)),
  };
}
