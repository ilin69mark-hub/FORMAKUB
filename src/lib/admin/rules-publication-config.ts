/**
 * NEW-N4 / D-9 — конфигурация production-публикации Rules Snapshot.
 *
 * Безопасные значения по умолчанию:
 *  - production определяется явным маркером `FORMAKUB_ENV=production`
 *    (или `NODE_ENV=production` как совместимый признак);
 *  - публикация разрешена только при `FORMAKUB_RULES_PUBLICATION_ENABLED=1`;
 *  - противоречивые/некорректные значения блокируют публикацию.
 */

export interface RulesPublicationConfigState {
  production: boolean;
  enabled: boolean;
  blocked: boolean;
  reason: string | null;
  issues: string[];
}

const ALLOWED_MARKERS = new Set(["production", "development", "test"]);
const ALLOWED_FLAGS = new Set(["", "0", "1"]);

export function evaluateRulesPublicationConfig(
  env: NodeJS.ProcessEnv = process.env,
): RulesPublicationConfigState {
  const issues: string[] = [];
  const marker = env.FORMAKUB_ENV?.trim();
  const nodeEnv = env.NODE_ENV?.trim();
  const flag = (env.FORMAKUB_RULES_PUBLICATION_ENABLED ?? "").trim();

  if (marker !== undefined && marker !== "" && !ALLOWED_MARKERS.has(marker)) {
    issues.push(
      `FORMAKUB_ENV="${marker}" недопустим (production|development|test)`,
    );
  }
  if (!ALLOWED_FLAGS.has(flag)) {
    issues.push(
      `FORMAKUB_RULES_PUBLICATION_ENABLED="${flag}" недопустим (пусто|0|1)`,
    );
  }

  const nodeProduction = nodeEnv === "production";
  const markerProduction = marker === "production";
  const production = nodeProduction || markerProduction;

  if (nodeProduction && marker !== undefined && marker !== "" && !markerProduction) {
    issues.push(
      `противоречие: NODE_ENV=production, FORMAKUB_ENV="${marker}"`,
    );
  }
  if (markerProduction && nodeEnv !== undefined && nodeEnv !== "" && !nodeProduction) {
    issues.push(
      `противоречие: FORMAKUB_ENV=production, NODE_ENV="${nodeEnv}"`,
    );
  }

  const enabled = flag === "1";
  let blocked = issues.length > 0;
  let reason: string | null = null;

  if (issues.length > 0) {
    reason = `Конфигурация публикации противоречива/некорректна: ${issues.join("; ")}`;
  } else if (production && !enabled) {
    blocked = true;
    reason =
      "Публикация правил заблокирована: production без FORMAKUB_RULES_PUBLICATION_ENABLED=1 (CA-T-511).";
  }

  return { production, enabled, blocked, reason, issues };
}

/** Совместимый предикат для сервиса публикации. */
export function rulesPublicationBlocked(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return evaluateRulesPublicationConfig(env).blocked;
}
