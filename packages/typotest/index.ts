import { expect } from "bun:test";

type Extends<X, Y> = X extends Y ? any : [X, "does not extend", Y];
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? any
  : [Y, "does not equal to", X];

declare module "bun:test" {
  interface Matchers<T> {
    toExtendType<U extends Extends<T, U>>(): any;
    toBeOfType<U extends Equal<U, T>>(): any;
    toIncludeType<U extends T>(): any;
  }

  interface Matchers<T extends (..._: any[]) => any> {
    toHaveReturnTypeExtend<U extends Extends<ReturnType<T>, U>>(): any;
    toHaveReturnTypeOf<U extends Equal<U, ReturnType<T>>>(): any;
    toHaveReturnTypeInclude<U extends ReturnType<T>>(): any;
  }
}

expect.extend({
  toBeOfType: () => ({ pass: true }),
  toExtendType: () => ({ pass: true }),
  toIncludeType: () => ({ pass: true }),
  toHaveReturnTypeOf: () => ({ pass: true }),
  toHaveReturnTypeExtend: () => ({ pass: true }),
  toHaveReturnTypeInclude: () => ({ pass: true }),
});
