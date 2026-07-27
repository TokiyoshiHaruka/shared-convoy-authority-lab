import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol";

describe("client protocol validation", () => {
  it("accepts a bounded command with an explicit role and sequence", () => {
    const message = parseClientMessage(JSON.stringify({
      type: "command",
      commandId: "lead-1",
      clientSequence: 1,
      role: "lead",
      action: { type: "move", distance: 1 },
    }));

    expect(message).toMatchObject({ type: "command", commandId: "lead-1", role: "lead" });
  });

  it("rejects unknown messages, negative values, and client-owned state fields", () => {
    expect(() => parseClientMessage(JSON.stringify({ type: "snapshot", state: {} }))).toThrow("unsupported-message");
    expect(() => parseClientMessage(JSON.stringify({
      type: "command", commandId: "bad", clientSequence: 1, role: "lead", action: { type: "move", distance: -1 },
    }))).toThrow("invalid-command");
    expect(() => parseClientMessage(JSON.stringify({
      type: "command", commandId: "bad", clientSequence: 1, role: "lead", state: { credits: 999 }, action: { type: "scan" },
    }))).toThrow("invalid-command");
    expect(() => parseClientMessage(JSON.stringify({
      type: "command", commandId: "huge", clientSequence: Number.MAX_SAFE_INTEGER + 2, role: "lead", action: { type: "move", distance: 1 },
    }))).toThrow("invalid-command");
  });
});
