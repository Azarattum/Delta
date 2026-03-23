import { SyncPromise, type MaybePromise } from "./promise";
import { Shared } from "./shared";

export class Scheduler {
  static #queue = new Set<Scheduler>();
  static #queued = false;

  #tasks: (() => MaybePromise<void>)[][];
  #pending: Set<Promise<void>> = new Set();
  #flushing: MaybePromise<void> | undefined;
  #level: number | undefined;

  constructor(levels: number) {
    this.#tasks = Array.from({ length: levels }, () => []);
  }

  static join(schedulers: Shared<Scheduler>[], levels: number) {
    if (!schedulers.length) return new Shared(new Scheduler(levels));
    const [first, ...rest] = schedulers;
    return Shared.join(first, ...rest);
  }

  enqueue(task: () => MaybePromise<void>, level: number) {
    if (this.#level === level) return this.#execute(task);
    this.#tasks[level].push(task);

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
      .reduce((promise, tasks, level) => {
        return promise.then(() => {
          this.#level = level;
          tasks.forEach((task) => this.#execute(task));
          this.#tasks[level].length = 0;

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
