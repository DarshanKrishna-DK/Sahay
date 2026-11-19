// Preview page for checking one figure the way the landing mounts it (same loader, same CSS).
import { cardMarkup, mountFigures } from "./loader.js";

const params = new URLSearchParams(location.search);
const name = (params.get("fig") || "balance").replace(/[^a-z0-9-]/g, "");
const theme = params.get("theme");
const lang = ["en", "hi", "kn"].includes(params.get("lang")) ? params.get("lang") : "en";
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
document.documentElement.lang = lang;

const card = document.createElement("figure");
card.className = "iso-figure fig-card";
card.dataset.figure = name;
card.innerHTML = cardMarkup(name);
document.getElementById("preview").append(card);
mountFigures(document, { lang });
