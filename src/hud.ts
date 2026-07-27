import type { ClientMetrics, ConnectionStatus } from "./client";
import type { CommandAction, Role } from "./protocol";

export interface HudActions {
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  setRole: (role: Role) => void;
  sendAction: (action: CommandAction) => void;
  resendLast: () => void;
  setFaultProfile: (profile: { latencyMs?: number; jitterMs?: number; dropRate?: number; duplicateRate?: number; reorderRate?: number }) => void;
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function metricRow(label: string, testId: string): { row: HTMLElement; value: HTMLElement } {
  const row = createElement("div", "metric-row");
  const labelNode = createElement("span", "metric-label", label);
  const valueNode = createElement("strong", "metric-value", "-");
  valueNode.dataset.testid = testId;
  row.append(labelNode, valueNode);
  return { row, value: valueNode };
}

function button(label: string, className = "button"): HTMLButtonElement {
  const action = createElement("button", className, label);
  action.type = "button";
  return action;
}

export class ConvoyHud {
  private readonly root: HTMLElement;
  private readonly actions: HudActions;
  private role: Role;
  private readonly statusNode: HTMLElement;
  private readonly roleNode: HTMLElement;
  private readonly roomNode: HTMLElement;
  private readonly tickValue: HTMLElement;
  private readonly snapshotValue: HTMLElement;
  private readonly rttValue: HTMLElement;
  private readonly pendingValue: HTMLElement;
  private readonly ackedValue: HTMLElement;
  private readonly rejectedValue: HTMLElement;
  private readonly recoveryValue: HTMLElement;
  private readonly hashValue: HTMLElement;
  private readonly transportValue: HTMLElement;
  private readonly lastRejectValue: HTMLElement;
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly connectButton: HTMLButtonElement;
  private readonly disconnectButton: HTMLButtonElement;
  private readonly reconnectButton: HTMLButtonElement;
  private readonly resendButton: HTMLButtonElement;
  private readonly roleSelect: HTMLSelectElement;
  private readonly actionGrid: HTMLElement;
  private readonly actionHelp: HTMLElement;
  private readonly faultInputs = new Map<string, HTMLInputElement>();
  private readonly faultValues = new Map<string, HTMLElement>();

