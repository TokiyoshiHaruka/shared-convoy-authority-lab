# Shared Convoy Authority Lab

2 つのブラウザクライアントが、遅延やパケットロスのある環境でも 1 つのサーバー権威状態へ収束できるかを検証する、3-5 分のオンラインゲーム・プロトタイプです。

Lead は船団を前進させ、Escort は索敵と貨物移送を担当します。クライアントは command だけを提案し、位置・貨物・進行度・報酬を確定できるのは Node.js WebSocket サーバーだけです。

## 検証する仮説

- 役割別 command をサーバー側で検証できる
- duplicate command を 1 回だけ適用できる
- late join が完全な snapshot を取得できる
- reconnect token を公開 snapshot に漏らさず、30 秒の lease 内で役割を復元できる
- `150 ms latency / 5% drop` 下でも client が server tick・snapshot sequence・state hash へ収束できる

## ローカル起動

```bash
npm install
npm run server
```

別のターミナルで:

```bash
npm run dev
```

別々のブラウザプロファイルで次を開きます。

- Lead: `http://127.0.0.1:4173/?room=demo&role=lead`
- Escort: `http://127.0.0.1:4173/?room=demo&role=escort`

同じ role が既に使用中の場合は Observer として参加します。画面上の fault profile で latency、jitter、drop、duplicate、reorder を変更できます。

## 技術的な証拠

| 項目 | 実装 |
| --- | --- |
| Authority | Node.js + `ws` room server |
| Protocol | tagged JSON command / welcome / snapshot / reject |
| Idempotency | room 単位の `commandId` ledger |
| Ordering | role ごとの safe integer sequence |
| Recovery | private reconnect token、lease、full snapshot reconciliation |
| Fault injection | seeded latency / jitter / drop / duplicate / real pair reordering |
| Visualization | Phaser 3 route renderer + DOM observability HUD |
| Evidence | Vitest integration tests + two-context Playwright scenario |

詳細は [Architecture](docs/ARCHITECTURE.md)、[Networking](docs/NETWORKING.md)、[Verification](docs/VERIFICATION.md) を参照してください。

## 検証コマンド

```bash
npm test
npm run test:server
npm run build
npm run check
npm run test:browser
```

Playwright は `evidence/browser/` に desktop / mobile screenshot と JSON receipt を生成します。このディレクトリはローカル検証用で Git には含めません。

## 境界

これは production networking stack ではありません。matchmaking、authentication、database、public hosting、長期 session persistence は対象外です。ローカル fault injection は再現可能な設計比較のためのもので、実ネットワーク品質の予測を主張しません。

AI 利用範囲と人間の責任分界は [AI Usage](AI_USAGE.md) に記録しています。
