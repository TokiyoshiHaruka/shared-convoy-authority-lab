import "./styles.css";
import { ConvoyClient } from "./client";
import { createConvoyGame } from "./game";
import { ConvoyHud } from "./hud";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Application root is missing");

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room") || "room-alpha";
const requestedRole = params.get("role") === "escort" ? "escort" : "lead";
const endpoint = params.get("server") || `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname || "127.0.0.1"}:8787/`;
const shouldAutoConnect = params.has("role") || params.has("token") || params.get("autoconnect") === "1";

let game: ReturnType<typeof createConvoyGame>;
let client: ConvoyClient;
let hud: ConvoyHud;

hud = new ConvoyHud(app, requestedRole, roomId, {
  connect: () => client.connect(),
  disconnect: () => client.disconnect(),
  reconnect: () => client.reconnect(),
  setRole: (role) => client.setRequestedRole(role),
  sendAction: (action) => client.sendAction(action),
  resendLast: () => client.resendLastCommand(),
  setFaultProfile: (profile) => client.setFaultProfile(profile),
});
game = createConvoyGame(hud.getCanvasMount());
client = new ConvoyClient({
  endpoint,
  roomId,
  role: requestedRole,
  token: params.get("token") || undefined,
  onMetrics: (metrics) => hud.update(metrics),
  onState: (state) => game.setState(state),
});

if (shouldAutoConnect) client.connect();
