# AI Usage

## Tool and scope

OpenAI Codex was used as an agent during this prototype for:

- design exploration and scope reduction;
- implementation drafts for the protocol, server, client, HUD, and tests;
- test-case enumeration for authority, idempotency, reconnect, and transport faults;
- adversarial review of credential boundaries, recovery behavior, and claim evidence;
- documentation drafts and repository presentation.

This project does not claim that the retained source was written without AI assistance.

## Review and verification

Retained changes were checked by separate review passes and by executable evidence. The complete local verification boundary is:

```bash
npm test
npm run test:server
npm run build
npm run check
npm run test:browser
```

The browser scenario verifies semantic game state, a nonblank WebGL frame, deterministic snapshot loss and recovery, duplicate rejection, reconnect followed by a new command, and mobile late join. Automated checks demonstrate the recorded behavior; they do not replace product judgment or prove production-network readiness.

## Responsibility boundary

The repository owner defined the portfolio direction, target role, gameplay interests, and publication constraints. The owner remains responsible for the public scope, source review, security boundary, licensing, and final interview claims. A public release still requires the repository publication gate and explicit GitHub authentication.

No credentials, private service data, proprietary game content, or third-party game assets were supplied to OpenAI Codex for this project.
