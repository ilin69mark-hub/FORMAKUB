import { describe, expect, it } from "vitest";

import {
  REQUEST_FINGERPRINT_VERSION,
  canonicalJson,
  requestFingerprint,
} from "./operation-fingerprint";

describe("CA-T-306E: operation fingerprint", () => {
  it("сортирует ключи объектов рекурсивно", () => {
    expect(requestFingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(
      requestFingerprint({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("сохраняет порядок массивов", () => {
    expect(requestFingerprint({ a: [1, 2] })).not.toBe(
      requestFingerprint({ a: [2, 1] }),
    );
  });

  it("обрабатывает undefined и null как JSON", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson({ a: [undefined, null] })).toBe('{"a":[null,null]}');
  });

  it("нормализует нечисловые числа", () => {
    expect(canonicalJson({ a: Number.NaN, b: Infinity })).toBe(
      '{"a":null,"b":null}',
    );
  });

  it("возвращает lowercase sha-256 и версию алгоритма", () => {
    const fingerprint = requestFingerprint({ operation: "create" });
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(REQUEST_FINGERPRINT_VERSION).toBe("sha256-canonical-json-v1");
  });
});
