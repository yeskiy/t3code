import { createRef } from "react";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import "./sharpText.css";

import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "~/components/ComposerPromptEditorTiptap";
import { ComposerBanner } from "~/components/chat/ComposerBanner";
import { ComposerControl } from "~/components/chat/ComposerControl";
import { ComposerSurface } from "~/components/chat/ComposerSurface";
import { render } from "../../../test/render";

function setupDocumentState(options: { dark: boolean; sharpText: boolean }): Disposable {
  const root = document.documentElement;
  const previousDark = root.classList.contains("dark");
  const previousSharpText = root.hasAttribute("data-fork-sharp-text");
  const previousGlassOpacity = root.style.getPropertyValue("--glass-opacity");
  const previousGlassBlur = root.style.getPropertyValue("--glass-blur");

  root.classList.toggle("dark", options.dark);
  root.toggleAttribute("data-fork-sharp-text", options.sharpText);
  // Mirror appInit.tsx, which sets an inline --glass-opacity below 100% by default.
  root.style.setProperty("--glass-opacity", "80%");
  root.style.removeProperty("--glass-blur");

  return {
    [Symbol.dispose]() {
      root.classList.toggle("dark", previousDark);
      root.toggleAttribute("data-fork-sharp-text", previousSharpText);
      if (previousGlassOpacity) root.style.setProperty("--glass-opacity", previousGlassOpacity);
      else root.style.removeProperty("--glass-opacity");
      if (previousGlassBlur) root.style.setProperty("--glass-blur", previousGlassBlur);
      else root.style.removeProperty("--glass-blur");
    },
  };
}

function parseColorAlpha(color: string): { r: number; g: number; b: number; alpha: number } {
  const rgbMatch = color.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
  );
  if (rgbMatch) {
    const rawAlpha = rgbMatch[4];
    const alpha =
      rawAlpha === undefined
        ? 1
        : rawAlpha.endsWith("%")
          ? Number.parseFloat(rawAlpha) / 100
          : Number.parseFloat(rawAlpha);
    return {
      r: Number.parseFloat(rgbMatch[1] ?? "0"),
      g: Number.parseFloat(rgbMatch[2] ?? "0"),
      b: Number.parseFloat(rgbMatch[3] ?? "0"),
      alpha,
    };
  }

  const srgbMatch = color.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/,
  );
  if (srgbMatch) {
    const rawAlpha = srgbMatch[4];
    const alpha =
      rawAlpha === undefined
        ? 1
        : rawAlpha.endsWith("%")
          ? Number.parseFloat(rawAlpha) / 100
          : Number.parseFloat(rawAlpha);
    return {
      r: Math.round(Number.parseFloat(srgbMatch[1] ?? "0") * 255),
      g: Math.round(Number.parseFloat(srgbMatch[2] ?? "0") * 255),
      b: Math.round(Number.parseFloat(srgbMatch[3] ?? "0") * 255),
      alpha,
    };
  }

  throw new Error(`Unexpected computed color format: ${color}`);
}

function assertLayerClearOfLcdBlockers(element: Element, label: string): void {
  const style = getComputedStyle(element);
  expect(style.backdropFilter, `${label} backdropFilter`).toBe("none");
  expect(style.maskImage, `${label} maskImage`).toBe("none");
  expect(style.willChange, `${label} willChange`).toBe("auto");
  expect(style.opacity, `${label} opacity`).toBe("1");

  for (const pseudo of ["::before", "::after"] as const) {
    const pseudoStyle = getComputedStyle(element, pseudo);
    expect(pseudoStyle.backdropFilter, `${label}${pseudo} backdropFilter`).toBe("none");
    expect(pseudoStyle.maskImage, `${label}${pseudo} maskImage`).toBe("none");
    expect(pseudoStyle.willChange, `${label}${pseudo} willChange`).toBe("auto");
  }
}

