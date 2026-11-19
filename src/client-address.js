"use strict";

/**
 * Who is calling, for rate limits and lockouts (security review r2 #1, #2).
 *
 * The server listens on loopback behind a tunnel on the same machine, so the socket address of
 * almost every request is 127.0.0.1 and says nothing about the caller. A forwarding header is
 * trusted only when the owner said which tunnel sets it, and only from a loopback peer:
 *
 *   TRUST_PROXY=tailscale       Tailscale Serve / Funnel. tailscaled's reverse proxy SETS
 *                               X-Forwarded-For to the connection's source address (it does not
 *                               append; ipn/ipnlocal/serve.go addProxyForwardedHeaders). The
 *                               right-most valid entry is taken.
 *   TRUST_CF_CONNECTING_IP=1    cloudflared. Cloudflare's edge sets CF-Connecting-IP.
 *   TRUST_FORWARDED_FOR=1       a hosting proxy on a private network (Hugging Face Spaces): the
 *                               right-most public X-Forwarded-For entry, from a private-network peer.
 *
 * Without a trusted header a loopback (or trusted-proxy) peer is UNTRUSTED: every caller looks the
 * same. Limits keyed on an untrusted address use one coarse global bucket with a larger cap
 * (`rateCheck`), so a forged header can never mint fresh buckets, and PIN lockouts lean on the
 * per-phone counter instead (src/accounts/lockout.js).
 *
 * IPv6 addresses are bucketed by /64 (one customer usually holds a whole /64); an IPv4-mapped
 * IPv6 address is its IPv4 address.
 *
 *   clientAddress(req) -> { ip, trusted, via }   ip is the bucket ("203.0.113.9", "2001:db8:1:2::/64")
 *   rateCheck(req, name, { perIp, untrusted }) -> { key, max, windowMs } for src/limits.js
 */

const net = require("node:net");
const { config } = require("./config");

const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

/** A bare IP address (v4 or v6) with an IPv4-mapped prefix removed, or null when it is not one. */
function parseIp(text) {
  if (typeof text !== "string") return null;
  let ip = text.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  return net.isIP(ip) ? ip.toLowerCase() : null;
}

const isLoopback = (ip) => ip === "::1" || /^127\./.test(ip ?? "");
const isPrivate = (ip) => PRIVATE_IP.test(ip ?? "");

/** The eight 16-bit groups of an IPv6 address. */
function ipv6Groups(ip) {
  let text = ip;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4[1].split(".").map(Number);
    text = text.slice(0, -v4[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = text.includes("::") ? Array(8 - left.length - right.length).fill("0") : [];
  return [...left, ...fill, ...right].map((g) => parseInt(g || "0", 16));
}

/** The limiter bucket for an address: IPv4 as is, IPv6 as its /64 prefix. */
function ipBucket(ip) {
  const parsed = parseIp(ip);
  if (!parsed) return "unknown";
  if (net.isIPv4(parsed)) return parsed;
  return `${ipv6Groups(parsed).slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** Right-most entry of a comma-separated X-Forwarded-For that passes `accept`, or null. */
function rightMost(header, accept) {
  const hops = String(header ?? "").split(",").map(parseIp).reverse();
  return hops.find((ip) => ip && accept(ip)) ?? null;
}

function clientAddress(req, cfg = config) {
  const peer = parseIp(req.socket?.remoteAddress) ?? "unknown";
  const headers = req.headers ?? {};
  const trusted = (ip, via) => ({ ip: ipBucket(ip), trusted: true, via });

  if (isLoopback(peer)) {
    if (cfg.trustProxy === "tailscale") {
      const ip = rightMost(headers["x-forwarded-for"], () => true);
      if (ip) return trusted(ip, "tailscale");
    }
    if (cfg.trustCfConnectingIp) {
      const ip = parseIp(headers["cf-connecting-ip"]);
      if (ip) return trusted(ip, "cloudflare");
    }
  }
  if (cfg.trustForwardedFor && isPrivate(peer)) {
    const ip = rightMost(headers["x-forwarded-for"], (h) => !isPrivate(h));
    if (ip) return trusted(ip, "forwarded-for");
    return { ip: ipBucket(peer), trusted: false, via: "proxy-without-header" };
  }
  // A loopback peer is the local tunnel: without a header it trusts, every caller looks alike.
  if (isLoopback(peer)) return { ip: ipBucket(peer), trusted: false, via: "loopback" };
  return trusted(peer, "peer");
}

/**
 * One limiter check for `name`: per address when the address is trusted, else one global bucket
 * shared by every untrusted caller with the larger `untrusted` cap (falls back to `perIp`).
 */
function rateCheck(req, name, { perIp, untrusted = perIp }, cfg = config) {
  const who = clientAddress(req, cfg);
  return who.trusted ? { key: `${name}:ip:${who.ip}`, ...perIp } : { key: `${name}:untrusted`, ...untrusted };
}

module.exports = { clientAddress, rateCheck, ipBucket, parseIp };
