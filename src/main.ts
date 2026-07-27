const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Application root is missing");
}

const title = document.createElement("h1");
title.textContent = "Shared Convoy Authority Lab";

const statusLine = document.createElement("p");
statusLine.textContent = "Prototype shell ready. Authoritative simulation is next.";

app.replaceChildren(title, statusLine);
