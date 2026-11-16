import { describe, expect, it } from "vitest";

import { evaluateApplyGate, type ApplyGateInput } from "./apply";

const base: ApplyGateInput = {
  jobStatus: "running",
  projectPriceVersion: "price-1",
  expectedSourcePriceVersion: "price-1",
  toPriceVersionId: "price-2",
  projectPublishedSeq: 1,
  targetPublishedSeq: 2,
  latestPublishedSeq: 2,
  attemptAlreadyApplied: false,
  projectCalcVersion: "calc-2026.11.0",
  eventCalcVersion: "calc-2026.11.0",
};

describe("CA-T-405: проверки §10.5", () => {
  it("разрешает применение актуального результата", () => {
    const result = evaluateApplyGate(base);
    expect(result.shouldWrite).toBe(true);
    expect(result.action).toBe("apply");
  });

  it("блокирует source mismatch без записи", () => {
    const result = evaluateApplyGate({
      ...base,
      projectPriceVersion: "price-other",
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.action).toBe("cancel");
    expect(result.code).toBe("SOURCE_VERSION_MISMATCH");
  });

  it("блокирует откат на более старую версию", () => {
    const result = evaluateApplyGate({
      ...base,
      projectPriceVersion: "price-3",
      expectedSourcePriceVersion: "price-3",
      projectPublishedSeq: 3,
      targetPublishedSeq: 2,
      latestPublishedSeq: 3,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.code).toBe("SUPERSEDED");
  });

  it("блокирует target новее последней опубликованной", () => {
    const result = evaluateApplyGate({
      ...base,
      targetPublishedSeq: 3,
      latestPublishedSeq: 2,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.code).toBe("SUPERSEDED");
  });

  it("идемпотентно закрывает уже применённую попытку", () => {
    const result = evaluateApplyGate({
      ...base,
      projectPriceVersion: "price-2",
      attemptAlreadyApplied: true,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.action).toBe("close");
    expect(result.code).toBe("ALREADY_APPLIED");
  });

  it("пропускает применение другой операцией", () => {
    const result = evaluateApplyGate({
      ...base,
      projectPriceVersion: "price-2",
      attemptAlreadyApplied: false,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.action).toBe("skip");
    expect(result.code).toBe("ALREADY_AT_TARGET");
  });

  it("CA-T-412: не применяет результат другой calcVersion", () => {
    const result = evaluateApplyGate({
      ...base,
      eventCalcVersion: "calc-2026.12.0",
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.action).toBe("skip");
    expect(result.code).toBe("CALC_VERSION_MISMATCH");
  });

  it("CA-T-412: legacy без calcVersion не получает версию молча", () => {
    const result = evaluateApplyGate({
      ...base,
      projectCalcVersion: null,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.action).toBe("skip");
    expect(result.code).toBe("CALC_VERSION_UNKNOWN");
  });

  it("не применяет задание не в running", () => {
    const result = evaluateApplyGate({ ...base, jobStatus: "pending" });
    expect(result.shouldWrite).toBe(false);
    expect(result.action).toBe("noop");
    expect(result.code).toBe("JOB_NOT_RUNNING");
  });
});
