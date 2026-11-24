import * as NodeModule from "node:module";

import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";
import { describe, expect, it } from "vite-plus/test";

type ProviderArgs = ConstructorParameters<typeof GitHubProvider>;

// electron-updater's own dependency, which apps/desktop does not declare.
const semver = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("electron-updater"),
)("semver") as { parse: (version: string) => ProviderArgs[1]["currentVersion"] };

describe("fork update feed", () => {
  it("routes fork versions to the latest channel and sorts them above upstream nightlies", () => {
    expect(desktopUpdateChannelOf("0.1.13-fork.1")).toBe("latest");
    expect(desktopUpdateChannelOf("0.1.13-fork.10")).toBe("latest");
    expect(compareSemverVersions("0.1.13-fork.1", "0.1.12-nightly.20261120.5009")).toBeGreaterThan(
      0,
    );
    expect(compareSemverVersions("0.1.13-fork.10", "0.1.13-fork.9")).toBeGreaterThan(0);
  });

  it("queries only yeskiy/t3code releases/latest and latest.yml on the stable channel", async () => {
    const requestedPaths: Array<string> = [];
    const request = async ({ path = "" }: { readonly path?: string | null }) => {
      const normalized = path ?? "";
      requestedPaths.push(normalized);
      if (normalized === "/yeskiy/t3code/releases.atom") {
        return `<feed xmlns="http://www.w3.org/2005/Atom"><entry><link rel="alternate" type="text/html" href="https://github.com/yeskiy/t3code/releases/tag/v0.1.13-fork.3"/><title>T3 Code fork 0.1.13-fork.3</title><content type="html">Unsigned fork build</content></entry></feed>`;
      }
      if (normalized === "/yeskiy/t3code/releases/latest") {
        return JSON.stringify({ tag_name: "v0.1.13-fork.3" });
      }
      if (normalized === "/yeskiy/t3code/releases/download/v0.1.13-fork.3/latest.yml") {
        return "version: 0.1.13-fork.3\npath: T3-Code-0.1.13-fork.3-x64.exe\nsha512: abc\n";
      }
      throw new Error(`Unexpected request path: ${normalized}`);
    };

    const provider = new GitHubProvider(
      { provider: "github", owner: "yeskiy", repo: "t3code", releaseType: "release" },
      {
        allowPrerelease: false,
        channel: "latest",
        currentVersion: semver.parse("0.1.13-fork.2"),
        fullChangelog: false,
      } as ProviderArgs[1],
      {
        isUseMultipleRangeRequest: false,
        platform: "win32",
        executor: { request },
      } as ProviderArgs[2],
    );

    const latest = await provider.getLatestVersion();
    expect(latest.tag).toBe("v0.1.13-fork.3");
    expect(latest.version).toBe("0.1.13-fork.3");
    expect(requestedPaths.every((path) => path.startsWith("/yeskiy/t3code/"))).toBe(true);
    expect(requestedPaths.some((path) => path.includes("pingdotgg"))).toBe(false);
  });
});
