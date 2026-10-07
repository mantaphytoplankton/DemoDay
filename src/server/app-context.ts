import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getEnv, type Env } from "./env.ts";
import { FsStore } from "./store/fs-store.ts";
import { EvaluationRepo } from "./store/evaluations.ts";
import { BatchRepo } from "./store/batches.ts";
import { EventBus } from "./jobs/events.ts";
import { Lane } from "./jobs/runner.ts";
import { runSingleEvaluation } from "./jobs/single-job.ts";
import { runBatch } from "./jobs/batch-job.ts";
import { recover } from "./jobs/recovery.ts";
import { createJudgeDeps } from "./agent/factory.ts";
import { createDriveClient } from "./drive/factory.ts";
import type { DriveClient } from "./drive/client.ts";
import { setLogDir } from "./log.ts";

export interface AppContext {
  env: Env;
  store: FsStore;
  evaluations: EvaluationRepo;
  batches: BatchRepo;
  bus: EventBus;
  singleLane: Lane;
  batchLane: Lane;
  drive: DriveClient | null;
  enqueueSingle(id: string): void;
  enqueueBatch(id: string): void;
  requestPause(id: string): void;
  clearPause(id: string): void;
  ready: Promise<void>;
}

const g = globalThis as unknown as { __demoday?: AppContext };

/** Process-wide singletons on globalThis so dev hot reload never starts a second runner. */
export function getApp(): AppContext {
  if (g.__demoday) return g.__demoday;
  const env = getEnv();
  const store = new FsStore(env.dataDir);
  const evaluations = new EvaluationRepo(store);
  const batches = new BatchRepo(store);
  const bus = new EventBus();
  const singleLane = new Lane("single");
  const batchLane = new Lane("batch");
  const judgeDeps = () => createJudgeDeps(env);
  const pauseRequests = new Set<string>();
  setLogDir(path.join(env.dataDir, "logs"));

  const app: AppContext = {
    env,
    store,
    evaluations,
    batches,
    bus,
    singleLane,
    batchLane,
    drive: null,
    ready: Promise.resolve(),
    enqueueSingle(id) {
      singleLane.enqueue(id, (signal) => runSingleEvaluation(id, { dataDir: env.dataDir, repo: evaluations, bus, judgeDeps }, signal));
    },
    enqueueBatch(id) {
      batchLane.enqueue(id, (signal) =>
        runBatch(
          id,
          {
            dataDir: env.dataDir,
            maxBytes: env.maxUploadBytes,
            repo: batches,
            bus,
            judgeDeps,
            drive: () => app.drive!,
            takePauseRequest: (b) => pauseRequests.delete(b),
          },
          signal,
        ),
      );
    },
    requestPause(id) {
      pauseRequests.add(id);
    },
    clearPause(id) {
      pauseRequests.delete(id);
    },
  };
  app.ready = (async () => {
    await mkdir(path.join(env.dataDir, "uploads"), { recursive: true });
    app.drive = await createDriveClient(env);
    const deps = await judgeDeps();
    await recover(env.dataDir, evaluations, deps.provider, batches);
  })();
  g.__demoday = app;
  return app;
}

/** Tests only: drop singletons so the next getApp() reads fresh configuration. */
export async function resetAppForTests(): Promise<void> {
  const app = g.__demoday;
  if (app) {
    app.singleLane.abortAll();
    app.batchLane.abortAll();
    await Promise.all([app.singleLane.idle(), app.batchLane.idle()]);
  }
  delete g.__demoday;
}
