import { stream, SyncPromise, type Stream } from "../../stream";

export function channel(channel: Channel) {
  const tx = <TStream extends Stream<any>>(upstream: TStream) => {
    type TData = TStream extends Stream<infer T, any[], any> ? T : never;
    type TOpt = TStream extends Stream<any, any[], infer T> ? T : never;

    return stream({
      push: (x: TData) => x,
      init() {
        const handle = (event: MessageEvent<Message<TData, TOpt>>) => {
          if (event.data.type === "pull") {
            SyncPromise.one(upstream.pull(event.data.options)).then((data) => {
              channel.postMessage({ id: event.data.id, type: "yield", data });
            });
          }
        };
        channel.addEventListener("message", handle);
        return () => channel.removeEventListener("message", handle);
      },
      flush(messages) {
        const id = crypto.randomUUID();
        return SyncPromise.all(messages.flat()).then((data) =>
          channel.postMessage({ id, type: "push", data }),
        );
      },
    })(upstream);
  };

  const rx = <TData, TOpt>() => {
    const node = stream({
      init() {
        const handle = async (event: MessageEvent<Message<TData, TOpt>>) => {
          if (event.data.type === "push") {
            event.data.data.forEach((x) => node.push(x));
          }
        };
        channel.addEventListener("message", handle);
        return () => channel.removeEventListener("message", handle);
      },
      pull(options?: TOpt) {
        const id = crypto.randomUUID();
        // TODO: timeout/abort signal/error response?
        return new Promise<TData>((resolve) => {
          const handle = (event: MessageEvent<Message<TData, TOpt>>) => {
            // TODO: support multi-peer pulls (currently only the first response will be processed)
            if (event.data.type === "yield" && event.data.id === id) {
              resolve(event.data.data);
              channel.removeEventListener("message", handle);
            }
          };
          channel.addEventListener("message", handle);
          channel.postMessage({ id, type: "pull", options });
        });
      },
    })(null);
    return node as Stream<Promise<Awaited<TData>>, never, TOpt>;
  };

  return [tx, rx] as const;
}

export type Channel = {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
};

type Message<TData = unknown, TOptions = unknown> = { id: string } & (
  | { type: "pull"; options: TOptions }
  | { type: "yield"; data: Awaited<TData> }
  | { type: "push"; data: Awaited<TData>[] }
);
