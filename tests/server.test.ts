import { describe, expect, it } from "vitest";
import { createServerHarness, type ServerHarness } from "../src/server";

describe("authoritative convoy server", () => {
  let harness: ServerHarness;

  it("assigns roles and sends a full snapshot to a late joiner", async () => {
    harness = await createServerHarness({ port: 0 });
    const lead = await harness.connectClient("room-alpha", "lead");
    const escort = await harness.connectClient("room-alpha", "escort");
    await lead.send({ type: "command", commandId: "move-1", clientSequence: 1, role: "lead", action: { type: "move", distance: 2 } });
    await escort.send({ type: "command", commandId: "scan-1", clientSequence: 1, role: "escort", action: { type: "scan" } });

    const late = await harness.connectClient("room-alpha", "observer");
    expect(late.messages.some((message) => message.type === "snapshot" && message.state.convoy.position === 2)).toBe(true);
    expect(late.messages.some((message) => message.type === "snapshot" && message.state.convoy.objectiveProgress === 2)).toBe(true);
    await harness.close();
  });

  it("rejects duplicate commands without duplicating credits or progress", async () => {
    harness = await createServerHarness({ port: 0 });
    const escort = await harness.connectClient("room-bravo", "escort");
    const command = { type: "command" as const, commandId: "transfer-1", clientSequence: 1, role: "escort" as const, action: { type: "transfer" as const, units: 10 } };
    await escort.send(command);
    await escort.send(command);

    const state = harness.getRoom("room-bravo");
    expect(state.convoy.credits).toBe(20);
    expect(state.convoy.cargoUnits).toBe(90);
    expect(escort.messages.some((message) => message.type === "reject" && message.reason === "duplicate-command")).toBe(true);
    await harness.close();
  });

  it("reconnects a role with a token and keeps the room state", async () => {
    harness = await createServerHarness({ port: 0 });
    const lead = await harness.connectClient("room-charlie", "lead");
    const token = lead.sessionToken;
    await lead.send({ type: "command", commandId: "move-1", clientSequence: 1, role: "lead", action: { type: "move", distance: 1 } });
    await lead.close();

    const reconnected = await harness.connectClient("room-charlie", "lead", token);
    expect(reconnected.messages.some((message) => message.type === "snapshot" && message.state.convoy.position === 1)).toBe(true);
    expect(harness.getRoom("room-charlie").connectedRoles.lead).toBe(reconnected.sessionToken);
    await harness.close();
  });
});
