"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { clientAddress, rateCheck, ipBucket, parseIp } = require("../src/client-address");
const { loadConfig, ConfigError } = require("../src/config");

const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
const OFF = { trustProxy: null, trustCfConnectingIp: false, trustForwardedFor: false };
const TAILSCALE = { ...OFF, trustProxy: "tailscale" };
const CLOUDFLARE = { ...OFF, trustCfConnectingIp: true };
const HOSTED = { ...OFF, trustForwardedFor: true };

test("by default no forwarding header is trusted: a loopback caller is untrusted, CF-Connecting-IP is ignored", () => {
  assert.deepEqual(clientAddress(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" }), OFF), { ip: "127.0.0.1", trusted: false, via: "loopback" });
  assert.deepEqual(clientAddress(req("::1", { "x-forwarded-for": "203.0.113.9" }), OFF), { ip: "0:0:0:0::/64", trusted: false, via: "loopback" });
  assert.deepEqual(clientAddress(req("::ffff:127.0.0.1", { "cf-connecting-ip": "203.0.113.9" }), OFF).trusted, false);
});

test("a direct (non-loopback) peer is the client, whatever headers it sends", () => {
  for (const cfg of [OFF, TAILSCALE, CLOUDFLARE]) {
    const who = clientAddress(req("198.51.100.4", { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9" }), cfg);
    assert.deepEqual(who, { ip: "198.51.100.4", trusted: true, via: "peer" });
  }
  assert.equal(clientAddress(req("::ffff:198.51.100.4"), OFF).ip, "198.51.100.4", "IPv4-mapped IPv6 is its IPv4 address");
});

test("TRUST_PROXY=tailscale: the right-most X-Forwarded-For from loopback; fails closed to an untrusted peer", () => {
  assert.deepEqual(clientAddress(req("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }), TAILSCALE), { ip: "203.0.113.9", trusted: true, via: "tailscale" });
  assert.equal(clientAddress(req("127.0.0.1", { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), TAILSCALE).ip, "203.0.113.9", "a client-written left entry is not used");
  assert.equal(clientAddress(req("127.0.0.1", { "x-forwarded-for": "100.101.102.103" }), TAILSCALE).ip, "100.101.102.103", "a tailnet peer is a client too");
  assert.deepEqual(clientAddress(req("127.0.0.1"), TAILSCALE), { ip: "127.0.0.1", trusted: false, via: "loopback" }, "no header: untrusted");
  assert.equal(clientAddress(req("127.0.0.1", { "x-forwarded-for": "junk; drop table" }), TAILSCALE).trusted, false, "garbage: untrusted");
  assert.equal(clientAddress(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" }), TAILSCALE).trusted, false, "CF-Connecting-IP is not Tailscale's header");
});

test("TRUST_CF_CONNECTING_IP=1: CF-Connecting-IP only from loopback; garbage or a missing header is untrusted", () => {
  assert.deepEqual(clientAddress(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" }), CLOUDFLARE), { ip: "203.0.113.9", trusted: true, via: "cloudflare" });
  assert.equal(clientAddress(req("127.0.0.1", { "cf-connecting-ip": "not an ip" }), CLOUDFLARE).trusted, false);
  assert.equal(clientAddress(req("127.0.0.1"), CLOUDFLARE).trusted, false);
  assert.equal(clientAddress(req("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }), CLOUDFLARE).trusted, false, "X-Forwarded-For is not Cloudflare's header here");
});

test("TRUST_FORWARDED_FOR=1: right-most public X-Forwarded-For from a private peer; none means untrusted", () => {
  assert.equal(clientAddress(req("10.0.3.7", { "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.1.1.1" }), HOSTED).ip, "203.0.113.9");
  assert.deepEqual(clientAddress(req("10.0.3.7", { "x-forwarded-for": "junk" }), HOSTED), { ip: "10.0.3.7", trusted: false, via: "proxy-without-header" });
  assert.equal(clientAddress(req("10.0.3.7", { "x-forwarded-for": "203.0.113.9" }), OFF).ip, "10.0.3.7", "off by default: a LAN peer is a client");
  assert.equal(clientAddress(req("10.0.3.7", { "x-forwarded-for": "203.0.113.9" }), OFF).trusted, true);
});

test("IPv6 callers are bucketed by /64", () => {
  assert.equal(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(ipBucket("2001:db8:1:2::1"), "2001:db8:1:2::/64");
  assert.equal(ipBucket("2001:DB8:0001:0002:ffff::9"), "2001:db8:1:2::/64");
  assert.equal(ipBucket("2001:db8::"), "2001:db8:0:0::/64");
  assert.equal(ipBucket("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(ipBucket("garbage"), "unknown");
  const a = clientAddress(req("127.0.0.1", { "x-forwarded-for": "2001:db8:1:2::1" }), TAILSCALE);
  const b = clientAddress(req("127.0.0.1", { "x-forwarded-for": "2001:db8:1:2::ffff" }), TAILSCALE);
  assert.equal(a.ip, b.ip, "two addresses in one /64 share a bucket");
  assert.equal(parseIp("[2001:db8::1]"), "2001:db8::1");
});

test("rateCheck: per address when trusted, else one global bucket with the untrusted cap", () => {
  const limitsFor = { perIp: { max: 5, windowMs: 1000 }, untrusted: { max: 30, windowMs: 1000 } };
  assert.deepEqual(rateCheck(req("198.51.100.4"), "session", limitsFor, OFF), { key: "session:ip:198.51.100.4", max: 5, windowMs: 1000 });
  assert.deepEqual(rateCheck(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" }), "session", limitsFor, OFF), { key: "session:untrusted", max: 30, windowMs: 1000 });
  assert.deepEqual(
    rateCheck(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.1" }), "session", limitsFor, OFF),
    rateCheck(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.2" }), "session", limitsFor, OFF),
    "a forged header never mints a new bucket",
  );
  assert.deepEqual(rateCheck(req("127.0.0.1"), "pay", { perIp: { max: 5, windowMs: 1 } }, OFF), { key: "pay:untrusted", max: 5, windowMs: 1 }, "no untrusted cap: the per-IP one");
});

test("config: TRUST_PROXY accepts tailscale only; TRUST_CF_CONNECTING_IP is an explicit 1", () => {
  assert.equal(loadConfig({}).trustProxy, null);
  assert.equal(loadConfig({}).trustCfConnectingIp, false);
  assert.equal(loadConfig({ TRUST_PROXY: "tailscale" }).trustProxy, "tailscale");
  assert.equal(loadConfig({ TRUST_PROXY: "Tailscale" }).trustProxy, "tailscale");
  assert.equal(loadConfig({ TRUST_CF_CONNECTING_IP: "1" }).trustCfConnectingIp, true);
  assert.equal(loadConfig({ TRUST_CF_CONNECTING_IP: "true" }).trustCfConnectingIp, false);
  assert.throws(() => loadConfig({ TRUST_PROXY: "cloudflare" }), (err) => err instanceof ConfigError && err.code === "INVALID_TRUST_PROXY");
});
