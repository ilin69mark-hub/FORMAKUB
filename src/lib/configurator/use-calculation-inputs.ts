"use client";

import { useEffect, useState } from "react";

import type { CalculationInputs } from "./contract";
import type { FurnitureConfig, PriceBreakdown } from "./types";

export interface CalculationInputsState {
  inputs: CalculationInputs | null;
  schemaVersion: number | null;
  /** Сервер-авторитетный PriceBreakdown, посчитанный общим Engine/Adapter. */
  price: PriceBreakdown | null;
  loading: boolean;
  error: string | null;
}

/**
 * CA-T-306C/CA-T-504 — клиент получает готовые CalculationInputs и
 * рассчитанный сервером PriceBreakdown с read-only endpoint. Хук не
 * собирает inputs, не вызывает формулы и не импортирует content/Admin.
 */
export function useCalculationInputs(
  config: FurnitureConfig | null,
): CalculationInputsState {
  const [state, setState] = useState<CalculationInputsState>({
    inputs: null,
    schemaVersion: null,
    price: null,
    loading: config !== null,
    error: null,
  });

  useEffect(() => {
    if (!config) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, loading: true, error: null }));
      void fetch("/api/calculation-inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "preview", config }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as
            | {
                ok: true;
                schemaVersion: number;
                inputs: CalculationInputs;
                price: PriceBreakdown;
              }
            | { ok: false; error?: string };
          if (!response.ok || !payload.ok) {
            throw new Error(
              payload.ok ? "Не удалось получить расчётные данные." : payload.error ?? "Не удалось получить расчётные данные.",
            );
          }
          setState({
            inputs: payload.inputs,
            schemaVersion: payload.schemaVersion,
            price: payload.price,
            loading: false,
            error: null,
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            inputs: null,
            schemaVersion: null,
            price: null,
            loading: false,
            error: error instanceof Error ? error.message : "Не удалось получить расчётные данные.",
          });
        });
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [config]);

  return state;
}
