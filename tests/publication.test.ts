import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

async function text(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

async function pngDimensions(path: string): Promise<{ width: number; height: number }> {
  const content = await readFile(resolve(root, path));
  expect(content.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  return {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
  };
}

describe("publication surface", () => {
  it("shows generated gameplay evidence in the Japanese-first README", async () => {
    const readme = await text("README.md");
    expect(readme.indexOf("docs/media/desktop-convoy.png")).toBeGreaterThan(0);
    expect(readme.indexOf("docs/media/desktop-convoy.png")).toBeLessThan(
      readme.indexOf("## 検証する仮説"),
    );
  });

  it("records the actual AI tool and the complete human verification boundary", async () => {
    const aiUsage = await text("AI_USAGE.md");
    expect(aiUsage).toContain("OpenAI Codex");
    for (const command of [
      "npm test",
      "npm run test:server",
      "npm run build",
      "npm run check",
      "npm run test:browser",
    ]) {
      expect(aiUsage).toContain(command);
    }
  });

  it("runs the complete verification matrix in a read-only GitHub Actions job", async () => {
    const workflow = await text(".github/workflows/ci.yml");
    for (const fragment of [
      "permissions:",
      "contents: read",
      "actions/checkout@v6",
      "actions/setup-node@v6",
      "node-version: 22",
      "npm ci",
      "npm run check",
      "npm test",
      "npm run build",
      "npx playwright install --with-deps chromium",
      "npm run test:browser",
    ]) {
      expect(workflow).toContain(fragment);
    }
  });

  it("pins the supported Node.js major used by clean checkout and CI", async () => {
    const packageJson = JSON.parse(await text("package.json"));
    expect(packageJson.engines).toEqual({ node: "22.x", npm: "10.x" });
  });

  it("tracks inspectable desktop and mobile PNG captures", async () => {
    const desktop = await pngDimensions("docs/media/desktop-convoy.png");
    const mobile = await pngDimensions("docs/media/mobile-late-join.png");
    expect(desktop.width).toBeGreaterThanOrEqual(1200);
    expect(desktop.height).toBeGreaterThanOrEqual(700);
    expect(mobile).toEqual({ width: 390, height: 844 });
  });
});
