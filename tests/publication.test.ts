import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

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

  it("records the current public release state in the documentation", async () => {
    const verification = await text("docs/VERIFICATION.md");
    expect(verification).toContain("PASS: 29 tests (7 server-focused tests)");
    expect(verification).toContain("The public `Verification` workflow");
    expect(verification).not.toContain("No public CI run is claimed");

    const aiUsage = await text("AI_USAGE.md");
    expect(aiUsage).toContain("The v0.1.0 public release was made");
    expect(aiUsage).not.toContain("A public release still requires");
  });

  it("runs the complete verification matrix in a read-only GitHub Actions job", async () => {
    const workflow = await text(".github/workflows/ci.yml");
    for (const fragment of [
      "permissions:",
      "contents: read",
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

  it("pins every official GitHub Action to an auditable release commit", async () => {
    const workflow = await text(".github/workflows/ci.yml");
    const officialActionLines = workflow
      .split(/\r?\n/)
      .filter((line) => /^\s*-\s+uses:\s+actions\//.test(line));
    expect(officialActionLines.length).toBeGreaterThan(0);
    for (const line of officialActionLines) {
      expect(line).toMatch(
        /^\s*-\s+uses:\s+actions\/[^\s@]+@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+\s*$/,
      );
    }
    for (const action of [
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
    ]) {
      expect(workflow).toContain(action);
    }
  });

  it("schedules monthly Dependabot checks for GitHub Actions", async () => {
    const configPath = ".github/dependabot.yml";
    expect(existsSync(resolve(root, configPath))).toBe(true);
    expect(parse(await text(configPath))).toEqual({
      version: 2,
      updates: [
        {
          "package-ecosystem": "github-actions",
          directory: "/",
          schedule: { interval: "monthly" },
        },
      ],
    });
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
    expect(mobile.width).toBe(390);
    expect(mobile.height).toBeGreaterThanOrEqual(844);
  });

  it("checks tracked binary media without decoding it as source text", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/check_repo.mjs"], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
