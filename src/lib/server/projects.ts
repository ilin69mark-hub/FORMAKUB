import { randomBytes } from "node:crypto";
import { normalizeKitchen } from "@/lib/configurator/defaults";
import { calculatePrice } from "@/lib/configurator/pricing";
import { isConfigValid, validateConfig } from "@/lib/configurator/validation";
import type { FurnitureConfig, StoredProject } from "@/lib/configurator/types";
import { readCollection, updateCollection } from "./store";

function projectId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let id = "";
  for (let i = 0; i < 8; i += 1) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

export async function saveProject(input: {
  config: FurnitureConfig;
}): Promise<
  | { ok: true; project: StoredProject }
  | { ok: false; issues: ReturnType<typeof validateConfig> }
> {
  const issues = validateConfig(input.config);
  if (!isConfigValid(issues)) {
    return { ok: false, issues };
  }

  const price = calculatePrice(input.config);
  const now = new Date().toISOString();

  const project = await updateCollection<StoredProject, StoredProject>(
    "projects.json",
    (items) => {
      let id = projectId();
      let attempt = 0;
      while (items.some((item) => item.id === id) && attempt < 5) {
        id = projectId();
        attempt += 1;
      }
      const stored: StoredProject = {
        id,
        config: input.config,
        price,
        createdAt: now,
        updatedAt: now,
      };
      return { items: [...items, stored].slice(-2000), result: stored };
    },
  );

  return { ok: true, project };
}

export async function getProject(id: string): Promise<StoredProject | null> {
  const items = await readCollection<StoredProject>("projects.json");
  const project = items.find((item) => item.id === id) ?? null;
  if (!project) return null;

  const config =
    project.config.kind === "kitchen"
      ? normalizeKitchen(project.config)
      : project.config;
  const issues = validateConfig(config);
  if (!isConfigValid(issues)) return null;

  return {
    ...project,
    config,
    price: calculatePrice(config),
    updatedAt: project.updatedAt,
  };
}
