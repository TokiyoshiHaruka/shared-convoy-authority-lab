import { encodeMessage, type ClientCommand, type CommandAction, type Role } from "./protocol";
import type { RoomState } from "./simulation";
import {
  DEFAULT_FAULT_PROFILE,
  clampFaultProfile,
  createFaultTransport,
  createTransportMetrics,
  type FaultProfile,
  type FaultTransport,
  type TransportMetrics,
} from "./transport";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

export interface SnapshotMessage {
  type: "snapshot";
  state: RoomState;
  serverTick: number;
  snapshotSequence: number;
  ackedCommandIds: string[];
  stateHash: string;
}

export interface WelcomeMessage {
  type: "welcome";
  sessionToken: string;
  role: Role | "observer";
  roomId: string;
}

export interface RejectMessage {
  type: "reject";
  commandId: string;
  reason: string;
}

export type ClientWireMessage = SnapshotMessage | WelcomeMessage | RejectMessage;

export interface ClientMetrics {
  status: ConnectionStatus;
  requestedRole: Role;
  assignedRole: Role | "observer" | null;
  roomId: string;
  sessionToken: string;
  serverTick: number;
  snapshotSequence: number;
  roundTripMs: number | null;
  pendingCommands: number;
  ackedCommands: number;
  rejectedCommands: number;
  recoveryMs: number | null;
  stateHash: string;
  lastRejectReason: string | null;
  faultProfile: FaultProfile;
  transport: TransportMetrics;
}

export interface ConvoyClientOptions {
  endpoint: string;
  roomId: string;
  role: Role;
  token?: string;
  faultProfile?: Partial<FaultProfile>;
  onMessage?: (message: ClientWireMessage) => void;
  onMetrics?: (metrics: ClientMetrics) => void;
  onState?: (state: RoomState) => void;
}

interface PendingCommand {
  sentAt: number;
  action: CommandAction;
}

function isWireMessage(value: unknown): value is ClientWireMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === "welcome" || type === "snapshot" || type === "reject";
}

