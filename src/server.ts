import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { encodeMessage, parseClientMessage, type ClientCommand, type Role } from "./protocol";
import { applyCommand, createRoom, hashRoom, type RoomState } from "./simulation";

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
  tokens: Map<string, Role | "observer">;
}

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

function assignRole(room: Room, role: Role | "observer", requestedToken?: string): { role: Role | "observer"; token: string } {
  if (requestedToken && room.tokens.has(requestedToken)) return { role: room.tokens.get(requestedToken)!, token: requestedToken };
  if (role === "observer") return { role, token: randomUUID() };
  const occupied = room.state.connectedRoles[role];
  if (occupied) return { role: "observer", token: randomUUID() };
  const token = randomUUID();
  room.tokens.set(token, role);
  room.state = { ...room.state, connectedRoles: { ...room.state.connectedRoles, [role]: token } };
  return { role, token };
}

function handleMessage(room: Room, connection: Connection, raw: RawData): void {
  let command: ClientCommand;
  try {
    command = parseClientMessage(raw.toString());
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid-command";
    connection.socket.send(encodeMessage({ type: "reject", commandId: "unknown", reason } satisfies RejectMessage));
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
  broadcast(room, {
    type: "snapshot",
    state: room.state,
    serverTick: room.state.serverTick,
    snapshotSequence: room.state.snapshotSequence,
    ackedCommandIds: [command.commandId],
    stateHash: hashRoom(room.state),
  });
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
    const requestedRole = url.searchParams.get("role") as Role | "observer" | null;
    const requestedToken = url.searchParams.get("token") ?? undefined;
    const room = rooms.get(roomId) ?? { state: createRoom(roomId), connections: new Map(), tokens: new Map() };
    rooms.set(roomId, room);
    const assigned = assignRole(room, requestedRole === "escort" || requestedRole === "observer" ? requestedRole : "lead", requestedToken);
    const connection: Connection = { socket, token: assigned.token, role: assigned.role, roomId };
    room.connections.set(assigned.token, connection);
    socket.send(encodeMessage({ type: "welcome", sessionToken: assigned.token, role: assigned.role, roomId } satisfies WelcomeMessage));
    sendSnapshot(room, connection);
    socket.on("message", (raw) => handleMessage(room, connection, raw));
  socket.on("close", () => {
    if (room.connections.get(assigned.token)?.socket === socket) room.connections.delete(assigned.token);
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
                const onMessage = (raw: RawData) => {
                  if (!commandId) return;
                  const message = JSON.parse(raw.toString()) as ServerMessage;
                  if ((message.type === "reject" && message.commandId === commandId) || (message.type === "snapshot" && message.ackedCommandIds.includes(commandId))) {
                    socket.off("message", onMessage);
                    sendResolve();
                  }
                };
                socket.on("message", onMessage);
                socket.send(encodeMessage(payload), (error) => {
                  if (error) {
                    socket.off("message", onMessage);
                    sendReject(error);
                  }
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
