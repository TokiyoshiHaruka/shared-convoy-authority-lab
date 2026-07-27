import { describe, expect, it } from "vitest";
import { createFaultTransport, type TransportMessage } from "../src/transport";

describe("deterministic fault transport", () => {
  it("delivers duplicates according to a seeded profile", async () => {
    const delivered: TransportMessage[] = [];
    const transport = createFaultTransport({
      seed: 7,
      profile: { latencyMs: 0, jitterMs: 0, dropRate: 0, duplicateRate: 1, reorderRate: 0 },
      deliver: (message) => { delivered.push(message); },
    });
    await transport.send({ id: "m-1", payload: "snapshot" });
    expect(delivered.map((message) => message.id)).toEqual(["m-1", "m-1"]);
    expect(transport.metrics.duplicated).toBe(1);
    expect(transport.metrics.delivered).toBe(2);
  });

  it("keeps dropped messages out of delivery while counting them", async () => {
    const delivered: TransportMessage[] = [];
    const transport = createFaultTransport({
      seed: 1,
      profile: { latencyMs: 0, jitterMs: 0, dropRate: 1, duplicateRate: 0, reorderRate: 0 },
      deliver: (message) => { delivered.push(message); },
    });
    await transport.send({ id: "m-2", payload: "snapshot" });
    expect(delivered).toEqual([]);
    expect(transport.metrics.dropped).toBe(1);
  });

  it("releases adjacent messages in the opposite order when reordering is forced", async () => {
    const delivered: TransportMessage[] = [];
    const transport = createFaultTransport({
      seed: 11,
      profile: { latencyMs: 0, jitterMs: 0, dropRate: 0, duplicateRate: 0, reorderRate: 1 },
      deliver: (message) => { delivered.push(message); },
    });
    const first = transport.send({ id: "m-1", payload: "first" });
    const second = transport.send({ id: "m-2", payload: "second" });
    await Promise.all([first, second]);
    expect(delivered.map((message) => message.id)).toEqual(["m-2", "m-1"]);
    expect(transport.metrics.reordered).toBe(1);
  });
});
