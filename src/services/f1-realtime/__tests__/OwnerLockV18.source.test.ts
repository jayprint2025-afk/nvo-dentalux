import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Owner Lock V18 source invariants", () => {
  it("never defaults automatic wake identity to accepted", () => {
    const src = readFileSync(resolve(__dirname, "../F1AudioSessionController.ts"), "utf8");
    expect(src).not.toContain(": { accepted: true }");
    expect(src).toContain("muestra de voz requerida");
    expect(src).toContain("rms < 0.008");
  });
});
