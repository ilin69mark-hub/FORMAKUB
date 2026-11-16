import { describe, expect, it } from "vitest";

import { evaluateApplyGate } from "./apply";

describe("CA-T-410: J2/J3 — обратный порядок и устаревшие задания", () => {
  it("J2: после v3 результат v2 не применяется", () => {
    const result = evaluateApplyGate({
      jobStatus: "running",
      projectPriceVersion: "price-3",
      expectedSourcePriceVersion: "price-3",
      toPriceVersionId: "price-2",
      projectPublishedSeq: 3,
      targetPublishedSeq: 2,
      latestPublishedSeq: 3,
      attemptAlreadyApplied: false,
      projectCalcVersion: "calc-2026.11.0",
      eventCalcVersion: "calc-2026.11.0",
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.action).toBe("cancel");
    expect(result.code).toBe("SUPERSEDED");
  });

  it("J3: после уже применённой v3 повтор v2 не перезаписывает", () => {
    const result = evaluateApplyGate({
      jobStatus: "running",
      projectPriceVersion: "price-3",
      expectedSourcePriceVersion: "price-3",
      toPriceVersionId: "price-2",
      projectPublishedSeq: 3,
      targetPublishedSeq: 2,
      latestPublishedSeq: 3,
      attemptAlreadyApplied: false,
      projectCalcVersion: "calc-2026.11.0",
      eventCalcVersion: "calc-2026.11.0",
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.code).toBe("SUPERSEDED");
  });

  it("повтор уже применённой попытки только закрывает job без записи", () => {
    const result = evaluateApplyGate({
      jobStatus: "running",
      projectPriceVersion: "price-2",
      expectedSourcePriceVersion: "price-1",
      toPriceVersionId: "price-2",
      projectPublishedSeq: 2,
      targetPublishedSeq: 2,
      latestPublishedSeq: 2,
      attemptAlreadyApplied: true,
      projectCalcVersion: "calc-2026.11.0",
      eventCalcVersion: "calc-2026.11.0",
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.action).toBe("close");
    expect(result.code).toBe("ALREADY_APPLIED");
  });

  it("устаревшее задание не даёт duplicate-write решения", () => {
    const decisions = [
      evaluateApplyGate({
        jobStatus: "running",
        projectPriceVersion: "price-2",
        expectedSourcePriceVersion: "price-1",
        toPriceVersionId: "price-2",
        projectPublishedSeq: 2,
        targetPublishedSeq: 2,
        latestPublishedSeq: 2,
        attemptAlreadyApplied: false,
        projectCalcVersion: "calc-2026.11.0",
        eventCalcVersion: "calc-2026.11.0",
      }),
      evaluateApplyGate({
        jobStatus: "running",
        projectPriceVersion: "price-2",
        expectedSourcePriceVersion: "price-1",
        toPriceVersionId: "price-2",
        projectPublishedSeq: 2,
        targetPublishedSeq: 2,
        latestPublishedSeq: 2,
        attemptAlreadyApplied: true,
        projectCalcVersion: "calc-2026.11.0",
        eventCalcVersion: "calc-2026.11.0",
      }),
    ];
    expect(decisions.every((decision) => decision.shouldWrite === false)).toBe(true);
  });
});
