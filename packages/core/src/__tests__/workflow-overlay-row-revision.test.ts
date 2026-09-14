import { expect, it } from "vitest";
import { isWorkflowOverlayRowRevisionCurrent as current } from "../task-store/moves.js";
it("rejects wrapped, future, malformed, and ambiguous transaction revisions", () => {
  expect(current("4294967297", "1", "4294967300")).toBe(true);
  expect(current("1", "1", "4294967297")).toBe(false);
  expect(current("1", "1", "2147483649")).toBe(false);
  expect(current("1", "1", "2147483648")).toBe(true);
  expect(current("9", "9", "8")).toBe(false);
  expect(current("9", "8", "10")).toBe(false);
  expect(current("garbage", "1", "10")).toBe(false);
});
