import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "playwright/test";

interface SyncReceipt {
  serverTick: number;
  snapshotSequence: number;
  stateHash: string;
}

interface ConvoyReceipt {
  position: number;
  cargo: number;
  credits: number;
  objective: number;
}

const evidenceDir = resolve(process.cwd(), "evidence", "browser");

async function metric(page: Page, testId: string): Promise<string> {
  return (await page.getByTestId(testId).textContent())?.trim() ?? "";
}

async function readSync(page: Page): Promise<SyncReceipt> {
  const [tick, sequence, stateHash] = await Promise.all([
    metric(page, "server-tick"),
    metric(page, "snapshot-sequence"),
    metric(page, "state-hash"),
  ]);
  return {
    serverTick: Number(tick),
    snapshotSequence: Number(sequence),
    stateHash,
  };
}

async function waitForRole(page: Page, role: "LEAD" | "ESCORT" | "OBSERVER"): Promise<void> {
  await expect(page.getByTestId("connection-status")).toHaveText("CONNECTED");
  await expect(page.getByTestId("assigned-role")).toHaveText(`ROLE ${role}`);
  await expect(page.getByTestId("state-hash")).not.toHaveText("--------");
  await expect(page.getByTestId("convoy-playfield").locator("canvas")).toBeVisible();
}

async function waitForConvergence(pages: Page[], previousHash?: string): Promise<SyncReceipt> {
  await expect.poll(async () => {
    const receipts = await Promise.all(pages.map(readSync));
    const [first] = receipts;
    return receipts.every((receipt) =>
      receipt.stateHash === first.stateHash
      && receipt.snapshotSequence === first.snapshotSequence
      && receipt.serverTick === first.serverTick
      && receipt.stateHash !== "--------"
      && receipt.stateHash !== previousHash,
    );
  }).toBe(true);
  return readSync(pages[0]);
}

async function waitForChange(page: Page, previousHash: string): Promise<SyncReceipt> {
  await expect.poll(() => metric(page, "state-hash")).not.toBe(previousHash);
  return readSync(page);
}

async function readConvoy(page: Page): Promise<ConvoyReceipt> {
  const playfield = page.getByTestId("convoy-playfield");
  const [position, cargo, credits, objective] = await Promise.all([
    playfield.getAttribute("data-position"),
    playfield.getAttribute("data-cargo"),
    playfield.getAttribute("data-credits"),
    playfield.getAttribute("data-objective"),
  ]);
  return { position: Number(position), cargo: Number(cargo), credits: Number(credits), objective: Number(objective) };
}

async function expectNonblankCanvas(page: Page): Promise<void> {
  const stats = await page.getByTestId("convoy-playfield").locator("canvas").evaluate(async (canvas: HTMLCanvasElement) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { opaque: 0, colors: 0 };
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const colors = new Set<string>();
    let opaque = 0;
    for (let index = 0; index < pixels.length; index += 64) {
      if (pixels[index + 3] > 0) opaque += 1;
      colors.add(`${pixels[index]}-${pixels[index + 1]}-${pixels[index + 2]}`);
    }
    return { opaque, colors: colors.size };
  });
  expect(stats.opaque).toBeGreaterThan(100);
  expect(stats.colors).toBeGreaterThan(4);
}

async function droppedCount(page: Page): Promise<number> {
  const summary = await metric(page, "transport-metrics");
  return Number(/dropped (\d+)/.exec(summary)?.[1] ?? 0);
}

