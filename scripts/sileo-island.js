// The sileo toast library as one small "island" for the vanilla app. React and sileo stay inside
// this bundle; the app only sees plain functions:
//   mount(el, props)       -> { render(props), unmount() }   (props go to sileo's <Toaster>)
//   toast.success/error/info/warning/action/show(opts) -> id
//   toast.promise(promise, { loading, success, error, action? }) -> promise
//   toast.dismiss(id), toast.clear(position?)
//   setReducedMotion(on)   -> springs (motion) jump to their end state
// Any `title`, `description` or `icon` given as a DOM Node is placed in the toast as that node
// (built by the app with its own dom.js), so the app never writes JSX or HTML strings.
//
// Bundled by scripts/build-sileo.mjs into public/vendor/sileo-0.1.6/sileo-island.js.

import { createElement as h, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, sileo } from "sileo";
import { MotionGlobalConfig } from "motion/react";

const isNode = (v) => Boolean(v) && typeof v === "object" && typeof v.nodeType === "number";

/** Hosts a DOM node inside React. A node already shown elsewhere (sileo's outgoing header layer) is cloned. */
function Slot({ node }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    const el = node.isConnected && node.parentNode !== host ? node.cloneNode(true) : node;
    host.replaceChildren(el);
    return () => { if (host.firstChild === el) host.replaceChildren(); };
  }, [node]);
  return h("span", { ref, className: "toast-slot" });
}

const asReact = (v) => (isNode(v) ? h(Slot, { node: v }) : v);

function wrap(opts) {
  if (!opts || typeof opts !== "object") return opts;
  const out = { ...opts };
  for (const k of ["title", "description", "icon"]) if (k in out) out[k] = asReact(out[k]);
  return out;
}
const wrapFn = (v) => (typeof v === "function" ? (x) => wrap(v(x)) : wrap(v));

export const toast = {
  show: (o) => sileo.show(wrap(o)),
  success: (o) => sileo.success(wrap(o)),
  error: (o) => sileo.error(wrap(o)),
  warning: (o) => sileo.warning(wrap(o)),
  info: (o) => sileo.info(wrap(o)),
  action: (o) => sileo.action(wrap(o)),
  promise: (p, o) => sileo.promise(p, {
    ...o,
    loading: wrap(o.loading),
    success: wrapFn(o.success),
    error: wrapFn(o.error),
    ...(o.action ? { action: wrapFn(o.action) } : {}),
  }),
  dismiss: (id) => sileo.dismiss(id),
  clear: (position) => sileo.clear(position),
};

export function mount(el, props = {}) {
  const root = createRoot(el);
  const render = (p) => root.render(h(Toaster, p));
  render(props);
  return { render, unmount: () => root.unmount() };
}

export function setReducedMotion(on) {
  MotionGlobalConfig.instantAnimations = Boolean(on);
}
