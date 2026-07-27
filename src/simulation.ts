import type { ClientCommand, CommandAction, Role } from "./protocol";

export interface ConvoyState {
  position: number;
  cargoUnits: number;
  hullIntegrity: number;
  credits: number;
  objectiveProgress: number;
}

export interface RoomState {
  roomId: string;
  schemaVersion: number;
  serverTick: number;
  snapshotSequence: number;
  convoy: ConvoyState;
  connectedRoles: Record<Role, string | null>;
  processedCommandIds: string[];
  lastClientSequences: Record<Role, number>;
}

export interface CommandResult {
  accepted: boolean;
  state: RoomState;
  reason?: "duplicate-command" | "stale-sequence" | "role-not-authorized" | "invalid-state";
  commandId: string;
}

const POSITION_TARGET = 10;
const OBJECTIVE_TARGET = 10;

export function createRoom(roomId: string): RoomState {
  return {
    roomId,
    schemaVersion: 1,
    serverTick: 0,
    snapshotSequence: 0,
    convoy: {
      position: 0,
      cargoUnits: 100,
      hullIntegrity: 100,
      credits: 0,
      objectiveProgress: 0,
    },
    connectedRoles: { lead: null, escort: null },
    processedCommandIds: [],
    lastClientSequences: { lead: 0, escort: 0 },
  };
}

function isAuthorized(role: Role, action: CommandAction): boolean {
  return role === "lead" ? action.type === "move" || action.type === "confirm" : action.type === "scan" || action.type === "transfer";
}

export function isObjectiveComplete(state: RoomState): boolean {
  return state.convoy.position >= POSITION_TARGET && state.convoy.objectiveProgress >= OBJECTIVE_TARGET;
}

export function applyCommand(state: RoomState, command: ClientCommand): CommandResult {
  if (state.processedCommandIds.includes(command.commandId)) {
    return { accepted: false, state, reason: "duplicate-command", commandId: command.commandId };
  }
  if (command.clientSequence <= state.lastClientSequences[command.role]) {
    return { accepted: false, state, reason: "stale-sequence", commandId: command.commandId };
  }
  if (!isAuthorized(command.role, command.action)) {
    return { accepted: false, state, reason: "role-not-authorized", commandId: command.commandId };
  }

  const convoy = { ...state.convoy };
  if (command.action.type === "move") {
    convoy.position = Math.min(POSITION_TARGET, convoy.position + command.action.distance);
  } else if (command.action.type === "confirm") {
    if (convoy.position < POSITION_TARGET) return { accepted: false, state, reason: "invalid-state", commandId: command.commandId };
    convoy.objectiveProgress = OBJECTIVE_TARGET;
  } else if (command.action.type === "scan") {
    convoy.objectiveProgress = Math.min(OBJECTIVE_TARGET, convoy.objectiveProgress + 2);
  } else if (command.action.type === "transfer") {
    const units = Math.min(command.action.units, convoy.cargoUnits);
    convoy.cargoUnits -= units;
    convoy.credits += units * 2;
    convoy.objectiveProgress = Math.min(OBJECTIVE_TARGET, convoy.objectiveProgress + Math.ceil(units / 5));
  }

  const next: RoomState = {
    ...state,
    serverTick: state.serverTick + 1,
    snapshotSequence: state.snapshotSequence + 1,
    convoy,
    processedCommandIds: [...state.processedCommandIds, command.commandId],
    lastClientSequences: { ...state.lastClientSequences, [command.role]: command.clientSequence },
  };
  return { accepted: true, state: next, commandId: command.commandId };
}

export function hashRoom(state: RoomState): string {
  const canonical = JSON.stringify({
    roomId: state.roomId,
    schemaVersion: state.schemaVersion,
    serverTick: state.serverTick,
    snapshotSequence: state.snapshotSequence,
    convoy: state.convoy,
    processedCommandIds: [...state.processedCommandIds].sort(),
  });
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
