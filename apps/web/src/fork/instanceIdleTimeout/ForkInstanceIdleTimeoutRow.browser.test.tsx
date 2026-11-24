import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ForkInstanceIdleTimeoutRow } from "./ForkInstanceIdleTimeoutRow";

describe("ForkInstanceIdleTimeoutRow", () => {
  it("commits valid minutes, rejects out-of-range values, and clears on empty input", async () => {
    const onCommit = vi.fn();

    await using screen = await render(
      <ForkInstanceIdleTimeoutRow
        idPrefix="provider-instance-claudeAgent"
        value={undefined}
        onCommit={onCommit}
      />,
      { router: false },
    );

    const input = screen.getByLabelText("Keep idle process (minutes)");
    await expect.element(input).toHaveValue("");
    await expect
      .element(
        screen.getByText(
          "How long T3 keeps the provider process after a turn. Empty uses the default: 2 minutes for providers that can resume, 30 for others. A longer time keeps MCP servers, such as a browser, alive, and uses more memory.",
        ),
      )
      .toBeVisible();

    await userEvent.fill(input, "0");
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
    await expect
      .element(screen.getByText("Enter a whole number from 1 to 1440. The value was not saved."))
      .toBeVisible();

    await userEvent.clear(input);
    await userEvent.fill(input, "30");
    await userEvent.tab();
    expect(onCommit).toHaveBeenLastCalledWith(30);

    await screen.rerender(
      <ForkInstanceIdleTimeoutRow
        idPrefix="provider-instance-claudeAgent"
        value={30}
        onCommit={onCommit}
      />,
    );
    await expect.element(input).toHaveValue("30");

    await userEvent.clear(input);
    await userEvent.tab();
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });
});
