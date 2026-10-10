import { SyncPromise, type MaybePromise } from "./promise";
import { Shared } from "./shared";

export class Scheduler {
  static #queue = new Set<Scheduler>();
  static #queued = false;

  #tasks: (() => MaybePromise<void>)[][];
  #pending: Set<Promise<void>> = new Set();
  #flushing: MaybePromise<void> | undefined;
  #level: number | undefined;
  #draining = false;

  constructor(levels: number) {
    this.#tasks = Array.from({ length: levels }, () => []);
  }

  static join(schedulers: Shared<Scheduler>[], levels: number) {
    if (!schedulers.length) return new Shared(new Scheduler(levels));
    const [first, ...rest] = schedulers;
    return Shared.join(first, ...rest);
  }

  enqueue(task: () => MaybePromise<void>, level: number) {
    this.#tasks[level].push(task);
    if (this.#level === level) return this.#drain(level);

    if (Scheduler.#queue.has(this)) return;
    Scheduler.#queue.add(this);

    if (Scheduler.#queued) return;
    Scheduler.#queued = true;

    queueMicrotask(() => {
      Scheduler.#queue.forEach((x) => x.flush());
      Scheduler.#queue.clear();
      Scheduler.#queued = false;
    });
  }

  flush(): MaybePromise<void> {
    Scheduler.#queue.delete(this);
    if (this.#level !== undefined) return this.#flushing;
    return (this.#flushing = this.#tasks
      .reduce((promise, _, level) => {
        return promise.then(() => {
          this.#level = level;
          this.#drain(level);

          const process = (): Promise<void> => {
            if (!this.#pending.size) return Promise.resolve();
            return Promise.all(this.#pending).then(process);
          };

          return SyncPromise.one(this.#pending.size ? process() : undefined);
        });
      }, SyncPromise.one<void>(undefined))
      .then(() => {
        this.#flushing = undefined;
        this.#level = undefined;
        if (this.#tasks.some((x) => x.length)) return this.flush();
      }));
  }

  #drain(level: number) {
    if (this.#draining) return;
    this.#draining = true;
    const tasks = this.#tasks[level];
    for (let i = 0; i < tasks.length; i++) this.#execute(tasks[i]);
    tasks.length = 0;
    this.#draining = false;
  }

  #execute(task: () => void | Promise<void>) {
    const result = SyncPromise.try(task).catch((error) => {
      console.error("Unhandled error during task execution", error);
    });

    if (result instanceof Promise) {
      this.#pending.add(result);
      result.finally(() => this.#pending.delete(result));
    }
  }
}
