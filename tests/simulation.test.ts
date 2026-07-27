import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createRoom,
  hashRoom,
  setRoleConnected,
  type RoomState,
} from "../src/simulation";

describe("createRoom", () => {
  it("creates a fresh server-owned convoy room", () => {
    const room = createRoom("room-alpha");

    expect(room.roomId).toBe("room-alpha");
    expect(room.schemaVersion).toBe(1);
    expect(room.serverTick).toBe(0);
    expect(room.snapshotSequence).toBe(0);
    expect(room.convoy).toEqual({
      position: 0,
      cargoUnits: 100,
      hullIntegrity: 100,
      credits: 0,
      objectiveProgress: 0,
    });
    expect(room.connectedRoles).toEqual({ lead: false, escort: false });
  });
});

describe("authoritative command application", () => {
  const room = (): RoomState => createRoom("room-alpha");

  it("moves only through a lead command and advances tick and snapshot", () => {
    const result = applyCommand(room(), {
      type: "command",
      commandId: "lead-1",
      clientSequence: 1,
      role: "lead",
      action: { type: "move", distance: 2 },
    });

    expect(result.accepted).toBe(true);
    expect(result.state.convoy.position).toBe(2);
    expect(result.state.serverTick).toBe(1);
    expect(result.state.snapshotSequence).toBe(1);
  });

  it("rejects an escort command sent by the lead role without changing state", () => {
    const initial = room();
    const result = applyCommand(initial, {
      type: "command",
      commandId: "wrong-role",
      clientSequence: 1,
      role: "lead",
      action: { type: "scan" },
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("role-not-authorized");
    expect(result.state).toEqual(initial);
  });

  it("is idempotent for duplicate command IDs", () => {
    const first = applyCommand(room(), {
      type: "command",
      commandId: "cargo-1",
      clientSequence: 1,
      role: "escort",
      action: { type: "transfer", units: 10 },
    });
    const duplicate = applyCommand(first.state, {
      type: "command",
      commandId: "cargo-1",
      clientSequence: 2,
      role: "escort",
      action: { type: "transfer", units: 10 },
    });

    expect(first.accepted).toBe(true);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.reason).toBe("duplicate-command");
    expect(duplicate.state).toEqual(first.state);
  });

  it("produces a stable hash for equivalent authoritative states", () => {
    const first = createRoom("room-alpha");
    const second = createRoom("room-alpha");
    expect(hashRoom(first)).toBe(hashRoom(second));
  });

  it("includes role ownership and sequence cursors in the receipt hash", () => {
    const first = createRoom("room-alpha");
    const second = createRoom("room-alpha");
    second.connectedRoles.lead = true;
    second.lastClientSequences.lead = 1;
    expect(hashRoom(first)).not.toBe(hashRoom(second));
  });

  it("versions public role presence without exposing reconnect credentials", () => {
    const connected = setRoleConnected(createRoom("room-alpha"), "lead", true);
    expect(connected.connectedRoles.lead).toBe(true);
    expect(connected.serverTick).toBe(1);
    expect(connected.snapshotSequence).toBe(1);
  });

  it("resets a role sequence when a new session lease is issued", () => {
    const progressed = applyCommand(createRoom("room-alpha"), {
      type: "command", commandId: "lead-9", clientSequence: 9, role: "lead", action: { type: "move", distance: 1 },
    }).state;
    const leased = setRoleConnected(progressed, "lead", true, true);
    expect(leased.lastClientSequences.lead).toBe(0);
    expect(leased.connectedRoles.lead).toBe(true);
  });
});
