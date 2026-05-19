import { expect, expectTypeOf, it, mock } from "bun:test";
import { stream } from "../../stream";
import { channel } from "./channel";

it("transmits over BroadcastChannel", async () => {
  const name = crypto.randomUUID();
  const [tx] = channel(new BroadcastChannel(name));

  const source = stream({
    push: (x: number) => x,
    pull: (x?: number) => x ?? 0,
  })(null);
  using sender = tx(source);

  const [, rx] = channel(new BroadcastChannel(name));

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

it("transmits over MessageChannel", async () => {
  const { port1, port2 } = new MessageChannel();
  const [tx] = channel(port1);

  const source = stream({
    push: (x: number) => x,
    pull: (x?: number) => x ?? 0,
  })(null);
  using sender = tx(source);

  const [, rx] = channel(port2);

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
