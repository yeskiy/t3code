import { assert, it } from "@effect/vitest";

import { withoutProtocolRegistration } from "./ForkProtocolGuard.ts";

const fakeApp = () => {
  const calls: Array<string> = [];
  const app = {
    setAsDefaultProtocolClient: (protocol: string) => {
      calls.push(protocol);
      return true;
    },
  };
  return { app, calls, original: app.setAsDefaultProtocolClient };
};

it("blocks scheme registration only while create runs", () => {
  const { app, calls, original } = fakeApp();
  const result = withoutProtocolRegistration(
    true,
    () => app.setAsDefaultProtocolClient("t3code"),
    app,
  );
  assert.isFalse(result);
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(app.setAsDefaultProtocolClient, original);
});

it("restores registration when create throws", () => {
  const { app, original } = fakeApp();
  assert.throws(() =>
    withoutProtocolRegistration(
      true,
      () => {
        throw new Error("bridge failed");
      },
      app,
    ),
  );
  assert.strictEqual(app.setAsDefaultProtocolClient, original);
});

it("registers the scheme as upstream does when the override is unset", () => {
  const { app, calls } = fakeApp();
  assert.isTrue(
    withoutProtocolRegistration(false, () => app.setAsDefaultProtocolClient("t3code"), app),
  );
  assert.deepStrictEqual(calls, ["t3code"]);
});
