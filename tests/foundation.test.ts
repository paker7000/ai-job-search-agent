import { describe, expect, it } from "vitest";

describe("foundation", () => {
  it("keeps the baseline independent of an AI provider key", () => {
    expect(process.env.AI_API_KEY).toBeUndefined();
    expect(true).toBe(true);
  });
});
