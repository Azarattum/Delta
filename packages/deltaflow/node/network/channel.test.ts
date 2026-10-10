import { expect, expectTypeOf, it, mock } from "bun:test";
import type { CLSet } from "../../datastructure/clset";
import { stream } from "../../stream";
import { channel } from "./channel";

it.each([
  {
    name: "BroadcastChannel",
    pair() {
      const name = crypto.randomUUID();
      return [new BroadcastChannel(name), new BroadcastChannel(name)];
    },
  },
  {
    name: "MessageChannel",
    pair() {
      const { port1, port2 } = new MessageChannel();
      return [port1, port2];
    },
  },
])("transmits over $name", async ({ pair }) => {
  const [a, b] = pair();
  const [tx] = channel<number>(a);
  const [, rx] = channel<number>(b);
  const source = stream({
    push: (x: number) => x,
    pull: (x?: number) => x ?? 0,
  })(null);
  using sender = tx(source);
  using receiver = rx<number, number>();
  const receive = mock();

  expectTypeOf(sender.push).parameters.toEqualTypeOf<[number]>();
  expectTypeOf(receiver.push).parameters.toEqualTypeOf<never>();
  expectTypeOf(receiver.pull).returns.toEqualTypeOf<Promise<number>>();

  receiver.connect(receive);

  source.push(1);
  sender.flush();

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(receive).toHaveBeenCalledWith(1);

  expect(await receiver.pull()).toBe(0);
  expect(await receiver.pull(42)).toBe(42);
});

it("transmits bidirectionally", async () => {
  const { port1, port2 } = new MessageChannel();
  const [tx1, rx1] = channel(port1);
  const [tx2, rx2] = channel(port2);

  const source1 = stream({
    push: (x: number) => x,
    pull: (x?: number) => x ?? 0,
  })(null);
  using sender1 = tx1(source1);

  const source2 = stream({
    push: (x: number) => x,
    pull: (x?: number) => x ?? 0,
  })(null);
  using sender2 = tx2(source2);

  using receiver1 = rx1<number, number>();
  using receiver2 = rx2<number, number>();

  const receive1 = mock();
  const receive2 = mock();

  receiver1.connect(receive1);
  receiver2.connect(receive2);

  source1.push(1);
  sender1.flush();

  source2.push(2);
  sender2.flush();

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(receive1).toHaveBeenCalledWith(2);
  expect(receive2).toHaveBeenCalledWith(1);

  expect(await receiver1.pull()).toBe(0);
  expect(await receiver1.pull(42)).toBe(42);

  expect(await receiver2.pull()).toBe(0);
  expect(await receiver2.pull(42)).toBe(42);
});

it("types channel payloads", () => {
  type Note = { id: number; text: string };

  const [tx, rx] = channel<CLSet<Note>>(
    new BroadcastChannel(crypto.randomUUID()),
  );

  const notes = stream({
    push: (x: CLSet<Note>) => x,
    pull: () => [[], []] as CLSet<Note>,
  })(null);

  const sender = tx(notes);
  const receiver = rx();

  expectTypeOf(sender.push).parameters.toEqualTypeOf<[CLSet<Note>]>();
  expectTypeOf(sender.pull).returns.toEqualTypeOf<CLSet<Note>>();
  expectTypeOf(receiver.pull).returns.toEqualTypeOf<Promise<CLSet<Note>>>();
});

it("allows narrower channel payloads", () => {
  const [tx, rx] = channel<number>(new BroadcastChannel(crypto.randomUUID()));

  const ones = stream({
    push: (x: 1) => x,
    pull: () => 1 as const,
  })(null);

  const sender = tx(ones);
  const receiver = rx<1>();

  expectTypeOf(sender.push).parameters.toEqualTypeOf<[number]>();
  expectTypeOf(sender.pull).returns.toEqualTypeOf<1>();
  expectTypeOf(receiver.pull).returns.toEqualTypeOf<Promise<1>>();
});

it("consumes transmitted changes and accepts direct pushes", () => {
  const postMessage = mock();
  const addEventListener = mock();
  const removeEventListener = mock();
  const [tx] = channel({
    postMessage,
    addEventListener,
    removeEventListener,
  });
  const dispose = mock();
  const source = stream({
    init: () => dispose,
    push: (x: { id: number }) => x,
    pull: () => ({ id: 0 }),
  })(null);
  using sender = tx(source);

  const disconnect = sender.connect(mock());
  disconnect();
  expect(dispose).not.toHaveBeenCalled();

  const forward = mock();
  sender.connect(forward);
  expect(sender.pull()).toEqual({ id: 0 });
  expect(postMessage).not.toHaveBeenCalled();

  const message = { id: 1 };
  source.push(message);
  expect(sender.flush()).toBe(undefined);

  expect(forward).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(postMessage.mock.calls[0][0]).toMatchObject({
    type: "push",
    data: [message],
  });
  expect(postMessage.mock.calls[0][0].data[0]).toBe(message);

  sender.pull();
  sender.flush();
  expect(postMessage).toHaveBeenCalledTimes(1);

  const direct = { id: 2 };
  sender.push(direct);
  sender.flush();
  expect(forward).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledTimes(2);
  expect(postMessage.mock.calls[1][0].data).toEqual([direct]);

  sender[Symbol.dispose]();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(removeEventListener.mock.calls).toEqual(addEventListener.mock.calls);

  source.push({ id: 3 });
  source.flush();
  expect(postMessage).toHaveBeenCalledTimes(2);
});