function randomId(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${suffix}`.slice(0, 80);
}

export class ConvoyClient {
  private readonly options: ConvoyClientOptions;
  private socket: WebSocket | null = null;
  private sequence = 0;
  private lastCommand: ClientCommand | null = null;
  private pending = new Map<string, PendingCommand>();
  private reconnectStartedAt: number | null = null;
  private reconnectTimer: number | null = null;
  private autoReconnect = true;
  private lastAppliedSnapshotSequence = -1;
  private incomingMessageSequence = 0;
  private readonly outgoingTransport: FaultTransport;
  private readonly incomingTransport: FaultTransport;
  private metrics: ClientMetrics;

  public constructor(options: ConvoyClientOptions) {
    this.options = options;
    this.metrics = {
      status: "idle",
      requestedRole: options.role,
      assignedRole: null,
      roomId: options.roomId,
      sessionToken: options.token ?? "",
      serverTick: 0,
      snapshotSequence: 0,
      roundTripMs: null,
      pendingCommands: 0,
      ackedCommands: 0,
      rejectedCommands: 0,
      recoveryMs: null,
      stateHash: "--------",
      lastRejectReason: null,
      faultProfile: clampFaultProfile(options.faultProfile ?? DEFAULT_FAULT_PROFILE),
      transport: createTransportMetrics(),
    };
    this.outgoingTransport = createFaultTransport({
      seed: 0x4f1bbcdc,
      profile: this.metrics.faultProfile,
      deliver: (message) => {
        if (typeof message.payload !== "string" || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
        this.socket.send(message.payload);
        return true;
      },
    });
    this.incomingTransport = createFaultTransport({
      seed: 0x7b13d24a,
      profile: this.metrics.faultProfile,
      deliver: (message) => {
        this.handleRawMessage(message.payload);
        return true;
      },
    });
  }

  public getMetrics(): ClientMetrics {
    return {
      ...this.metrics,
      faultProfile: { ...this.metrics.faultProfile },
      transport: { ...this.metrics.transport },
    };
  }

  public getLastCommand(): ClientCommand | null {
    return this.lastCommand;
  }

  public setRequestedRole(role: Role): boolean {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return false;
    if (role !== this.options.role) {
      this.options.role = role;
      this.sequence = 0;
      this.lastCommand = null;
      this.pending.clear();
      this.metrics.sessionToken = "";
      this.metrics.assignedRole = null;
    }
    this.metrics.requestedRole = role;
    this.emitMetrics();
    return true;
  }

  public connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.autoReconnect = true;
    this.clearReconnectTimer();
    const isRecovery = this.reconnectStartedAt !== null;
    this.setStatus(isRecovery ? "reconnecting" : "connecting");
    const url = new URL(this.options.endpoint);
    url.searchParams.set("room", this.options.roomId);
    url.searchParams.set("role", this.options.role);
    if (this.metrics.sessionToken) url.searchParams.set("token", this.metrics.sessionToken);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.setStatus("connected");
    });
    socket.addEventListener("message", (event) => {
      void this.receiveWithFault(event.data);
    });
    socket.addEventListener("error", () => undefined);
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.autoReconnect) {
        this.reconnectStartedAt ??= Date.now();
        this.setStatus("reconnecting");
        this.scheduleReconnect();
      } else {
        this.setStatus("offline");
      }
    });
  }

  public disconnect(): void {
    this.autoReconnect = false;
    this.clearReconnectTimer();
    this.reconnectStartedAt = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, "client-request");
    this.setStatus("offline");
  }

  public reconnect(): void {
    this.autoReconnect = true;
    this.clearReconnectTimer();
    this.reconnectStartedAt = Date.now();
    if (this.socket) this.socket.close();
    this.socket = null;
    this.connect();
  }

  public setFaultProfile(profile: Partial<FaultProfile>): void {
    this.metrics.faultProfile = clampFaultProfile({ ...this.metrics.faultProfile, ...profile });
    this.outgoingTransport.setProfile(this.metrics.faultProfile);
    this.incomingTransport.setProfile(this.metrics.faultProfile);
    this.emitMetrics();
  }

  public sendAction(action: CommandAction, commandId = randomId("cmd")): string | null {
    const assignedRole = this.metrics.assignedRole;
    if (!assignedRole || assignedRole === "observer") return null;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return null;
    const command: ClientCommand = {
      type: "command",
      commandId,
      clientSequence: ++this.sequence,
      role: assignedRole,
      action,
    };
    this.lastCommand = command;
    this.pending.set(command.commandId, { sentAt: Date.now(), action });
    this.emitMetrics();
    void this.outgoingTransport.send({ id: command.commandId, payload: encodeMessage(command) }).then(() => this.emitMetrics());
    return command.commandId;
  }

  public resendLastCommand(): string | null {
    if (!this.lastCommand || !this.socket || this.socket.readyState !== WebSocket.OPEN) return null;
    void this.outgoingTransport.send({ id: this.lastCommand.commandId, payload: encodeMessage(this.lastCommand) }).then(() => this.emitMetrics());
    return this.lastCommand.commandId;
  }

  private async receiveWithFault(raw: unknown): Promise<void> {
    const payload = raw instanceof Blob ? await raw.text() : raw;
    await this.incomingTransport.send({ id: `server-${++this.incomingMessageSequence}`, payload });
    this.emitMetrics();
  }

  private handleRawMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    if (!isWireMessage(parsed)) return;
    this.options.onMessage?.(parsed);
    if (parsed.type === "welcome") {
      this.metrics.assignedRole = parsed.role;
      this.metrics.roomId = parsed.roomId;
      this.metrics.sessionToken = parsed.sessionToken;
      this.emitMetrics();
      return;
    }
    if (parsed.type === "reject") {
      const pending = this.pending.get(parsed.commandId);
      if (pending) {
        this.metrics.roundTripMs = Date.now() - pending.sentAt;
        this.pending.delete(parsed.commandId);
      }
      this.metrics.rejectedCommands += 1;
      this.metrics.lastRejectReason = parsed.reason;
      this.emitMetrics();
      return;
    }
    this.applySnapshot(parsed);
  }

  private applySnapshot(snapshot: SnapshotMessage): void {
    const acknowledged = new Set([...snapshot.ackedCommandIds, ...snapshot.state.processedCommandIds]);
    for (const commandId of acknowledged) {
      const pending = this.pending.get(commandId);
      if (pending) {
        this.metrics.roundTripMs = Date.now() - pending.sentAt;
        this.pending.delete(commandId);
        this.metrics.ackedCommands += 1;
      }
    }
    if (snapshot.snapshotSequence < this.lastAppliedSnapshotSequence) {
      this.emitMetrics();
      return;
    }
    this.lastAppliedSnapshotSequence = snapshot.snapshotSequence;
    this.metrics.serverTick = snapshot.serverTick;
    this.metrics.snapshotSequence = snapshot.snapshotSequence;
    this.metrics.stateHash = snapshot.stateHash;
    if (this.metrics.assignedRole && this.metrics.assignedRole !== "observer") {
      this.sequence = Math.max(this.sequence, snapshot.state.lastClientSequences[this.metrics.assignedRole]);
    }
    if (this.reconnectStartedAt !== null) {
      this.metrics.recoveryMs = Date.now() - this.reconnectStartedAt;
      this.reconnectStartedAt = null;
    }
    this.options.onState?.(snapshot.state);
    this.emitMetrics();
  }

  private setStatus(status: ConnectionStatus): void {
    this.metrics.status = status;
    this.emitMetrics();
  }

  private emitMetrics(): void {
    const outbound = this.outgoingTransport.metrics;
    const inbound = this.incomingTransport.metrics;
    this.metrics.transport = {
      sent: outbound.sent,
      received: inbound.sent,
      delivered: outbound.delivered + inbound.delivered,
      dropped: outbound.dropped + inbound.dropped,
      duplicated: outbound.duplicated + inbound.duplicated,
      reordered: outbound.reordered + inbound.reordered,
    };
    this.metrics.pendingCommands = this.pending.size;
    this.options.onMetrics?.(this.getMetrics());
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || !this.autoReconnect) return;
    this.reconnectStartedAt ??= Date.now();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

}
