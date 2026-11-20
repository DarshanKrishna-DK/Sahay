// Device-only first visit (spec 3.1 row 60): only on servers without /api/auth. The same StepScreen
// set as Sign up (auth.js "legacy" mode): language, shop name, city, and the access code only when
// this server needs one, then POST /api/session and into the app.

import { createAuth } from "./auth.js";

export function createWelcome() {
  const view = createAuth({ mode: "legacy" });
  return { el: view.el, update: view.update, destroy: view.destroy };
}
