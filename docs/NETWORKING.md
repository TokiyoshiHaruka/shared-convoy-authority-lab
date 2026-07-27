# Networking Notes

## Client command

```json
{
  "type": "command",
  "commandId": "cmd-example-1",
  "clientSequence": 1,
  "role": "lead",
  "action": { "type": "move", "distance": 1 }
}
```

The parser accepts only known tags, roles, bounded integers, safe sequence values, and command IDs matching a restricted character set. A client-supplied `state` field is rejected.

Lead can `move` or `confirm`; Escort can `scan` or `transfer`. Wrong-role, stale, duplicate, malformed, and invalid-state commands return a correlated `reject` message.

## Snapshot

Each accepted command produces a full snapshot containing:

- authoritative `RoomState`;
- `serverTick` and `snapshotSequence`;
- command IDs acknowledged by that transition;
- a deterministic state hash.

Full snapshots are intentional for this small prototype. They make late join and reconnect easy to inspect. A production service would likely use bounded histories, deltas, and persistence.

## Idempotency and ordering

`processedCommandIds` prevents duplicate application. `lastClientSequences` rejects an older command within the same role lease. The reconnect token preserves that lease; an expired lease resets the role cursor before a new player starts at sequence 1.

The browser drops snapshots older than its last applied `snapshotSequence`. On every full snapshot it reconciles pending commands against both `ackedCommandIds` and the authoritative processed-command ledger. This covers the case where the server applied a command but its original ACK snapshot was lost.

## Reconnect behavior

1. The client detects close and records recovery start time.
2. It reconnects with its private token.
3. The server replaces any stale socket for that token.
4. The server sends a current full snapshot.
5. The client reconciles pending commands, advances its local sequence cursor, applies the snapshot, and records recovery milliseconds.

Tokens never appear in public room state or the state hash.

## Fault injection

The same tested transport wrapper is used for browser inbound and outbound paths. A seeded linear-congruential generator drives:

- latency up to 500 ms;
- jitter up to 250 ms;
- drop and duplicate rates from 0 to 1;
- actual adjacent-message reordering through a held-message queue.

Counters separate outbound `sent` and inbound `received`, then aggregate delivered, dropped, duplicated, and reordered events. Faults surround the WebSocket path and do not change simulation rules.

## Known limitations

- in-memory rooms disappear when the server exits;
- reconnect leases are local timers, not durable sessions;
- full ledgers and snapshots are not bandwidth bounded;
- there is no authentication beyond the local bearer token;
- fault injection is deterministic laboratory evidence, not an Internet model.
