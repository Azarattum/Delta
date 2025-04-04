import { expect, it, mock } from "bun:test";
import { Scheduler } from "./scheduler";
import { spyOn } from "bun:test";

it("handles sync tasks", async () => {
  const scheduler = new Scheduler(2);
  const order: number[] = [];

  const task1 = mock(() => void order.push(1));
  const task2 = mock(() => void order.push(2));
  const task3 = mock(() => void order.push(3));

  scheduler.enqueue(task1, 0);
  scheduler.enqueue(task3, 1);
  scheduler.enqueue(task2, 0);

  expect(task1).not.toHaveBeenCalled();
  expect(task2).not.toHaveBeenCalled();
  expect(task3).not.toHaveBeenCalled();

  scheduler.flush();

  expect(task1).toHaveBeenCalledTimes(1);
  expect(task2).toHaveBeenCalledTimes(1);
  expect(task3).toHaveBeenCalledTimes(1);
  expect(order).toEqual([1, 2, 3]);
});

it("handles async tasks", async () => {
  const scheduler = new Scheduler(2);
  const order: number[] = [];

  const task1 = mock(() => Promise.resolve().then(() => void order.push(1)));
  const task2 = mock(() => Promise.resolve().then(() => void order.push(2)));
  const task3 = mock(() => Promise.resolve().then(() => void order.push(3)));

  scheduler.enqueue(task1, 0);
  scheduler.enqueue(task3, 1);
  scheduler.enqueue(task2, 0);

  expect(order).toEqual([]);
  await scheduler.flush();

  expect(task1).toHaveBeenCalledTimes(1);
  expect(task2).toHaveBeenCalledTimes(1);
  expect(task3).toHaveBeenCalledTimes(1);
  expect(order).toEqual([1, 2, 3]);
});

it("handles mixed sync and async tasks", async () => {
  const scheduler = new Scheduler(2);
  const order: number[] = [];

  const task1 = mock(() => void order.push(1));
  const task2 = mock(() => Promise.resolve().then(() => void order.push(2)));
  const task3 = mock(() => void order.push(3));
  const task4 = mock(() => Promise.resolve().then(() => void order.push(4)));

  scheduler.enqueue(task4, 1);
  scheduler.enqueue(task1, 0);
  scheduler.enqueue(task2, 0);
  scheduler.enqueue(task3, 1);

  expect(task1).not.toHaveBeenCalled();
  expect(task2).not.toHaveBeenCalled();
  expect(task3).not.toHaveBeenCalled();
  expect(task4).not.toHaveBeenCalled();

  const promise = scheduler.flush();
  expect(promise).toBeInstanceOf(Promise);

  expect(order).toEqual([1]);
  await promise;

  expect(task1).toHaveBeenCalledTimes(1);
  expect(task2).toHaveBeenCalledTimes(1);
  expect(task3).toHaveBeenCalledTimes(1);
  expect(task4).toHaveBeenCalledTimes(1);
  expect(order).toEqual([1, 2, 3, 4]);
});

it("handles multiple flushes", async () => {
  const scheduler = new Scheduler(2);
  const order: number[] = [];

  const task1 = mock(() => Promise.resolve().then(() => void order.push(1)));
  const task2 = mock(() => Promise.resolve().then(() => void order.push(2)));

  scheduler.enqueue(task1, 0);
  scheduler.enqueue(task2, 0);

  const flush1 = scheduler.flush();
  const flush2 = scheduler.flush();
  expect(flush1).toBe(flush2);

  expect(order).toEqual([]);
  await flush1;

  expect(task1).toHaveBeenCalledTimes(1);
  expect(task2).toHaveBeenCalledTimes(1);
  expect(order).toEqual([1, 2]);
});