async function setFault(page: Page, key: "latencyMs" | "dropRate", value: number): Promise<void> {
  const input = page.getByTestId(`fault-${key}`);
  await input.evaluate((element, nextValue) => {
    const slider = element as HTMLInputElement;
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await expect(input).toHaveValue(String(value));
}

function watchBrowserErrors(page: Page, errors: string[]): void {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

test("two clients converge through authoritative actions, duplicate rejection, reconnect, and late join", async ({ browser, baseURL }) => {
  const roomId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const acceptanceFaultProfile = { latencyMs: 150, dropRate: 0.05 };
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const browserErrors: string[] = [];
  const contexts: BrowserContext[] = [];
  await mkdir(evidenceDir, { recursive: true });

  const leadContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const escortContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(leadContext, escortContext);
  const lead = await leadContext.newPage();
  const escort = await escortContext.newPage();
  watchBrowserErrors(lead, browserErrors);
  watchBrowserErrors(escort, browserErrors);

  try {
    await Promise.all([
      lead.goto(`${baseURL}/?room=${roomId}&role=lead`),
      escort.goto(`${baseURL}/?room=${roomId}&role=escort`),
    ]);
    await Promise.all([waitForRole(lead, "LEAD"), waitForRole(escort, "ESCORT")]);
    await Promise.all([expectNonblankCanvas(lead), expectNonblankCanvas(escort)]);

    const initial = await waitForConvergence([lead, escort]);
    expect(await readConvoy(lead)).toEqual({ position: 0, cargo: 100, credits: 0, objective: 0 });
    await setFault(escort, "latencyMs", acceptanceFaultProfile.latencyMs);
    await setFault(escort, "dropRate", acceptanceFaultProfile.dropRate);

    await lead.getByTestId("action-advance-3").click();
    const afterLeadAction = await waitForConvergence([lead, escort], initial.stateHash);
    expect(afterLeadAction.serverTick).toBeGreaterThan(initial.serverTick);
    expect((await readConvoy(lead)).position).toBe(3);
    expect((await readConvoy(escort)).position).toBe(3);

    await escort.getByTestId("action-scan-sector").click();
    const afterEscortAction = await waitForConvergence([lead, escort], afterLeadAction.stateHash);
    expect(afterEscortAction.serverTick).toBeGreaterThan(afterLeadAction.serverTick);
    expect((await readConvoy(lead)).objective).toBe(2);

    await setFault(escort, "dropRate", 1);
    await lead.getByTestId("action-advance-1").click();
    const afterForcedLoss = await waitForChange(lead, afterEscortAction.stateHash);
    await expect.poll(() => droppedCount(escort)).toBeGreaterThan(0);
    expect(await readSync(escort)).toEqual(afterEscortAction);

    await setFault(escort, "dropRate", 0);
    await lead.getByTestId("action-advance-1").click();
    const afterLossRecovery = await waitForConvergence([lead, escort], afterForcedLoss.stateHash);
    expect((await readConvoy(escort)).position).toBe(5);

    await escort.getByTestId("action-transfer-10u").click();
    const beforeDuplicate = await waitForConvergence([lead, escort], afterLossRecovery.stateHash);
    await expect(escort.getByTestId("acked-commands")).toHaveText("2");
    expect(await readConvoy(escort)).toEqual({ position: 5, cargo: 90, credits: 20, objective: 4 });

    await escort.getByTestId("resend-button").click();
    await expect(escort.getByTestId("last-reject")).toHaveText("Last rejection: duplicate-command");
    await expect(escort.getByTestId("rejected-commands")).toHaveText("1");
    await expect.poll(() => readSync(escort)).toEqual(beforeDuplicate);
    await expect.poll(() => readSync(lead)).toEqual(beforeDuplicate);
    const afterDuplicate = await readSync(escort);

    await lead.getByTestId("disconnect-button").click();
    await expect(lead.getByTestId("connection-status")).toHaveText("OFFLINE");
    await lead.getByTestId("reconnect-button").click();
    await waitForRole(lead, "LEAD");
    await expect(lead.getByTestId("recovery-ms")).not.toHaveText("-");
    const afterReconnect = await waitForConvergence([lead, escort]);
    await lead.getByTestId("action-advance-1").click();
    const afterReconnectCommand = await waitForConvergence([lead, escort], afterReconnect.stateHash);
    expect((await readConvoy(lead)).position).toBe(6);

    const lateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    contexts.push(lateContext);
    const lateObserver = await lateContext.newPage();
    watchBrowserErrors(lateObserver, browserErrors);
    await lateObserver.goto(`${baseURL}/?room=${roomId}&role=lead`);
    await waitForRole(lateObserver, "OBSERVER");
    await expectNonblankCanvas(lateObserver);
    const afterLateJoin = await waitForConvergence([lead, escort, lateObserver]);
    expect(afterLateJoin).toEqual(afterReconnectCommand);
    expect((await readConvoy(lateObserver)).position).toBe(6);
    await expect(lateObserver.getByTestId("action-advance-3")).toBeDisabled();

    const desktopScreenshot = resolve(evidenceDir, "desktop-convoy.png");
    const mobileScreenshot = resolve(evidenceDir, "mobile-late-join.png");
    await lead.screenshot({ path: desktopScreenshot, fullPage: true });
    await lateObserver.screenshot({ path: mobileScreenshot, fullPage: true });

    const receipt = {
      capturedAt: new Date().toISOString(),
      commit,
      roomId,
      clients: {
        lead: { role: await metric(lead, "assigned-role"), ...await readSync(lead), recovery: await metric(lead, "recovery-ms") },
        escort: { role: await metric(escort, "assigned-role"), ...await readSync(escort) },
        lateObserver: { role: await metric(lateObserver, "assigned-role"), ...await readSync(lateObserver) },
      },
      checkpoints: {
        initial,
        afterLeadAction,
        afterEscortAction,
        afterForcedLoss,
        afterLossRecovery,
        beforeDuplicate,
        afterDuplicate,
        afterReconnect,
        afterReconnectCommand,
        afterLateJoin,
      },
      duplicateCommand: {
        rejected: await metric(escort, "rejected-commands"),
        reason: await metric(escort, "last-reject"),
        stateUnchanged: JSON.stringify(afterDuplicate) === JSON.stringify(beforeDuplicate),
      },
      faultProfile: {
        exercised: acceptanceFaultProfile,
        forcedDropRate: 1,
        finalDropRate: await escort.getByTestId("fault-dropRate").inputValue(),
        dropped: await droppedCount(escort),
        transport: await metric(escort, "transport-metrics"),
      },
      screenshots: ["evidence/browser/desktop-convoy.png", "evidence/browser/mobile-late-join.png"],
      browserErrors,
    };
    expect(receipt.duplicateCommand.stateUnchanged).toBe(true);
    const receiptPath = resolve(evidenceDir, "convoy-browser-receipt.json");
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await test.info().attach("convoy-browser-receipt", { path: receiptPath, contentType: "application/json" });

    expect(browserErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