  public constructor(root: HTMLElement, role: Role, roomId: string, actions: HudActions) {
    this.root = root;
    this.role = role;
    this.actions = actions;
    this.root.replaceChildren();

    const shell = createElement("section", "hud-shell");
    const header = createElement("header", "hud-header");
    const heading = createElement("div", "hud-heading");
    heading.append(createElement("p", "eyebrow", "LOCAL ONLINE SYSTEMS LAB"), createElement("h1", undefined, "Shared Convoy Authority"));
    const identity = createElement("div", "identity-block");
    this.roleNode = createElement("span", "role-badge", `ROLE ${role.toUpperCase()}`);
    this.roleNode.dataset.testid = "assigned-role";
    this.statusNode = createElement("span", "status-pill status-idle", "IDLE");
    this.statusNode.dataset.testid = "connection-status";
    identity.append(this.roleNode, this.statusNode);
    header.append(heading, identity);

    const connectionBar = createElement("div", "connection-bar");
    const roomLabel = createElement("span", "room-label", "ROOM");
    this.roomNode = createElement("strong", "room-value", roomId);
    this.roomNode.dataset.testid = "room-id";
    const roleControl = createElement("label", "role-control");
    roleControl.append(createElement("span", "room-label", "ROLE"));
    this.roleSelect = document.createElement("select");
    this.roleSelect.dataset.testid = "role-select";
    for (const optionRole of ["lead", "escort"] as const) {
      const option = document.createElement("option");
      option.value = optionRole;
      option.textContent = optionRole === "lead" ? "Lead" : "Escort";
      this.roleSelect.append(option);
    }
    this.roleSelect.value = role;
    this.roleSelect.addEventListener("change", () => {
      const nextRole = this.roleSelect.value === "escort" ? "escort" : "lead";
      this.role = nextRole;
      this.renderRoleActions(nextRole);
      actions.setRole(nextRole);
    });
    roleControl.append(this.roleSelect);
    this.connectButton = button("Connect", "button button-primary");
    this.connectButton.dataset.testid = "connect-button";
    this.disconnectButton = button("Disconnect");
    this.disconnectButton.dataset.testid = "disconnect-button";
    this.reconnectButton = button("Reconnect");
    this.reconnectButton.dataset.testid = "reconnect-button";
    connectionBar.append(roomLabel, this.roomNode, roleControl, this.connectButton, this.disconnectButton, this.reconnectButton);

    const playfield = createElement("div", "playfield-shell");
    const playfieldHeading = createElement("div", "section-heading");
    playfieldHeading.append(createElement("span", undefined, "SERVER-CONFIRMED ROUTE"), createElement("span", "authority-note", "AUTHORITY: SERVER"));
    const canvasMount = createElement("div", "canvas-mount");
    canvasMount.dataset.testid = "convoy-playfield";
    playfield.append(playfieldHeading, canvasMount);

    const actionPanel = createElement("section", "action-panel");
    const actionHeading = createElement("div", "section-heading");
    this.actionHelp = createElement("span", "action-help", role === "lead" ? "Route control" : "Cargo operations");
    actionHeading.append(createElement("span", undefined, "ROLE COMMANDS"), this.actionHelp);
    this.actionGrid = createElement("div", "action-grid");
    this.resendButton = button("Resend last command");
    this.resendButton.dataset.testid = "resend-button";
    this.resendButton.classList.add("button-subtle");
    this.resendButton.addEventListener("click", () => actions.resendLast());
    actionPanel.append(actionHeading, this.actionGrid, this.resendButton);
    this.renderRoleActions(role);

    const observability = createElement("section", "observability-panel");
    const observabilityHeading = createElement("div", "section-heading");
    observabilityHeading.append(createElement("span", undefined, "SYNC RECEIPT"), createElement("span", "authority-note", "READ ONLY"));
    const metricsGrid = createElement("div", "metrics-grid");
    const tick = metricRow("Server tick", "server-tick");
    const snapshot = metricRow("Snapshot seq", "snapshot-sequence");
    const rtt = metricRow("RTT", "round-trip-ms");
    const pending = metricRow("Pending", "pending-commands");
    const acked = metricRow("Acked", "acked-commands");
    const rejected = metricRow("Rejected", "rejected-commands");
    const recovery = metricRow("Recovery", "recovery-ms");
    const hash = metricRow("State hash", "state-hash");
    this.tickValue = tick.value;
    this.snapshotValue = snapshot.value;
    this.rttValue = rtt.value;
    this.pendingValue = pending.value;
    this.ackedValue = acked.value;
    this.rejectedValue = rejected.value;
    this.recoveryValue = recovery.value;
    this.hashValue = hash.value;
    metricsGrid.append(tick.row, snapshot.row, rtt.row, pending.row, acked.row, rejected.row, recovery.row, hash.row);
    this.transportValue = createElement("p", "transport-summary", "Transport idle");
    this.transportValue.dataset.testid = "transport-metrics";
    this.lastRejectValue = createElement("p", "reject-summary", "No rejected commands");
    this.lastRejectValue.dataset.testid = "last-reject";
    observability.append(observabilityHeading, metricsGrid, this.transportValue, this.lastRejectValue);

    const debug = createElement("details", "debug-drawer");
    const debugSummary = createElement("summary", undefined, "Transport fault profile");
    const debugContent = createElement("div", "debug-content");
    debugContent.append(this.createFaultControl("latencyMs", "Latency", 0, 500, 10, "ms"));
    debugContent.append(this.createFaultControl("jitterMs", "Jitter", 0, 250, 10, "ms"));
    debugContent.append(this.createFaultControl("dropRate", "Drop", 0, 1, 0.01, "%", true));
    debugContent.append(this.createFaultControl("duplicateRate", "Duplicate", 0, 1, 0.01, "%", true));
    debugContent.append(this.createFaultControl("reorderRate", "Reorder", 0, 1, 0.01, "%", true));
    debug.append(debugSummary, debugContent);

    shell.append(header, connectionBar, playfield, actionPanel, observability, debug);
    this.root.append(shell);
    this.connectButton.addEventListener("click", () => actions.connect());
    this.disconnectButton.addEventListener("click", () => actions.disconnect());
    this.reconnectButton.addEventListener("click", () => actions.reconnect());
    this.setButtonStates("idle", null);
  }

  public getCanvasMount(): HTMLElement {
    const mount = this.root.querySelector<HTMLElement>(".canvas-mount");
    if (!mount) throw new Error("canvas mount is missing");
    return mount;
  }

