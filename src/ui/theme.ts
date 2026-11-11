import { type OptimizedBuffer, RGBA, TextAttributes } from "@opentui/core";
import { cells } from "../text";
import { THEMES, type ThemeId } from "../theme";
import type { Canvas, Rect, ScannerStyle, Style, Surface, TextStyle } from "./canvas";

const SCANNER: Record<ScannerStyle, number> = {
  trail0: 1,
  trail1: 0.9,
  trail2: 0.65,
  trail3: 0.65 ** 2,
  trail4: 0.65 ** 3,
  trail5: 0.65 ** 4,
  idle0: 0.6 * 0.3,
  idle1: 0.6 * 0.53,
  idle2: 0.6 * 0.77,
  idle3: 0.6,
};

export const isScanner = (style: Style): style is ScannerStyle => style in SCANNER;

export function drawCanvas(
  buffer: OptimizedBuffer,
  canvas: Canvas,
  theme: ReturnType<typeof resolveTheme>,
  { left, top }: Pick<Rect, "left" | "top"> = { left: 0, top: 0 },
): void {
  const { surfaces, styles, scanner } = theme;
  for (let y = 0; y < canvas.height; y++) {
    let x = left;
    for (const run of canvas.runs(y)) {
      const surface = surfaces[run.surface ?? "workspace"];
      if (isScanner(run.style)) {
        buffer.drawText(run.text, x, top + y, scanner(run.style, surface), surface, TextAttributes.NONE);
      } else {
        const style = styles[run.style];
        buffer.drawText(run.text, x, top + y, style.fg, style.bg ?? surface, style.attributes);
      }
      x += cells(run.text);
    }
  }
}

export function resolveTheme(id: ThemeId) {
  const palette = THEMES[id];
  const hex = (value: string) => RGBA.fromHex(value);
  const surfaces: Record<Surface, RGBA> = {
    workspace: hex(palette.background),
    raised: hex(palette.raised),
    panel: hex(palette.panel),
    selected: hex(palette.selection),
    accent: hex(palette.accent),
  };
  const text = hex(palette.text);
  const muted = hex(palette.muted);
  const { accent } = surfaces;
  const warning = hex(palette.warning);
  const { BOLD, ITALIC, UNDERLINE, STRIKETHROUGH, NONE } = TextAttributes;
  const style = (fg: RGBA, attributes: number = NONE, bg?: RGBA) => ({ fg, bg, attributes });
  const styles: Record<TextStyle, ReturnType<typeof style>> = {
    line: style(hex(palette.line)),
    text: style(text),
    title: style(text, BOLD),
    muted: style(muted),
    mutedBold: style(muted, BOLD),
    accent: style(accent),
    accentBold: style(accent, BOLD),
    onAccent: style(surfaces.workspace, BOLD),
    done: style(hex(palette.done)),
    italic: style(text, ITALIC),
    code: style(hex(palette.code), NONE, hex(palette.codeBackground)),
    link: style(accent, UNDERLINE),
    strike: style(muted, STRIKETHROUGH),
    status: style(surfaces.workspace, BOLD, accent),
    review: style(hex(palette.review)),
    ship: style(hex(palette.ship)),
    warning: style(warning),
    mention: style(warning, BOLD),
    error: style(hex(palette.error)),
    selection: style(text, NONE, surfaces.selected),
    selectedBold: style(text, BOLD, surfaces.selected),
  };
  const glare = RGBA.fromValues(
    Math.min(1, accent.r * 1.15),
    Math.min(1, accent.g * 1.15),
    Math.min(1, accent.b * 1.15),
    1,
  );
  return {
    id,
    surfaces,
    styles,
    composer: {
      placeholderColor: muted,
      textColor: text,
      focusedTextColor: text,
      backgroundColor: surfaces.raised,
      focusedBackgroundColor: surfaces.raised,
      cursorColor: hex(palette.cursor),
      selectionBg: surfaces.selected,
      selectionFg: text,
    },
    scanner(shade: ScannerStyle, surface: RGBA): RGBA {
      const alpha = SCANNER[shade];
      const color = shade === "trail1" ? glare : accent;
      const mix = (front: number, back: number) => front * alpha + back * (1 - alpha);
      return RGBA.fromValues(mix(color.r, surface.r), mix(color.g, surface.g), mix(color.b, surface.b), 1);
    },
  };
}
