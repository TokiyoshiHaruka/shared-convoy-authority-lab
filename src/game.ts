import Phaser from "phaser";
import type { RoomState } from "./simulation";

const ROUTE_TARGET = 10;
const ROUTE_PADDING = 64;

let queuedState: RoomState | null = null;
let activeScene: ConvoyScene | null = null;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export class ConvoyScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private leadLabel!: Phaser.GameObjects.Text;
  private escortLabel!: Phaser.GameObjects.Text;
  private objectiveLabel!: Phaser.GameObjects.Text;
  private cargoLabel!: Phaser.GameObjects.Text;
  private state: RoomState | null = null;

  public constructor() {
    super("convoy-route");
  }

  public create(): void {
    activeScene = this;
    this.graphics = this.add.graphics();
    this.leadLabel = this.add.text(0, 0, "LEAD", {
      color: "#f5b84b",
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
      fontStyle: "bold",
    });
    this.escortLabel = this.add.text(0, 0, "ESCORT", {
      color: "#54d6c0",
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
      fontStyle: "bold",
    });
    this.objectiveLabel = this.add.text(0, 0, "OBJECTIVE", {
      color: "#f0f4f7",
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
    });
    this.cargoLabel = this.add.text(0, 0, "CARGO", {
      color: "#d5dde4",
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
    });
    this.scale.on("resize", this.handleResize, this);
    this.state = queuedState;
    this.renderRoute();
  }

  public shutdown(): void {
    if (activeScene === this) activeScene = null;
    this.scale.off("resize", this.handleResize, this);
  }

  public setState(state: RoomState | null): void {
    this.state = state;
    this.renderRoute();
  }

  private handleResize(): void {
    this.renderRoute();
  }

  private renderRoute(): void {
    if (!this.graphics) return;
    const width = Math.max(this.scale.width, 320);
    const height = Math.max(this.scale.height, 260);
    const routeStart = ROUTE_PADDING;
    const routeEnd = width - ROUTE_PADDING;
    const routeY = Math.round(height * 0.53);
    const routeWidth = Math.max(routeEnd - routeStart, 160);
    const state = this.state;
    const position = state?.convoy.position ?? 0;
    const progress = clamp(position / ROUTE_TARGET, 0, 1);
    const escortProgress = clamp(progress - 0.07, 0, 1);
    const objectiveProgress = clamp((state?.convoy.objectiveProgress ?? 0) / ROUTE_TARGET, 0, 1);

    this.graphics.clear();
    this.graphics.fillStyle(0x101416, 1);
    this.graphics.fillRect(0, 0, width, height);
    this.graphics.lineStyle(1, 0x292f31, 1);
    for (let line = 0; line < 6; line += 1) {
      const y = 36 + line * 34;
      this.graphics.lineBetween(0, y, width, y);
    }

    this.graphics.lineStyle(8, 0x363c3e, 1);
    this.graphics.lineBetween(routeStart, routeY, routeEnd, routeY);
    this.graphics.lineStyle(2, 0x858d8e, 1);
    this.graphics.lineBetween(routeStart, routeY, routeEnd, routeY);
    for (let marker = 0; marker <= ROUTE_TARGET; marker += 1) {
      const x = routeStart + routeWidth * (marker / ROUTE_TARGET);
      this.graphics.lineStyle(marker % 5 === 0 ? 3 : 1, marker % 5 === 0 ? 0xe2a93d : 0x7a8b94, 1);
      this.graphics.lineBetween(x, routeY - 14, x, routeY + 14);
    }

    const objectiveX = routeStart + routeWidth;
    this.graphics.fillStyle(0x262b2d, 1);
    this.graphics.fillCircle(objectiveX, routeY, 24);
    this.graphics.lineStyle(3, objectiveProgress >= 1 ? 0x7ce3a6 : 0xe2a93d, 1);
    this.graphics.strokeCircle(objectiveX, routeY, 24);
    this.graphics.fillStyle(objectiveProgress >= 1 ? 0x7ce3a6 : 0xe2a93d, 1);
    this.graphics.fillCircle(objectiveX, routeY, 8);

    this.drawShip(routeStart + routeWidth * progress, routeY - 24, 0xf5b84b, "lead");
    this.drawShip(routeStart + routeWidth * escortProgress, routeY + 25, 0x54d6c0, "escort");

    this.leadLabel.setPosition(clamp(routeStart + routeWidth * progress - 24, 8, width - 74), routeY - 62);
    this.escortLabel.setPosition(clamp(routeStart + routeWidth * escortProgress - 28, 8, width - 84), routeY + 42);
    this.objectiveLabel.setPosition(clamp(objectiveX - 45, 8, width - 90), routeY - 57);
    this.objectiveLabel.setText(state ? `OBJECTIVE ${state.convoy.objectiveProgress}/${ROUTE_TARGET}` : "OBJECTIVE");
    this.cargoLabel.setPosition(ROUTE_PADDING, 22);
    this.cargoLabel.setText(state ? `CARGO ${state.convoy.cargoUnits}u  |  CREDITS ${state.convoy.credits}  |  HULL ${state.convoy.hullIntegrity}%` : "Awaiting server snapshot");
  }

  private drawShip(x: number, y: number, color: number, role: "lead" | "escort"): void {
    this.graphics.fillStyle(color, 1);
    this.graphics.fillRoundedRect(x - 19, y - 9, 38, 18, 5);
    this.graphics.fillStyle(0x101416, 1);
    this.graphics.fillTriangle(x + 19, y - 8, x + 29, y, x + 19, y + 8);
    this.graphics.fillCircle(x - 7, y, role === "lead" ? 4 : 3);
  }
}

export interface ConvoyGameHandle {
  game: Phaser.Game;
  setState: (state: RoomState | null) => void;
  destroy: () => void;
}

export function createConvoyGame(parent: HTMLElement): ConvoyGameHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 920,
    height: 430,
    backgroundColor: "#101416",
    scene: [ConvoyScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: { antialias: true, pixelArt: false },
  });

  return {
    game,
    setState(state) {
      queuedState = state;
      activeScene?.setState(state);
    },
    destroy() {
      queuedState = null;
      activeScene = null;
      game.destroy(true);
    },
  };
}
