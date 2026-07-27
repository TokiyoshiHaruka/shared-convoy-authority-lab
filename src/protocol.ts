export type Role = "lead" | "escort";

export type CommandAction =
  | { type: "move"; distance: number }
  | { type: "confirm" }
  | { type: "scan" }
  | { type: "transfer"; units: number };

export interface ClientCommand {
  type: "command";
  commandId: string;
  clientSequence: number;
  role: Role;
  action: CommandAction;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

export function parseClientMessage(input: string): ClientCommand {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("invalid-json");
  }
  if (!isRecord(value) || value.type !== "command") throw new Error("unsupported-message");
  if ("state" in value || typeof value.commandId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.commandId)) {
    throw new Error("invalid-command");
  }
  if (!isInteger(value.clientSequence) || value.clientSequence < 1 || (value.role !== "lead" && value.role !== "escort")) {
    throw new Error("invalid-command");
  }
  if (!isRecord(value.action) || typeof value.action.type !== "string") throw new Error("invalid-command");
  let action: CommandAction;
  if (value.action.type === "move" && isInteger(value.action.distance) && value.action.distance >= 1 && value.action.distance <= 3) {
    action = { type: "move", distance: value.action.distance };
  } else if (value.action.type === "confirm") {
    action = { type: "confirm" };
  } else if (value.action.type === "scan") {
    action = { type: "scan" };
  } else if (value.action.type === "transfer" && isInteger(value.action.units) && value.action.units >= 1 && value.action.units <= 20) {
    action = { type: "transfer", units: value.action.units };
  } else {
    throw new Error("invalid-command");
  }
  return {
    type: "command",
    commandId: value.commandId,
    clientSequence: value.clientSequence,
    role: value.role,
    action,
  };
}

export function encodeMessage(message: unknown): string {
  return JSON.stringify(message);
}
