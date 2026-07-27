# Verification

Last verified: 2026-07-28

## Acceptance matrix

| Check | Result | Evidence |
| --- | --- | --- |
| Protocol and simulation | PASS | role rules, safe sequence, idempotency, stable full-state hash |
| Server integration | PASS | join, late join, correlated reject, reconnect, token isolation, lease expiry |
| Fault transport | PASS | drop, duplicate, actual adjacent reorder |
| Unit/integration suite | PASS: 20 tests | `npm test` |
| Server suite | PASS: 7 tests | `npm run test:server` |
| TypeScript and production build | PASS | `npm run build` |
| Repository hygiene | PASS | `npm run check` |
| Browser acceptance | PASS: 1 scenario | `npm run test:browser` |

## Browser scenario

Playwright starts one local server and Vite, then opens independent Lead and Escort browser contexts in one room. It verifies:

1. both clients converge to one tick, sequence, and state hash;
2. Escort runs under `150 ms latency / 5% drop` during role commands;
3. Lead movement and Escort scan/transfer are server-confirmed;
4. resending the same command is rejected without changing the receipt;
5. Lead disconnects and recovers with its private token;
6. a 390 x 844 late client joins as Observer and receives the current snapshot;
7. all three clients end with the same receipt and no browser console errors.

The run writes ignored local evidence to `evidence/browser/`:

- `desktop-convoy.png`
- `mobile-late-join.png`
- `convoy-browser-receipt.json`

## Reproduce

```bash
npm install
npm test
npm run test:server
npm run build
npm run check
npm run test:browser
```

If Chromium is not installed, set `PLAYWRIGHT_BROWSERS_PATH` to a writable cache and run `npx playwright install chromium` once.

## Residual risk

The production JavaScript bundle is about 1.5 MB because Phaser is included as one chunk. That is acceptable for this local feasibility prototype; code splitting is deferred unless the concept advances. No external player study or real wide-area network measurement has been completed.
