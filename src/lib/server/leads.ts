import { randomBytes } from "node:crypto";
import {
  isLegacyFacadeMaterial,
  legacyFacadeBlockIssue,
} from "@/lib/configurator/materials";
import { isConfigValid, validateConfig } from "@/lib/configurator/validation";
import type {
  LeadCustomer,
  PriceBreakdown,
  StoredLead,
  FurnitureConfig,
  FurnitureInterest,
} from "@/lib/configurator/types";
import { resolveCalculationInputs } from "./data-resolver";
import { calculatePriceFromInputs, getProject } from "./projects";
import { readCollection, updateCollection } from "./store";

function dateStamp(date = new Date()): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function shortCode(): string {
  return randomBytes(3).toString("hex").slice(0, 4).toUpperCase();
}

export async function createLead(input: {
  config?: FurnitureConfig;
  customer: LeadCustomer;
  source?: string;
  interest?: FurnitureInterest;
  projectId?: string;
}): Promise<
  | { ok: true; lead: StoredLead }
  | { ok: false; issues: ReturnType<typeof validateConfig> }
> {
  /*
   * CA-GL-25: связь с сохранённым проектом проверяется на сервере.
   * Неизвестный/повреждённый проект — контролируемый отказ, а не «тихая» привязка.
   */
  if (input.projectId !== undefined) {
    const project = await getProject(input.projectId);
    if (project.status !== "ok") {
      return {
        ok: false,
        issues: [
          {
            path: "projectId",
            message: "Проект не найден или недоступен — заявка не создана.",
            severity: "error",
          },
        ],
      };
    }
  }

  let price: PriceBreakdown | null = null;
  if (input.config) {
    const issues = validateConfig(input.config);
    if (!isConfigValid(issues)) {
      return { ok: false, issues };
    }
    // A18-1: исторический материал фасада запрещён для новых расчётов.
    // Лид с такой конфигурацией не создаётся и не получает расчёт по
    // историческому PriceItem; проверка серверная, на UI не полагаемся.
    if (isLegacyFacadeMaterial(input.config.facadeMaterial)) {
      return { ok: false, issues: [legacyFacadeBlockIssue()] };
    }
    // CA-T-504: лид считается тем же DataResolver/Engine, что и публичный
    // калькулятор и сохранение проекта. Нет опубликованной версии/ошибка —
    // цена остаётся null; случайный legacy-fallback не подставляется.
    try {
      const resolution = await resolveCalculationInputs({
        operation: "create",
        config: input.config,
      });
      if (resolution.ok) {
        const calculated = await calculatePriceFromInputs(resolution.value.request);
        if (calculated.ok) price = calculated.price;
      }
    } catch {
      price = null;
    }
  }

  const createdAt = new Date().toISOString();
  const leadWithoutId = {
    config: input.config,
    customer: input.customer,
    source: input.source,
    interest: input.interest,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    createdAt,
    status: "new" as const,
    price,
  };

  const lead = await updateCollection<StoredLead, StoredLead>(
    "leads.json",
    (items) => {
      let id = `FK-${dateStamp()}-${shortCode()}`;
      let attempt = 0;
      while (items.some((item) => item.id === id) && attempt < 5) {
        id = `FK-${dateStamp()}-${shortCode()}`;
        attempt += 1;
      }
      const stored: StoredLead = { id, ...leadWithoutId };
      return { items: [...items, stored].slice(-5000), result: stored };
    },
  );

  return { ok: true, lead };
}

/** CA-GL-25: список заявок для Admin (read-only, новые первыми). */
export async function listLeads(): Promise<StoredLead[]> {
  const items = await readCollection<StoredLead>("leads.json");
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
