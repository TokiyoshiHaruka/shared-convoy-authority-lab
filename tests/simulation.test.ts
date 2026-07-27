import { describe, expect, it } from "vitest";
import { createRoom } from "../src/simulation";

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
    expect(room.connectedRoles).toEqual({ lead: null, escort: null });
  });
});
