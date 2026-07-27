import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { encodeMessage, parseClientMessage, type ClientCommand, type Role } from "./protocol";
import { applyCommand, createRoom, hashRoom, setRoleConnected, type RoomState } from "./simulation";

type SnapshotMessage = { type: "snapshot"; state: RoomState; serverTick: number; snapshotSequence: number; ackedCommandIds: string[]; stateHash: string };
type RejectMessage = { type: "reject"; commandId: string; reason: string };
type WelcomeMessage = { type: "welcome"; sessionToken: string; role: Role | "observer"; roomId: string };
export type ServerMessage = SnapshotMessage | RejectMessage | WelcomeMessage;

interface Connection {
  socket: WebSocket;
  token: string;
  role: Role | "observer";
  roomId: string;
}

interface Room {
  state: RoomState;
  connections: Map<string, Connection>;
  tokens: Map<string, { role: Role; expiresAt: number | null }>;
}

const RECONNECT_GRACE_MS = 30_000;

export interface ClientHarness {
  messages: ServerMessage[];
  sessionToken: string;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface ServerHarness {
  port: number;
  connectClient(roomId: string, role: Role | "observer", token?: string): Promise<ClientHarness>;
  getRoom(roomId: string): RoomState;
  close(): Promise<void>;
}

function sendSnapshot(room: Room, connection: Connection, ackedCommandIds: string[] = []): void {
  const message: SnapshotMessage = {
    type: "snapshot",
    state: room.state,
    serverTick: room.state.serverTick,
    snapshotSequence: room.state.snapshotSequence,
    ackedCommandIds,
    stateHash: hashRoom(room.state),
  };
  connection.socket.send(encodeMessage(message));
}

function broadcast(room: Room, message: ServerMessage): void {
  for (const connection of room.connections.values()) {
    if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(encodeMessage(message));
  }
}

function broadcastSnapshot(room: Room, ackedCommandIds: string[] = []): void {
  broadcast(room, {
    type: "snapshot",
    state: room.state,
    serverTick: room.state.serverTick,
    snapshotSequence: room.state.snapshotSequence,
    ackedCommandIds,
    stateHash: hashRoom(room.state),
  });
}

function purgeExpiredTokens(room: Room): void {
  const now = Date.now();
  for (const [token, session] of room.tokens) {
    if (session.expiresAt !== null && session.expiresAt <= now) room.tokens.delete(token);
  }
}

function assignRole(room: Room, role: Role | "observer", requestedToken?: string): { role: Role | "observer"; token: string } {
  purgeExpiredTokens(room);
  if (requestedToken) {
    const session = room.tokens.get(requestedToken);
    if (session) {
      session.expiresAt = null;
      return { role: session.role, token: requestedToken };
    }
  }
  if (role === "observer") return { role, token: randomUUID() };
  const reserved = [...room.tokens.values()].some((session) => session.role === role);
  if (reserved) return { role: "observer", token: randomUUID() };
  const token = randomUUID();
  room.tokens.set(token, { role, expiresAt: null });
  return { role, token };
}

function safeCommandId(raw: string): string {
  try {
    const value = JSON.parse(raw) as { commandId?: unknown };
    return typeof value?.commandId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value.commandId) ? value.commandId : "unknown";
  } catch {
    return "unknown";
  }
}

function handleMessage(room: Room, connection: Connection, raw: RawData): void {
  if (room.connections.get(connection.token)?.socket !== connection.socket) {
    connection.socket.close(4001, "session-replaced");
    return;
  }
  const serialized = raw.toString();
  let command: ClientCommand;
  try {
    command = parseClientMessage(serialized);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid-command";
    connection.socket.send(encodeMessage({ type: "reject", commandId: safeCommandId(serialized), reason } satisfies RejectMessage));
    return;
  }
  if (connection.role === "observer" || command.role !== connection.role) {
    connection.socket.send(encodeMessage({ type: "reject", commandId: command.commandId, reason: "role-not-authorized" } satisfies RejectMessage));
    return;
  }
  const result = applyCommand(room.state, command);
  if (!result.accepted) {
    connection.socket.send(encodeMessage({ type: "reject", commandId: command.commandId, reason: result.reason ?? "rejected" } satisfies RejectMessage));
    return;
  }
  room.state = result.state;
  broadcastSnapshot(room, [command.commandId]);
}