function ComposerHarness(props: {
  readonly contextRow?: boolean;
  readonly attachedBanner?: boolean;
}) {
  return (
    <div className="bg-background p-4">
      <ComposerSurface.Shell contextRow={props.contextRow ?? false}>
        <ComposerSurface.Host>
          <div className="relative z-10" data-testid="composer-host-inner">
            <form
              className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width)"
              data-chat-composer-form="true"
            >
              {props.attachedBanner ? (
                <ComposerBanner.Dock>
                  <ComposerBanner.Column>
                    <ComposerBanner.Attachment>
                      <ComposerBanner.Root variant="info">
                        <ComposerBanner.Row>
                          <ComposerBanner.Content>Attached banner notice</ComposerBanner.Content>
                        </ComposerBanner.Row>
                      </ComposerBanner.Root>
                    </ComposerBanner.Attachment>
                  </ComposerBanner.Column>
                </ComposerBanner.Dock>
              ) : null}
              <div className="relative">
                <ComposerSurface.Main>
                  <div
                    data-chat-composer-surface="true"
                    className="rounded-2xl transition-[background-color] duration-200"
                  >
                    <div data-chat-composer-body="true" className="relative px-4 pt-4 pb-2">
                      <div className="relative">
                        <ComposerPromptEditor
                          editorRef={createRef<ComposerPromptEditorHandle>()}
                          value=""
                          cursor={0}
                          richTextEnabled
                          contextRecords={new Map()}
                          skills={[]}
                          disabled={false}
                          placeholder="Ask anything..."
                          onChange={() => {}}
                          onPaste={() => {}}
                        />
                      </div>
                    </div>
                    <div
                      data-chat-composer-footer="true"
                      className="flex min-w-0 flex-nowrap items-center overflow-visible px-2 pb-2"
                    >
                      <div
                        data-chat-composer-controls="footer"
                        data-chat-composer-footer-controls="true"
                        className="relative flex min-w-0 flex-1 items-center justify-end gap-0.5"
                      >
                        <ComposerControl size="sm" data-chat-provider-model-picker="true">
                          Claude Opus 4.7
                        </ComposerControl>
                      </div>
                    </div>
                    <div className="h-8">
                      <div className="absolute inset-x-4 bottom-2 min-w-0">
                        <div
                          data-chat-composer-resting-controls="true"
                          className="relative flex w-max min-w-0 max-w-full items-center gap-1 text-muted-foreground/70 [&_button]:text-xs!"
                        >
                          <ComposerControl size="xs">Gemini 4 Neon</ComposerControl>
                        </div>
                      </div>
                    </div>
                  </div>
                </ComposerSurface.Main>
              </div>
            </form>
          </div>
        </ComposerSurface.Host>
        {props.contextRow ? (
          <ComposerSurface.ContextStrip>
            <span>main</span>
          </ComposerSurface.ContextStrip>
        ) : null}
      </ComposerSurface.Shell>
    </div>
  );
}

