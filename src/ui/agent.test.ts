import { describe, expect, test } from "bun:test";
import { drawScanner } from "./agent";
import { Canvas } from "./canvas";

const scanner = (frame: number) => {
  const canvas = new Canvas(12, 1);
  drawScanner(canvas, 0, 0, frame);
  return canvas;
};
const blocks = (frame: number) => scanner(frame).text(0).slice(0, 8);
const shades = (frame: number) =>
  scanner(frame)
    .runs(0)
    .flatMap(({ text, style }) => [...text].map(() => style))
    .slice(0, 8);

describe("answering scanner", () => {
  test("a lit head sweeps right with a six-step trail, rests, then sweeps back", () => {
    expect(blocks(0)).toBe("■⬝⬝⬝⬝⬝⬝⬝");
    expect(blocks(3)).toBe("■■■■⬝⬝⬝⬝");
    expect(blocks(7)).toBe("⬝⬝■■■■■■");
    expect(blocks(10)).toBe("⬝⬝⬝⬝■■■■"); // resting at the end: the trail drains into the head
    expect(blocks(20)).toBe("⬝⬝⬝■■■■■"); // heading back left, the trail behind it on the right
  });

  test("one hue fading behind the head; resting blocks dim while the head rests", () => {
    expect(shades(7).slice(2)).toEqual(["trail5", "trail4", "trail3", "trail2", "trail1", "trail0"]);
    expect(shades(7)[0]).toBe("idle3"); // just arrived: resting blocks at full
    expect(shades(16)[0]).toBe("idle0"); // last step of the rest: dimmest
  });
});