export async function createServerHarness(options: { port: number }): Promise<ServerHarness> {
  const http: HttpServer = createServer((_, response) => {
    response.writeHead(404).end();
  });
  const websocket = new WebSocketServer({ server: http });
  const rooms = new Map<string, Room>();
  websocket.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const roomId = url.searchParams.get("room") ?? "room-alpha";
    const roleParam = url.searchParams.get("role");
    const requestedRole: Role | "observer" = roleParam === "lead" || roleParam === "escort" || roleParam === "observer" ? roleParam : "observer";
    const requestedToken = url.searchParams.get("token") ?? undefined;
    const room: Room = rooms.get(roomId) ?? { state: createRoom(roomId), connections: new Map(), tokens: new Map() };
    rooms.set(roomId, room);
    const assigned = assignRole(room, requestedRole, requestedToken);
    const connection: Connection = { socket, token: assigned.token, role: assigned.role, roomId };
    const previous = room.connections.get(assigned.token);
    if (previous && previous.socket !== socket) previous.socket.close(4001, "session-replaced");
    room.connections.set(assigned.token, connection);
    socket.send(encodeMessage({ type: "welcome", sessionToken: assigned.token, role: assigned.role, roomId } satisfies WelcomeMessage));
    if (assigned.role === "observer") {
      sendSnapshot(room, connection);
    } else {
      const nextState = setRoleConnected(room.state, assigned.role, true);
      if (nextState === room.state) sendSnapshot(room, connection);
      else {
        room.state = nextState;
        broadcastSnapshot(room);
      }
    }
    socket.on("message", (raw) => handleMessage(room, connection, raw));
    socket.on("close", () => {
      if (room.connections.get(assigned.token)?.socket !== socket) return;
      room.connections.delete(assigned.token);
      if (assigned.role === "observer") return;
      const session = room.tokens.get(assigned.token);
      if (session) session.expiresAt = Date.now() + RECONNECT_GRACE_MS;
      const nextState = setRoleConnected(room.state, assigned.role, false);
      if (nextState !== room.state) {
        room.state = nextState;
        broadcastSnapshot(room);
      }
    });
  });
  await new Promise<void>((resolve) => http.listen(options.port, "127.0.0.1", resolve));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    port,
    connectClient(roomId, role, token) {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/?room=${encodeURIComponent(roomId)}&role=${role}${token ? `&token=${encodeURIComponent(token)}` : ""}`);
        const messages: ServerMessage[] = [];
        let sessionToken = "";
        socket.on("message", (raw) => {
          const message = JSON.parse(raw.toString()) as ServerMessage;
          messages.push(message);
          if (message.type === "welcome") {
            sessionToken = message.sessionToken;
            resolve({
              messages,
              sessionToken,
              send: (payload) => new Promise<void>((sendResolve, sendReject) => {
                const commandId = typeof payload === "object" && payload !== null && "commandId" in payload ? String(payload.commandId) : undefined;
                if (socket.readyState !== WebSocket.OPEN) {
                  sendReject(new Error("socket-not-open"));
                  return;
                }
                let settled = false;
                const finish = (error?: Error) => {
                  if (settled) return;
                  settled = true;
                  socket.off("message", onMessage);
                  socket.off("close", onClose);
                  socket.off("error", onError);
                  clearTimeout(timeout);
                  if (error) sendReject(error); else sendResolve();
                };
                const onMessage = (raw: RawData) => {
                  if (!commandId) return;
                  const message = JSON.parse(raw.toString()) as ServerMessage;
                  if ((message.type === "reject" && message.commandId === commandId) || (message.type === "snapshot" && message.ackedCommandIds.includes(commandId))) {
                    finish();
                  }
                };
                const onClose = () => finish(new Error("socket-closed-before-ack"));
                const onError = () => finish(new Error("socket-error-before-ack"));
                const timeout = setTimeout(() => finish(new Error("command-ack-timeout")), 2000);
                socket.on("message", onMessage);
                socket.once("close", onClose);
                socket.once("error", onError);
                socket.send(encodeMessage(payload), (error) => {
                  if (error) finish(error);
                });
              }),
              close: () => new Promise<void>((closeResolve) => { socket.once("close", () => closeResolve()); socket.close(); }),
            });
          }
        });
        socket.once("error", reject);
      });
    },
    getRoom(roomId) {
      const room = rooms.get(roomId);
      if (!room) throw new Error(`unknown room ${roomId}`);
      return room.state;
    },
    close() {
      for (const room of rooms.values()) for (const connection of room.connections.values()) connection.socket.close();
      return new Promise<void>((resolve) => websocket.close(() => http.close(() => resolve())));
    },
  };
}

if (process.argv[1]?.endsWith("server.ts")) {
  createServerHarness({ port: Number(process.env.PORT ?? 8787) }).then(({ port }) => console.log(`convoy server listening on 127.0.0.1:${port}`));
}
