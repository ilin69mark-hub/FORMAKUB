import { randomBytes } from "node:crypto";
import { calculatePrice } from "@/lib/configurator/pricing";
import { isConfigValid, validateConfig } from "@/lib/configurator/validation";
import type {
  LeadCustomer,
  StoredLead,
  FurnitureConfig,
  FurnitureInterest,
} from "@/lib/configurator/types";
import { updateCollection } from "./store";

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
}): Promise<
  | { ok: true; lead: StoredLead }
  | { ok: false; issues: ReturnType<typeof validateConfig> }
> {
  let price: ReturnType<typeof calculatePrice> | null = null;
  if (input.config) {
    const issues = validateConfig(input.config);
    if (!isConfigValid(issues)) {
      return { ok: false, issues };
    }
    price = calculatePrice(input.config);
  }

  const createdAt = new Date().toISOString();
  const leadWithoutId = {
    config: input.config,
    customer: input.customer,
    source: input.source,
    interest: input.interest,
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
