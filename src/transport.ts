export interface FaultProfile {
  latencyMs: number;
  jitterMs: number;
  dropRate: number;
  duplicateRate: number;
  reorderRate: number;
}

export interface TransportMetrics {
  sent: number;
  received: number;
  delivered: number;
  dropped: number;
  duplicated: number;
  reordered: number;
}

export interface TransportMessage {
  id: string;
  payload: unknown;
}

export interface FaultTransport {
  metrics: TransportMetrics;
  send(message: TransportMessage): Promise<void>;
  setProfile(profile: Partial<FaultProfile>): void;
}

export const DEFAULT_FAULT_PROFILE: FaultProfile = {
  latencyMs: 0,
  jitterMs: 0,
  dropRate: 0,
  duplicateRate: 0,
  reorderRate: 0,
};

export function createTransportMetrics(): TransportMetrics {
  return { sent: 0, received: 0, delivered: 0, dropped: 0, duplicated: 0, reordered: 0 };
}

export function clampFaultProfile(profile: Partial<FaultProfile>): FaultProfile {
  const finite = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? value as number : fallback;
  return {
    latencyMs: Math.min(500, Math.max(0, Math.round(finite(profile.latencyMs, 0)))),
    jitterMs: Math.min(250, Math.max(0, Math.round(finite(profile.jitterMs, 0)))),
    dropRate: Math.min(1, Math.max(0, finite(profile.dropRate, 0))),
    duplicateRate: Math.min(1, Math.max(0, finite(profile.duplicateRate, 0))),
    reorderRate: Math.min(1, Math.max(0, finite(profile.reorderRate, 0))),
  };
}

function createRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

export function createFaultTransport(options: {
  seed: number;
  profile?: Partial<FaultProfile>;
  metrics?: TransportMetrics;
  deliver: (message: TransportMessage) => boolean | void;
}): FaultTransport {
  let profile = clampFaultProfile(options.profile ?? DEFAULT_FAULT_PROFILE);
  const metrics = options.metrics ?? createTransportMetrics();
  const random = createRng(options.seed);
  const delay = (message: TransportMessage): Promise<void> => new Promise((resolve) => {
    const jitter = profile.jitterMs === 0 ? 0 : Math.round((random() * 2 - 1) * profile.jitterMs);
    setTimeout(() => {
      if (options.deliver(message) === false) metrics.dropped += 1;
      else metrics.delivered += 1;
      resolve();
    }, Math.max(0, profile.latencyMs + jitter));
  });
  const deliverCopies = async (message: TransportMessage, copies: number): Promise<void> => {
    for (let copy = 0; copy < copies; copy += 1) await delay(message);
  };
  let held: { message: TransportMessage; copies: number; resolve: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  return {
    metrics,
    setProfile(nextProfile) {
      profile = clampFaultProfile({ ...profile, ...nextProfile });
    },
    send(message) {
      metrics.sent += 1;
      if (random() < profile.dropRate) {
        metrics.dropped += 1;
        return Promise.resolve();
      }
      const copies = random() < profile.duplicateRate ? 2 : 1;
      if (copies === 2) metrics.duplicated += 1;
      if (held) {
        const prior = held;
        held = null;
        clearTimeout(prior.timer);
        metrics.reordered += 1;
        const pair = deliverCopies(message, copies).then(() => deliverCopies(prior.message, prior.copies));
        void pair.then(prior.resolve);
        return pair;
      }
      if (profile.reorderRate > 0 && random() < profile.reorderRate) {
        return new Promise<void>((resolve) => {
          const pending = {
            message,
            copies,
            resolve,
            timer: setTimeout(() => {
              if (held !== pending) return;
              held = null;
              void deliverCopies(message, copies).then(resolve);
            }, Math.max(20, profile.latencyMs + profile.jitterMs + 10)),
          };
          held = pending;
        });
      }
      return deliverCopies(message, copies);
    },
  };
}