it("propagates errors during flush", async () => {
  const scheduler = new Scheduler(2);
  const order: number[] = [];

  const task1 = mock(() => void order.push(1));
  const task2 = mock(() => {
    throw new Error("Task 2 failed");
  });
  const task3 = mock(() => void order.push(3));
  const task4 = mock(() => void order.push(4));

  scheduler.enqueue(task1, 0);
  scheduler.enqueue(task2, 0);
  scheduler.enqueue(task3, 0);
  scheduler.enqueue(task4, 1);

  const consoleErrorMock = spyOn(console, "error").mockImplementation(() => {});
  scheduler.flush();
  expect(consoleErrorMock).toHaveBeenCalledTimes(1);
  consoleErrorMock.mockRestore();

  expect(task1).toHaveBeenCalledTimes(1);
  expect(task2).toHaveBeenCalledTimes(1);
  expect(task3).toHaveBeenCalledTimes(1);
  expect(task4).toHaveBeenCalledTimes(1);
  expect(order).toEqual([1, 3, 4]);
});

it("handles recursive tasks", () => {
  const scheduler = new Scheduler(2);
  const order: number[] = [];

  const task1 = mock(() => {
    order.push(1);
    scheduler.enqueue(task2, 0);
  });
  const task2 = mock(() => {
    order.push(2);
    scheduler.enqueue(task3, 1);
  });
  const task3 = mock(() => void order.push(3));

  scheduler.enqueue(task1, 0);

  expect(task1).not.toHaveBeenCalled();
  expect(task2).not.toHaveBeenCalled();
  expect(task3).not.toHaveBeenCalled();

  scheduler.flush();

  expect(task1).toHaveBeenCalledTimes(1);
  expect(task2).toHaveBeenCalledTimes(1);
  expect(task3).toHaveBeenCalledTimes(1);
  expect(order).toEqual([1, 2, 3]);
});

it("handles async recursive tasks", async () => {
  const scheduler = new Scheduler(2);
  const order: number[] = [];

  const task1 = mock(() => {
    return Promise.resolve().then(() => {
      order.push(1);
      scheduler.enqueue(task2, 0);
    });
  });
  const task2 = mock(() => {
    return Promise.resolve().then(() => {
      order.push(2);
      scheduler.enqueue(task3, 1);
    });
  });
  const task3 = mock(() => {
    return Promise.resolve().then(() => {
      order.push(3);
    });
  });

  scheduler.enqueue(task1, 0);
  scheduler.enqueue(task3, 1);

  expect(task1).not.toHaveBeenCalled();
  expect(task2).not.toHaveBeenCalled();
  expect(task3).not.toHaveBeenCalled();

  await scheduler.flush();

  expect(task1).toHaveBeenCalledTimes(1);
  expect(task2).toHaveBeenCalledTimes(1);
  expect(task3).toHaveBeenCalledTimes(2);
  expect(order).toEqual([1, 2, 3, 3]);
});

it("handles mixed recursive tasks", async () => {
  const scheduler = new Scheduler(2);
  const order: number[] = [];

  const task1 = mock(() => {
    order.push(1);
    scheduler.enqueue(task2, 0);
  });
  const task2 = mock(() => {
    return Promise.resolve().then(() => {
      order.push(2);
      scheduler.enqueue(task3, 1);
    });
  });
  const task3 = mock(() => {
    order.push(3);
    scheduler.enqueue(task4, 0);
  });
  const task4 = mock(() => {
    return Promise.resolve().then(() => {
      order.push(4);
    });
  });

  scheduler.enqueue(task1, 0);

  expect(task1).not.toHaveBeenCalled();
  expect(task2).not.toHaveBeenCalled();
  expect(task3).not.toHaveBeenCalled();
  expect(task4).not.toHaveBeenCalled();

  await scheduler.flush();
  expect(task1).toHaveBeenCalledTimes(1);
  expect(task2).toHaveBeenCalledTimes(1);
  expect(task3).toHaveBeenCalledTimes(1);
  expect(task4).toHaveBeenCalledTimes(1);
  expect(order).toEqual([1, 2, 3, 4]);
});
