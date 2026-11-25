import { describe, expect, it } from "@effect/vitest";
import {
  OrchestratorMcpFailure,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  FORK_DELEGATION_TARGET_DISALLOWED_CONSTRAINT,
  forkAssertDelegationTargetAllowed,
  forkAssertRemoteDelegationAllowed,
  forkDelegationTargetConstraints,
  formatDisallowedDelegationTargetMessage,
  readAllowedDelegationTargets,
} from "./delegationTargets.ts";

const failure = (code: OrchestratorMcpFailure["code"], message: string): OrchestratorMcpFailure =>
  new OrchestratorMcpFailure({ code, message });

const claudeWork = ProviderInstanceId.make("claudeWork");
const claudeAgent = ProviderInstanceId.make("claudeAgent");
const antigravity = ProviderInstanceId.make("antigravity");
const codex = ProviderInstanceId.make("codex");

const makeSettings = (
  providerInstances: ServerSettings["providerInstances"],
): Pick<ServerSettings, "providerInstances"> => ({ providerInstances });

describe("readAllowedDelegationTargets", () => {
  it("returns undefined when the caller instance or field is absent", () => {
    const empty = makeSettings({});
    expect(readAllowedDelegationTargets(empty, claudeWork)).toBeUndefined();

    const unrestricted = makeSettings({
      [claudeWork]: { driver: ProviderDriverKind.make("claudeAgent") },
    });
    expect(readAllowedDelegationTargets(unrestricted, claudeWork)).toBeUndefined();
  });

  it("returns an empty array or the configured list when present", () => {
    const blocked = makeSettings({
      [claudeWork]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        allowedDelegationTargets: [],
      },
    });
    expect(readAllowedDelegationTargets(blocked, claudeWork)).toEqual([]);

    const restricted = makeSettings({
      [claudeWork]: {
        driver: ProviderDriverKind.make("claudeAgent"),
        allowedDelegationTargets: [claudeWork, codex],
      },
    });
    expect(readAllowedDelegationTargets(restricted, claudeWork)).toEqual([claudeWork, codex]);
  });
});

describe("formatDisallowedDelegationTargetMessage", () => {
  it("formats non-empty and empty lists clearly", () => {
    expect(formatDisallowedDelegationTargetMessage([claudeWork])).toBe(
      "This provider instance may delegate only to: claudeWork.",
    );
    expect(formatDisallowedDelegationTargetMessage([claudeWork, codex])).toBe(
      "This provider instance may delegate only to: claudeWork, codex.",
    );
    expect(formatDisallowedDelegationTargetMessage([])).toBe(
      "This provider instance cannot delegate.",
    );
  });
});

describe("forkDelegationTargetConstraints", () => {
  const settings = makeSettings({
    [claudeWork]: {
      driver: ProviderDriverKind.make("claudeAgent"),
      allowedDelegationTargets: [claudeWork],
    },
    [codex]: {
      driver: ProviderDriverKind.make("codex"),
      allowedDelegationTargets: [],
    },
  });

  it("returns no constraints when caller is undefined or has no list", () => {
    expect(
      forkDelegationTargetConstraints({
        settings,
        callerInstanceId: undefined,
        targetInstanceId: antigravity,
      }),
    ).toEqual([]);
    expect(
      forkDelegationTargetConstraints({
        settings,
        callerInstanceId: claudeAgent,
        targetInstanceId: antigravity,
      }),
    ).toEqual([]);
  });

  it("marks only targets absent from the caller list", () => {
    expect(
      forkDelegationTargetConstraints({
        settings,
        callerInstanceId: claudeWork,
        targetInstanceId: claudeWork,
      }),
    ).toEqual([]);
    expect(
      forkDelegationTargetConstraints({
        settings,
        callerInstanceId: claudeWork,
        targetInstanceId: claudeAgent,
      }),
    ).toEqual([FORK_DELEGATION_TARGET_DISALLOWED_CONSTRAINT]);
    expect(
      forkDelegationTargetConstraints({
        settings,
        callerInstanceId: codex,
        targetInstanceId: codex,
      }),
    ).toEqual([FORK_DELEGATION_TARGET_DISALLOWED_CONSTRAINT]);
  });
});

describe("forkAssertDelegationTargetAllowed", () => {
  const settings = makeSettings({
    [claudeWork]: {
      driver: ProviderDriverKind.make("claudeAgent"),
      allowedDelegationTargets: [claudeWork],
    },
    [codex]: {
      driver: ProviderDriverKind.make("codex"),
      allowedDelegationTargets: [],
    },
  });

  it.effect("allows any target when the caller has no list", () =>
    forkAssertDelegationTargetAllowed({
      settings,
      callerInstanceId: claudeAgent,
      targetInstanceId: antigravity,
      failure,
    }),
  );

  it.effect("allows targets in the caller list and blocks targets outside it", () =>
    Effect.gen(function* () {
      yield* forkAssertDelegationTargetAllowed({
        settings,
        callerInstanceId: claudeWork,
        targetInstanceId: claudeWork,
        failure,
      });

      const blocked = yield* Effect.flip(
        forkAssertDelegationTargetAllowed({
          settings,
          callerInstanceId: claudeWork,
          targetInstanceId: antigravity,
          failure,
        }),
      );
      expect(blocked.code).toBe("invalid_request");
      expect(blocked.message).toBe("This provider instance may delegate only to: claudeWork.");
    }),
  );

  it.effect("blocks all targets when the list is empty", () =>
    Effect.gen(function* () {
      const blocked = yield* Effect.flip(
        forkAssertDelegationTargetAllowed({
          settings,
          callerInstanceId: codex,
          targetInstanceId: codex,
          failure,
        }),
      );
      expect(blocked.code).toBe("invalid_request");
      expect(blocked.message).toBe("This provider instance cannot delegate.");
    }),
  );
});

describe("forkAssertRemoteDelegationAllowed", () => {
  const settings = makeSettings({
    [claudeWork]: {
      driver: ProviderDriverKind.make("claudeAgent"),
      allowedDelegationTargets: [claudeWork],
    },
    [codex]: {
      driver: ProviderDriverKind.make("codex"),
      allowedDelegationTargets: [],
    },
  });

  it.effect("allows remote delegation when the caller has no list", () =>
    forkAssertRemoteDelegationAllowed({
      settings,
      callerInstanceId: claudeAgent,
      failure,
    }),
  );

  it.effect("blocks remote delegation whenever a list exists", () =>
    Effect.gen(function* () {
      const restricted = yield* Effect.flip(
        forkAssertRemoteDelegationAllowed({
          settings,
          callerInstanceId: claudeWork,
          failure,
        }),
      );
      expect(restricted.code).toBe("invalid_request");
      expect(restricted.message).toBe("This provider instance may delegate only to: claudeWork.");

      const empty = yield* Effect.flip(
        forkAssertRemoteDelegationAllowed({
          settings,
          callerInstanceId: codex,
          failure,
        }),
      );
      expect(empty.code).toBe("invalid_request");
      expect(empty.message).toBe("This provider instance cannot delegate.");
    }),
  );
});
