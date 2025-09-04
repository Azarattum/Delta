export class Shared<T> {
  #current: T | Shared<T>;
  #parent: Shared<T> = this;

  constructor(initial: T) {
    this.#current = initial;
  }

  get current(): T {
    return this.#root.#current as T;
  }

  set current(value: T | Shared<T>) {
    this.#root.#current = value;
  }

  get #root(): Shared<T> {
    while (this.#parent.#current instanceof Shared) {
      this.#parent = this.#parent.#current;
    }
    return this.#parent;
  }

  static join<T>(source: Shared<T>, ...targets: Shared<T>[]) {
    const root = source.#root;
    targets.filter((x) => x.#root !== root).forEach((x) => (x.current = root));
    return source;
  }
}
