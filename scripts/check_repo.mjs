import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const failures = [];
const generatedPrefixes = ["node_modules/", "dist/", "evidence/", "test-results/", "playwright-report/", "coverage/"];
const secretPatterns = [
  /BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
];
const absoluteLocalPath = /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/](?!\\)/m;
const unsafeHtml = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML)\b/;
const endpointPattern = /\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+)(?::\d+)?/gi;
let scanned = 0;

for (const path of files) {
  const name = basename(path);
  if (generatedPrefixes.some((prefix) => path.startsWith(prefix)) || name === ".env" || name.startsWith(".env.")) {
    failures.push(`tracked-generated-or-env:${path}`);
    continue;
  }
  if (/\.(?:key|p12|pem|pfx)$/i.test(name)) failures.push(`tracked-key-material:${path}`);
  if ((await stat(join(root, path))).size > 1_000_000) continue;
  const text = await readFile(join(root, path), "utf8");
  scanned += 1;
  for (const pattern of secretPatterns) if (pattern.test(text)) failures.push(`possible-secret:${path}`);
  if (path !== "scripts/check_repo.mjs" && absoluteLocalPath.test(text)) failures.push(`absolute-local-path:${path}`);
  if (path.startsWith("src/") && unsafeHtml.test(text)) failures.push(`unsafe-html-sink:${path}`);
  if (path.startsWith("src/") || path === "index.html") {
    for (const match of text.matchAll(endpointPattern)) {
      if (match[1] !== "127.0.0.1" && match[1] !== "localhost") failures.push(`hard-coded-public-endpoint:${path}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`repository hygiene: OK (${scanned} text files scanned)`);
