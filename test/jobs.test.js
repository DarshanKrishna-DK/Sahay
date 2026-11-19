"use strict";

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const events = require("../src/events");
const jobs = require("../src/jobs");
const repo = require("../src/db/repo");

function seedBusiness(name = "Asha Stores") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name });
  return id;
}

const hasCode = (code) => (err) => err.code === code;
const jobEvents = (businessId) => repo.listAudit(businessId).filter((row) => row.type.startsWith("job."));

/** A promise the test resolves or rejects by hand, to hold a runner open. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("startJob returns a job id before the runner has started", async () => {
  const businessId = seedBusiness();
  const requirement = repo.createRequirement(businessId, { item: "rice", quantity: 50, unit: "kg" });
  let started = false;

  const jobId = jobs.startJob(businessId, "sourcing", { requirementId: requirement.id }, async () => {
    started = true;
  });

  assert.match(jobId, /^job_/);
  assert.equal(started, false);
  const queued = repo.getJob(businessId, jobId);
  assert.equal(queued.status, "queued");
  assert.equal(queued.kind, "sourcing");
  assert.equal(queued.requirement_id, requirement.id);

  await jobs.whenSettled(jobId);
  assert.equal(started, true);
  assert.equal(repo.getJob(businessId, jobId).status, "done");
});

test("a job reports progress as it goes and finishes with its result", async () => {
  const businessId = seedBusiness();
  const live = [];
  const stop = events.subscribe(businessId, (event) => live.push(event.type));
  let seenContext;

  const jobId = jobs.startJob(businessId, "sourcing", { item: "rice" }, async (ctx) => {
    seenContext = ctx;
    ctx.progress("Looking on IndiaMART");
    ctx.progress("Found vendors", { found: 3 });
    return { vendors: 3, skipped: undefined };
  });
  await jobs.whenSettled(jobId);
  stop();

  assert.equal(seenContext.jobId, jobId);
  assert.equal(seenContext.businessId, businessId);
  assert.deepEqual(seenContext.input, { item: "rice" });
  assert.ok(seenContext.signal instanceof AbortSignal);

  const job = repo.getJob(businessId, jobId);
  assert.equal(job.status, "done");
  assert.equal(job.error, null);
  assert.deepEqual(job.result, { vendors: 3 });
  assert.deepEqual(job.progress.map(({ message, data }) => ({ message, data })), [
    { message: "Looking on IndiaMART", data: undefined },
    { message: "Found vendors", data: { found: 3 } },
  ]);
  assert.ok(job.progress.every((entry) => !Number.isNaN(Date.parse(entry.ts))));

  assert.deepEqual(live, ["job.started", "job.progress", "job.progress", "job.done"]);
  const audit = jobEvents(businessId);
  assert.deepEqual(audit[0].detail, { jobId, kind: "sourcing", input: { item: "rice" } });
  assert.deepEqual(audit[2].detail, { jobId, kind: "sourcing", message: "Found vendors", data: { found: 3 } });
  assert.deepEqual(audit[3].detail, { jobId, kind: "sourcing", result: { vendors: 3 } });
});

test("a runner that rejects marks the job failed with the error message, on the row and as an event", async () => {
  const businessId = seedBusiness();
  const jobId = jobs.startJob(businessId, "sourcing", {}, async (ctx) => {
    ctx.progress("Fetching the listing page");
    const err = new Error("IndiaMART answered HTTP 503");
    err.code = "DISCOVERY_FAILED";
    throw err;
  });
  await jobs.whenSettled(jobId);

  const job = repo.getJob(businessId, jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.error, "IndiaMART answered HTTP 503");
  assert.equal(job.result, null);
  assert.equal(job.progress.length, 1, "progress made before the failure is kept");
  assert.deepEqual(jobEvents(businessId).at(-1).detail, { jobId, kind: "sourcing", error: "IndiaMART answered HTTP 503", code: "DISCOVERY_FAILED" });
  assert.equal(jobEvents(businessId).at(-1).type, "job.failed");
});

test("a runner that throws synchronously, throws a non-error or returns something unstorable also fails loudly", async () => {
  const businessId = seedBusiness();
  const outcome = async (runner) => {
    const jobId = jobs.startJob(businessId, "negotiation", {}, runner);
    await jobs.whenSettled(jobId);
    const job = repo.getJob(businessId, jobId);
    return [job.status, job.error];
  };

  assert.deepEqual(await outcome(() => { throw new TypeError("not async, still caught"); }), ["failed", "not async, still caught"]);
  assert.deepEqual(await outcome(() => Promise.reject("a bare string")), ["failed", "a bare string"]);
  const circular = {};
  circular.self = circular;
  assert.deepEqual(await outcome(async () => circular), ["failed", "The job returned a result that cannot be stored as JSON."]);
  assert.deepEqual(await outcome(async () => undefined), ["done", null]);
  assert.equal(jobEvents(businessId).filter((row) => row.type === "job.failed").length, 3);
});

test("cancelJob stops a running job: the signal fires, progress refuses, and a late result does not overwrite it", async () => {
  const businessId = seedBusiness();
  const gate = deferred();
  const entered = deferred();
  let context;
  let lateProgress;

  const jobId = jobs.startJob(businessId, "negotiation", {}, async (ctx) => {
    context = ctx;
    entered.resolve();
    await gate.promise;
    try {
      ctx.progress("still talking");
    } catch (err) {
      lateProgress = err;
    }
    return { agreed: true };
  });
  await entered.promise;
  assert.equal(repo.getJob(businessId, jobId).status, "running");

  assert.equal(jobs.cancelJob(businessId, jobId), true);
  assert.equal(context.signal.aborted, true);
  assert.equal(context.signal.reason.code, "JOB_CANCELLED");
  assert.equal(repo.getJob(businessId, jobId).status, "cancelled");

  gate.resolve();
  await jobs.whenSettled(jobId);
  const job = repo.getJob(businessId, jobId);
  assert.equal(job.status, "cancelled");
  assert.equal(job.result, null);
  assert.deepEqual(job.progress, []);
  assert.equal(lateProgress.code, "JOB_CANCELLED");
  assert.deepEqual(jobEvents(businessId).map((row) => row.type), ["job.started", "job.cancelled"]);
  assert.equal(jobs.cancelJob(businessId, jobId), false, "already cancelled");
});

test("a job cancelled while still queued never runs", async () => {
  const businessId = seedBusiness();
  let ran = false;
  const jobId = jobs.startJob(businessId, "sourcing", {}, async () => {
    ran = true;
  });
  assert.equal(jobs.cancelJob(businessId, jobId), true);
  await jobs.whenSettled(jobId);
  assert.equal(ran, false);
  assert.equal(repo.getJob(businessId, jobId).status, "cancelled");
  assert.deepEqual(jobEvents(businessId).map((row) => row.type), ["job.cancelled"]);
});

test("a finished job cannot be cancelled and its runner cannot report late progress", async () => {
  const businessId = seedBusiness();
  let context;
  const jobId = jobs.startJob(businessId, "sourcing", {}, async (ctx) => {
    context = ctx;
    return "ok";
  });
  await jobs.whenSettled(jobId);
  assert.equal(jobs.cancelJob(businessId, jobId), false);
  assert.throws(() => context.progress("too late"), hasCode("JOB_FINISHED"));
  assert.equal(repo.getJob(businessId, jobId).status, "done");
  assert.deepEqual(repo.getJob(businessId, jobId).progress, []);
});

test("a job belongs to its business: others cannot see, cancel or attach to it", async () => {
  const owner = seedBusiness("Owner");
  const other = seedBusiness("Other");
  const requirement = repo.createRequirement(owner, { item: "rice", quantity: 50, unit: "kg" });
  const gate = deferred();
  const jobId = jobs.startJob(owner, "sourcing", { requirementId: requirement.id }, () => gate.promise);

  assert.equal(repo.getJob(other, jobId), null);
  assert.throws(() => jobs.cancelJob(other, jobId), hasCode("JOB_NOT_FOUND"));
  assert.throws(() => jobs.startJob(other, "sourcing", { requirementId: requirement.id }, async () => {}), hasCode("NOT_FOUND"));
  assert.deepEqual(repo.listJobs(other), []);

  gate.resolve("done");
  await jobs.whenSettled(jobId);
  assert.equal(repo.getJob(owner, jobId).status, "done");
  assert.deepEqual(jobEvents(other), []);
});

test("startJob refuses an unknown kind or a missing runner without creating a job", () => {
  const businessId = seedBusiness();
  assert.throws(() => jobs.startJob(businessId, "payment", {}, async () => {}), hasCode("INVALID_KIND"));
  assert.throws(() => jobs.startJob(businessId, "sourcing", {}), hasCode("INVALID_RUNNER"));
  assert.throws(() => jobs.startJob("", "sourcing", {}, async () => {}), hasCode("BUSINESS_REQUIRED"));
  assert.deepEqual(repo.listJobs(businessId), []);
});

test("jobs left unfinished by a previous process are marked failed at boot, live ones are left alone", async () => {
  const businessId = seedBusiness();
  const orphanQueued = repo.createJob(businessId, { kind: "sourcing" });
  const orphanRunning = repo.createJob(businessId, { kind: "negotiation" });
  repo.transitionJob(businessId, orphanRunning.id, "queued", "running");
  const gate = deferred();
  const liveJobId = jobs.startJob(businessId, "sourcing", {}, () => gate.promise);

  assert.equal(jobs.failInterruptedJobs(), 2);
  for (const orphan of [orphanQueued, orphanRunning]) {
    const job = repo.getJob(businessId, orphan.id);
    assert.equal(job.status, "failed");
    assert.equal(job.error, "The server restarted before this job finished.");
  }
  const failures = jobEvents(businessId).filter((row) => row.type === "job.failed");
  assert.deepEqual(failures.map((row) => row.detail.code), ["INTERRUPTED", "INTERRUPTED"]);

  assert.notEqual(repo.getJob(businessId, liveJobId).status, "failed");
  gate.resolve({ ok: true });
  await jobs.whenSettled(liveJobId);
  assert.equal(repo.getJob(businessId, liveJobId).status, "done");
  assert.equal(jobs.failInterruptedJobs(), 0);
});

test("onSettled runs exactly once however a job ends: done, failed, or cancelled before it began", async () => {
  const businessId = seedBusiness();
  const settledCount = () => {
    const box = { n: 0 };
    box.fn = () => {
      box.n += 1;
    };
    return box;
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  const done = settledCount();
  const doneId = jobs.startJob(businessId, "sourcing", {}, async () => "ok", { onSettled: done.fn });
  assert.equal(done.n, 0, "not before the job has ended");
  await jobs.whenSettled(doneId);
  await tick();
  assert.equal(done.n, 1);

  const failed = settledCount();
  const failedId = jobs.startJob(businessId, "sourcing", {}, async () => {
    throw new Error("IndiaMART did not answer");
  }, { onSettled: failed.fn });
  await jobs.whenSettled(failedId);
  await tick();
  assert.equal(failed.n, 1);
  assert.equal(repo.getJob(businessId, failedId).status, "failed");

  const cancelled = settledCount();
  let ran = false;
  const cancelledId = jobs.startJob(businessId, "sourcing", {}, async () => {
    ran = true;
  }, { onSettled: cancelled.fn });
  jobs.cancelJob(businessId, cancelledId);
  await jobs.whenSettled(cancelledId);
  await tick();
  assert.equal(ran, false);
  assert.equal(cancelled.n, 1, "a slot taken for a job that never ran is still given back");

  // A failing onSettled is reported, never thrown into the job machinery.
  const boomId = jobs.startJob(businessId, "sourcing", {}, async () => "ok", {
    onSettled: () => {
      throw new Error("boom");
    },
  });
  await jobs.whenSettled(boomId);
  await tick();
  assert.equal(repo.getJob(businessId, boomId).status, "done");
  assert.throws(() => jobs.startJob(businessId, "sourcing", {}, async () => {}, { onSettled: "release" }), hasCode("INVALID_RUNNER"));
});
