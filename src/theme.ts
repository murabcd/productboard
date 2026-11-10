export const THEME_IDS = ["productboard", "vercel-dark", "vercel-light"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = "productboard";

interface ThemePalette {
  label: string;
  background: string;
  chrome: string;
  raised: string;
  panel: string;
  selection: string;
  cursor: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  done: string;
  code: string;
  codeBackground: string;
  review: string;
  ship: string;
  warning: string;
  error: string;
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  productboard: {
    label: "Default",
    background: "#151619",
    chrome: "#111215",
    raised: "#22253a",
    panel: "#1a1b21",
    selection: "#292d40",
    cursor: "#b8c1ff",
    text: "#e3e4ec",
    muted: "#a2a5b5",
    line: "#353743",
    accent: "#b8c1ff",
    done: "#96d8b7",
    code: "#d7af87",
    codeBackground: "#262626",
    review: "#cbb6f4",
    ship: "#5fd7d7",
    warning: "#d7af5f",
    error: "#f0a4a8",
  },
  // Geist Terminal colors with neutral surfaces for the dashboard's panels and controls.
  // https://vercel.com/geist/terminal
  "vercel-dark": {
    label: "Vercel Dark",
    background: "#000000",
    chrome: "#0a0a0a",
    raised: "#1a1a1a",
    panel: "#111111",
    selection: "#2e2e2e",
    cursor: "#ededed",
    text: "#ededed",
    muted: "#a0a0a0",
    line: "#454545",
    accent: "#52a9ff",
    done: "#63c174",
    code: "#ffc983",
    codeBackground: "#1a1a1a",
    review: "#bf7af0",
    ship: "#0ac5b3",
    warning: "#f1a10d",
    error: "#fe7573",
  },
  "vercel-light": {
    label: "Vercel Light",
    background: "#fbfbfa",
    chrome: "#f5f5f4",
    raised: "#ebedf0",
    panel: "#ffffff",
    selection: "#dce3ec",
    cursor: "#24292f",
    text: "#24292f",
    muted: "#656a70",
    line: "#bfc4ca",
    accent: "#1a5fb4",
    done: "#18703a",
    code: "#6b3f00",
    codeBackground: "#ebedf0",
    review: "#7e3ab8",
    ship: "#0b7268",
    warning: "#8a5300",
    error: "#a8242b",
  },
};
