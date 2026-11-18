"use strict";

/**
 * Background jobs. A tool that would take more than a moment starts a job and
 * returns its id at once; the work reports through events (`job.started`,
 * `job.progress`, `job.done`, `job.failed`, `job.cancelled`) and the job row.
 * A failure is never dropped: it is stored on the row and emitted.
 */

const events = require("./events");
const repo = require("./db/repo");

const KINDS = ["sourcing", "negotiation"];

class JobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "JobError";
    this.code = code;
  }
}

/** jobId -> { controller, settled } for the jobs this process is running. */
const running = new Map();

/**
 * Start a job and return its id immediately.
 * `runner(ctx)` receives `{ jobId, businessId, input, progress(message, data), signal }`.
 * It should watch `signal` (or call `progress`, which throws once the job is cancelled)
 * and return a JSON-serialisable result.
 */
function startJob(businessId, kind, input, runner) {
  if (!KINDS.includes(kind)) throw new JobError("INVALID_KIND", `A job is one of: ${KINDS.join(", ")}.`);
  if (typeof runner !== "function") throw new JobError("INVALID_RUNNER", "A job needs a runner function.");

  const job = repo.createJob(businessId, { kind, requirement_id: input?.requirementId });
  const controller = new AbortController();
  const settled = new Promise((resolve) => setImmediate(() => resolve(run(job, input, runner, controller))));
  running.set(job.id, { controller, settled });
  settled.finally(() => running.delete(job.id));
  return job.id;
}

async function run(job, input, runner, controller) {
  const { id: jobId, business_id: businessId, kind } = job;
  if (!repo.transitionJob(businessId, jobId, "queued", "running")) return; // cancelled before it began
  events.emit(businessId, "job.started", { jobId, kind, input: input ?? null });

  let finished = false;
  const ctx = {
    jobId,
    businessId,
    input,
    signal: controller.signal,
    progress(message, data) {
      controller.signal.throwIfAborted();
      if (finished) throw new JobError("JOB_FINISHED", "This job has already finished.");
      const entry = { ts: new Date().toISOString(), message: String(message), ...(data === undefined ? {} : { data }) };
      repo.appendJobProgress(businessId, jobId, entry);
      events.emit(businessId, "job.progress", { jobId, kind, message: entry.message, ...(data === undefined ? {} : { data }) });
    },
  };

  let result;
  try {
    result = storable(await runner(ctx));
  } catch (err) {
    finished = true;
    // A cancelled job stays cancelled; anything else is a failure with its reason on record.
    const message = err instanceof Error ? err.message : String(err);
    if (repo.transitionJob(businessId, jobId, "running", "failed", { error: message })) {
      events.emit(businessId, "job.failed", { jobId, kind, error: message, ...(err?.code ? { code: String(err.code) } : {}) });
    }
    return;
  }
  finished = true;
  if (repo.transitionJob(businessId, jobId, "running", "done", { result })) {
    events.emit(businessId, "job.done", { jobId, kind, result });
  }
}

function storable(result) {
  try {
    return JSON.parse(JSON.stringify(result ?? null));
  } catch {
    throw new JobError("INVALID_RESULT", "The job returned a result that cannot be stored as JSON.");
  }
}

/**
 * Cancel a queued or running job of this business. Returns false when the job
 * had already finished. The runner is told through `ctx.signal`.
 */
function cancelJob(businessId, jobId) {
  const job = repo.getJob(businessId, jobId);
  if (!job) throw new JobError("JOB_NOT_FOUND", `No job ${jobId} for this business.`);
  const cancelled =
    repo.transitionJob(businessId, jobId, "running", "cancelled") || repo.transitionJob(businessId, jobId, "queued", "cancelled");
  if (!cancelled) return false;
  running.get(jobId)?.controller.abort(new JobError("JOB_CANCELLED", "The job was cancelled."));
  events.emit(businessId, "job.cancelled", { jobId, kind: job.kind });
  return true;
}

/** Resolves when a job started by this process has finished, failed or been cancelled. */
function whenSettled(jobId) {
  return running.get(jobId)?.settled ?? Promise.resolve();
}

/**
 * Call once at boot. Jobs left queued or running by a previous process have no
 * runner any more; mark them failed so nothing waits on them forever.
 */
function failInterruptedJobs() {
  const interrupted = repo.system.listUnfinishedJobs().filter((job) => !running.has(job.id));
  for (const job of interrupted) {
    const error = "The server restarted before this job finished.";
    const failed =
      repo.transitionJob(job.business_id, job.id, "running", "failed", { error }) ||
      repo.transitionJob(job.business_id, job.id, "queued", "failed", { error });
    if (failed) events.emit(job.business_id, "job.failed", { jobId: job.id, kind: job.kind, error, code: "INTERRUPTED" });
  }
  return interrupted.length;
}

module.exports = { JobError, KINDS, startJob, cancelJob, whenSettled, failInterruptedJobs };
