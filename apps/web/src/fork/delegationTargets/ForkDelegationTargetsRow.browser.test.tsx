import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ForkDelegationTargetsRow } from "./ForkDelegationTargetsRow";

describe("ForkDelegationTargetsRow", () => {
  it("commits valid comma lists, rejects invalid ids, clears on empty input, and resets empty-list blocks", async () => {
    const onCommit = vi.fn();

    await using screen = await render(
      <ForkDelegationTargetsRow
        idPrefix="provider-instance-claudeWork"
        value={undefined}
        onCommit={onCommit}
      />,
      { router: false },
    );

    const input = screen.getByLabelText("Allowed delegation targets");
    await expect.element(input).toHaveValue("");
    await expect
      .element(
        screen.getByText(
          "Comma-separated provider instance IDs that this instance may delegate to. Empty: any instance.",
        ),
      )
      .toBeVisible();

    await userEvent.fill(input, "bad id");
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
    await expect
      .element(
        screen.getByText(
          "Enter comma-separated instance IDs using letters, numbers, hyphens, or underscores. The value was not saved.",
        ),
      )
      .toBeVisible();

    await userEvent.clear(input);
    await userEvent.fill(input, "claudeWork, codex, claudeWork");
    await userEvent.tab();
    expect(onCommit).toHaveBeenLastCalledWith([
      ProviderInstanceId.make("claudeWork"),
      ProviderInstanceId.make("codex"),
    ]);

    await screen.rerender(
      <ForkDelegationTargetsRow
        idPrefix="provider-instance-claudeWork"
        value={[ProviderInstanceId.make("claudeWork"), ProviderInstanceId.make("codex")]}
        onCommit={onCommit}
      />,
    );
    await expect.element(input).toHaveValue("claudeWork, codex");

    await userEvent.clear(input);
    await userEvent.tab();
    expect(onCommit).toHaveBeenLastCalledWith(undefined);

    await screen.rerender(
      <ForkDelegationTargetsRow
        idPrefix="provider-instance-claudeWork"
        value={[]}
        onCommit={onCommit}
      />,
    );
    await expect
      .element(
        screen.getByText(
          "All delegation is blocked (empty list). Enter IDs or reset to allow any instance.",
        ),
      )
      .toBeVisible();

    await userEvent.click(screen.getByLabelText("Allow any delegation target"));
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });
});