  public update(metrics: ClientMetrics): void {
    this.statusNode.textContent = metrics.status.toUpperCase();
    this.statusNode.className = `status-pill status-${metrics.status}`;
    this.roleNode.textContent = `ROLE ${(metrics.assignedRole ?? this.role).toUpperCase()}`;
    if (metrics.requestedRole !== this.role) {
      this.role = metrics.requestedRole;
      this.roleSelect.value = metrics.requestedRole;
      this.renderRoleActions(metrics.requestedRole);
    }
    this.roomNode.textContent = metrics.roomId;
    this.tickValue.textContent = String(metrics.serverTick);
    this.snapshotValue.textContent = String(metrics.snapshotSequence);
    this.rttValue.textContent = metrics.roundTripMs === null ? "-" : `${metrics.roundTripMs} ms`;
    this.pendingValue.textContent = String(metrics.pendingCommands);
    this.ackedValue.textContent = String(metrics.ackedCommands);
    this.rejectedValue.textContent = String(metrics.rejectedCommands);
    this.recoveryValue.textContent = metrics.recoveryMs === null ? "-" : `${metrics.recoveryMs} ms`;
    this.hashValue.textContent = metrics.stateHash;
    this.transportValue.textContent = `Transport  sent ${metrics.transport.sent}  |  received ${metrics.transport.received}  |  delivered ${metrics.transport.delivered}  |  dropped ${metrics.transport.dropped}  |  duplicated ${metrics.transport.duplicated}  |  reordered ${metrics.transport.reordered}`;
    this.lastRejectValue.textContent = metrics.lastRejectReason ? `Last rejection: ${metrics.lastRejectReason}` : "No rejected commands";
    this.setButtonStates(metrics.status, metrics.assignedRole);
    for (const [key, input] of this.faultInputs) {
      const value = metrics.faultProfile[key as keyof typeof metrics.faultProfile];
      input.value = String(value);
      this.updateFaultValue(key, value);
    }
  }

  private addActionButton(container: HTMLElement, label: string, handler: () => void): void {
    const action = button(label, "button action-button");
    action.dataset.testid = `action-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    action.addEventListener("click", handler);
    this.actionButtons.push(action);
    container.append(action);
  }

  private createFaultControl(key: "latencyMs" | "jitterMs" | "dropRate" | "duplicateRate" | "reorderRate", label: string, min: number, max: number, step: number, unit: string, percent = false): HTMLElement {
    const row = createElement("label", "fault-row");
    const title = createElement("span", "fault-label", label);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = "0";
    input.dataset.testid = `fault-${key}`;
    const value = createElement("output", "fault-value", percent ? "0%" : `0 ${unit}`);
    input.addEventListener("input", () => {
      const numericValue = Number(input.value);
      this.updateFaultValue(key, numericValue);
      this.actions.setFaultProfile({ [key]: numericValue });
    });
    row.append(title, input, value);
    this.faultInputs.set(key, input);
    this.faultValues.set(key, value);
    return row;
  }

  private updateFaultValue(key: string, numericValue: number): void {
    const value = this.faultValues.get(key);
    if (!value) return;
    const isPercent = key === "dropRate" || key === "duplicateRate" || key === "reorderRate";
    value.textContent = isPercent ? `${Math.round(numericValue * 100)}%` : `${numericValue} ms`;
  }

  private setButtonStates(status: ConnectionStatus, assignedRole: Role | "observer" | null): void {
    const ready = status === "connected";
    this.connectButton.disabled = status === "connecting" || status === "reconnecting" || ready;
    this.disconnectButton.disabled = !ready;
    this.reconnectButton.disabled = status === "connecting" || status === "reconnecting";
    this.roleSelect.disabled = status === "connecting" || status === "reconnecting" || ready;
    this.resendButton.disabled = !ready;
    const canCommand = ready && assignedRole !== "observer";
    for (const action of this.actionButtons) action.disabled = !canCommand;
  }

  private renderRoleActions(role: Role): void {
    this.actionButtons.length = 0;
    this.actionGrid.replaceChildren();
    this.actionHelp.textContent = role === "lead" ? "Route control" : "Cargo operations";
    if (role === "lead") {
      this.addActionButton(this.actionGrid, "Advance +1", () => this.actions.sendAction({ type: "move", distance: 1 }));
      this.addActionButton(this.actionGrid, "Advance +3", () => this.actions.sendAction({ type: "move", distance: 3 }));
      this.addActionButton(this.actionGrid, "Confirm route", () => this.actions.sendAction({ type: "confirm" }));
    } else {
      this.addActionButton(this.actionGrid, "Scan sector", () => this.actions.sendAction({ type: "scan" }));
      this.addActionButton(this.actionGrid, "Transfer 10u", () => this.actions.sendAction({ type: "transfer", units: 10 }));
      this.addActionButton(this.actionGrid, "Transfer 20u", () => this.actions.sendAction({ type: "transfer", units: 20 }));
    }
  }
}