describe("sharpText composer styles", () => {
  it("makes composer surfaces opaque and removes LCD-text blockers in default dark mode", async () => {
    using _doc = setupDocumentState({ dark: true, sharpText: true });
    await using screen = await render(<ComposerHarness />, { router: false });

    const shell = screen.container.querySelector('[data-slot="composer-shell"]')!;
    const host = screen.container.querySelector('[data-slot="composer-host"]')!;
    const hostInner = screen.container.querySelector('[data-testid="composer-host-inner"]')!;
    const form = screen.container.querySelector('[data-chat-composer-form="true"]')!;
    const main = screen.container.querySelector('[data-chat-composer-main-surface="true"]')!;
    const surface = screen.container.querySelector('[data-chat-composer-surface="true"]')!;
    const tiptap = screen.container.querySelector(".composer-tiptap")!;
    const footer = screen.container.querySelector('[data-chat-composer-footer="true"]')!;
    const resting = screen.container.querySelector('[data-chat-composer-resting-controls="true"]')!;
    const modelButton = screen.container.querySelector('[data-chat-provider-model-picker="true"]')!;

    for (const [label, el] of [
      ["composer-shell", shell],
      ["composer-host", host],
      ["composer-host-inner", hostInner],
      ["composer-form", form],
      ["composer-main-surface", main],
      ["composer-surface", surface],
      ["composer-tiptap", tiptap],
      ["composer-footer", footer],
      ["composer-resting-controls", resting],
      ["model-picker", modelButton],
    ] as const) {
      assertLayerClearOfLcdBlockers(el, label);
    }

    // Surfaces inside each stacking context that hold composer text must be opaque (~#111111 in dark mode).
    for (const [label, el] of [
      ["composer-host", host],
      ["composer-host-inner", hostInner],
      ["composer-main-surface", main],
      ["composer-tiptap", tiptap],
    ] as const) {
      const parsed = parseColorAlpha(getComputedStyle(el).backgroundColor);
      expect(parsed.alpha, `${label} alpha`).toBe(1);
      expect(parsed.r, `${label} red channel`).toBeGreaterThanOrEqual(14);
      expect(parsed.r, `${label} red channel`).toBeLessThanOrEqual(22);
      expect(parsed.g, `${label} green channel`).toBe(parsed.r);
      expect(parsed.b, `${label} blue channel`).toBe(parsed.r);
    }

    // Rounded corners and the border overlay remain intact, and glass ::before layers are hidden.
    expect(Number.parseFloat(getComputedStyle(host).borderTopLeftRadius)).toBeGreaterThan(0);
    expect(Number.parseFloat(getComputedStyle(main).borderTopLeftRadius)).toBeGreaterThan(0);
    expect(getComputedStyle(host, "::after").zIndex).toBe("20");
    expect(getComputedStyle(host, "::after").borderTopWidth).toBe("1px");
    expect(getComputedStyle(shell, "::before").display).toBe("none");
    expect(getComputedStyle(host, "::before").display).toBe("none");
  });

  it("keeps composer surfaces opaque in light mode and with a context strip or attached banner", async () => {
    using _doc = setupDocumentState({ dark: false, sharpText: true });
    await using screen = await render(<ComposerHarness contextRow attachedBanner />, {
      router: false,
    });

    const shell = screen.container.querySelector('[data-slot="composer-shell"]')!;
    const host = screen.container.querySelector('[data-slot="composer-host"]')!;
    const main = screen.container.querySelector('[data-chat-composer-main-surface="true"]')!;
    const tiptap = screen.container.querySelector(".composer-tiptap")!;
    const contextStrip = screen.container.querySelector('[data-slot="composer-context-strip"]')!;
    const banner = screen.container.querySelector('[data-composer-banner-surface="attached"]')!;

    for (const [label, el] of [
      ["composer-shell", shell],
      ["composer-host", host],
      ["composer-main-surface", main],
      ["composer-tiptap", tiptap],
      ["composer-context-strip", contextStrip],
      ["composer-attached-banner", banner],
    ] as const) {
      assertLayerClearOfLcdBlockers(el, label);
    }

    expect(parseColorAlpha(getComputedStyle(main).backgroundColor)).toEqual({
      r: 255,
      g: 255,
      b: 255,
      alpha: 1,
    });
    expect(parseColorAlpha(getComputedStyle(tiptap).backgroundColor).alpha).toBe(1);
    expect(parseColorAlpha(getComputedStyle(contextStrip).backgroundColor).alpha).toBe(1);
    // With an attached banner, Host stays transparent behind the narrower banner while Main stays opaque.
    expect(parseColorAlpha(getComputedStyle(host).backgroundColor).alpha).toBe(0);
    expect(getComputedStyle(shell, "::before").display).toBe("none");
    expect(getComputedStyle(host, "::before").display).toBe("none");
  });

  it("does not apply sharp-text overrides when data-fork-sharp-text is absent", async () => {
    using _doc = setupDocumentState({ dark: true, sharpText: false });
    await using screen = await render(<ComposerHarness />, { router: false });

    const host = screen.container.querySelector('[data-slot="composer-host"]')!;
    const main = screen.container.querySelector('[data-chat-composer-main-surface="true"]')!;
    const tiptap = screen.container.querySelector(".composer-tiptap")!;

    expect(parseColorAlpha(getComputedStyle(host).backgroundColor).alpha).toBe(0);
    expect(parseColorAlpha(getComputedStyle(main).backgroundColor).alpha).toBe(0);
    expect(parseColorAlpha(getComputedStyle(tiptap).backgroundColor).alpha).toBe(0);
    expect(getComputedStyle(host, "::after").zIndex).toBe("1");
  });
});
