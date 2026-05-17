import { describe, expect, it } from "vitest";
import {
  formatHistoryTimestampLabel,
  formatHistoryTimestampTooltip,
  getHistoryTimestampRefreshMs,
} from "./historyTimestamp";

describe("formatHistoryTimestampLabel", () => {
  /** Fixed local instant so relative math does not depend on UTC parsing. */
  const anchor = new Date(2026, 4, 14, 12, 0, 0);

  it("shows just now under five seconds", () => {
    const date = new Date(anchor.getTime() - 4_000);
    expect(formatHistoryTimestampLabel(date, anchor)).toBe("just now");
  });

  it("shows compact seconds", () => {
    const date = new Date(anchor.getTime() - 10_000);
    expect(formatHistoryTimestampLabel(date, anchor)).toBe("10s");
  });

  it("shows minutes and hours", () => {
    expect(formatHistoryTimestampLabel(new Date(anchor.getTime() - 5 * 60_000), anchor)).toBe("5m");
    expect(formatHistoryTimestampLabel(new Date(anchor.getTime() - 2 * 60 * 60_000), anchor)).toBe("2h");
  });

  it("shows days below one week", () => {
    expect(formatHistoryTimestampLabel(new Date(anchor.getTime() - 24 * 60 * 60_000), anchor)).toBe("1d");
    expect(formatHistoryTimestampLabel(new Date(anchor.getTime() - 6 * 24 * 60 * 60_000), anchor)).toBe("6d");
  });

  it("uses calendar-style date in same year once past relative window", () => {
    const date = new Date(2026, 4, 2, 9, 32, 0);
    const now = new Date(2026, 4, 14, 12, 0, 0);
    const label = formatHistoryTimestampLabel(date, now);
    expect(label).toMatch(/^2 May,/);
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });

  it("includes year when not same calendar year as reference now", () => {
    const date = new Date(2025, 4, 2, 9, 32, 0);
    const now = new Date(2026, 4, 14, 12, 0, 0);
    const label = formatHistoryTimestampLabel(date, now);
    expect(label).toContain("2025");
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });

  it("does not use Yesterday", () => {
    const date = new Date(anchor.getTime() - 24 * 60 * 60_000);
    expect(formatHistoryTimestampLabel(date, anchor)).toBe("1d");
    expect(formatHistoryTimestampLabel(date, anchor)).not.toContain("Yesterday");
  });
});

describe("formatHistoryTimestampTooltip", () => {
  it("is a long-form en-GB string", () => {
    const date = new Date(2026, 4, 14, 12, 0, 0);
    const tip = formatHistoryTimestampTooltip(date);
    expect(tip.toLowerCase()).toContain("may");
    expect(tip).toContain("2026");
  });
});

describe("getHistoryTimestampRefreshMs", () => {
  const anchor = new Date(2026, 4, 14, 12, 0, 0);

  it("returns faster intervals for fresher rows", () => {
    expect(getHistoryTimestampRefreshMs(new Date(anchor.getTime() - 10_000), anchor)).toBe(1_000);
    expect(getHistoryTimestampRefreshMs(new Date(anchor.getTime() - 30 * 60_000), anchor)).toBe(30_000);
    expect(getHistoryTimestampRefreshMs(new Date(anchor.getTime() - 3 * 60 * 60_000), anchor)).toBe(60_000);
    expect(getHistoryTimestampRefreshMs(new Date(anchor.getTime() - 2 * 24 * 60 * 60_000), anchor)).toBe(5 * 60_000);
    expect(getHistoryTimestampRefreshMs(new Date(2026, 3, 1, 12, 0, 0), anchor)).toBe(60 * 60_000);
  });
});
