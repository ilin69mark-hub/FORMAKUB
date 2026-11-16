import { acquireAppInstanceLock } from "@/lib/server/storage/instance-lock";
import { runScheduledBackup } from "@/lib/server/storage/s3";
import {
  resolveRecalcWorkerEnabled,
  startRecalculationRuntimeWorker,
  stopRecalculationRuntimeWorker,
} from "@/lib/admin/worker";
import { recoverRulesPublications } from "@/lib/admin/rules-publication-journal";
import { recoverCompositionPublications } from "@/lib/admin/composition-journal";
import { recoverCompositionTransitions } from "@/lib/admin/composition-transition-journal";
import { recoverPendingRulesTransitions } from "@/lib/admin/project-rules-transition";
import { evaluateRulesPublicationConfig } from "@/lib/admin/rules-publication-config";

/**
 * Инструментация приложения (Node-runtime; Next.js `register()` при старте
 * сервера — при сборке и в тестах не выполняется).
 *
 * 1. **Один экземпляр (R-03, CA-RISK-007):** захват lock-файла с
 *    heartbeat; живой второй экземпляр → исключение при старте (сервис не
 *    запускается). Освобождение — по exit/SIGTERM/SIGINT; остаточный лок
 *    после аварии снимается по TTL (см. `instance-lock.ts`).
 * 2. **Почасовые резервные копии (ADR-03, hourly):** интервал по умолчанию
 *    включён в production (`FORMAKUB_BACKUP_INTERVAL_MS` переопределяет;
 *    `0` — выкл); вне production по умолчанию выключено. Каждый тик —
 *    `runScheduledBackup()`: копия (WAL-aware) → ротация 48/30/12 →
 *    S3-выгрузка при настроенном ENV. Сбой тика логируется и не останавливает
 *    процесс.
 * 3. **In-process worker пересчёта (ADR-05, CA-T-404):** единственный
 *    runtime-worker на процесс; полный жизненный цикл pending-заданий,
 *    heartbeat/recovery и идемпотентная сверка. Отключается
 *    `FORMAKUB_RECALC_WORKER=0`. Корректно останавливается по SIGTERM/SIGINT.
 */

/** Интервал планового бэкапа, мс; `0` — выключено. */
export function resolveBackupIntervalMs(
  nodeEnv: string | undefined,
  raw: string | undefined,
): number {
  if (raw !== undefined && raw.trim() !== "") {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  return nodeEnv === "production" ? 3_600_000 : 0;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Живой второй экземпляр → исключение до запуска сервиса (R-03).
  acquireAppInstanceLock();

  // NEW-N4 / D-11: recovery незавершённых операций при старте (без фонового
  // процесса). Ошибки логируются и не останавливают приложение: публикация
  // всё равно fail-closed, recovery повторится перед следующей операцией.
  try {
    const publications = await recoverRulesPublications();
    if (publications.issues.length > 0) {
      console.error("[rules-recovery] публикации:", publications.issues.join("; "));
    }
    const transitions = await recoverPendingRulesTransitions();
    if (transitions.recovered > 0 || transitions.discarded > 0) {
      console.info(
        `[rules-recovery] переходы: восстановлено ${transitions.recovered}, отброшено ${transitions.discarded}`,
      );
    }
    const compositions = await recoverCompositionPublications();
    if (compositions.recovered > 0 || compositions.aborted > 0 || compositions.issues.length > 0) {
      console.info(
        `[composition-recovery] восстановлено ${compositions.recovered}, отменено ${compositions.aborted}${compositions.issues.length > 0 ? `; ${compositions.issues.join("; ")}` : ""}`,
      );
    }
    const compositionTransitions = await recoverCompositionTransitions();
    if (
      compositionTransitions.recovered > 0 ||
      compositionTransitions.aborted > 0 ||
      compositionTransitions.issues.length > 0
    ) {
      console.info(
        `[composition-transition-recovery] восстановлено ${compositionTransitions.recovered}, отменено ${compositionTransitions.aborted}${compositionTransitions.issues.length > 0 ? `; ${compositionTransitions.issues.join("; ")}` : ""}`,
      );
    }
  } catch (error) {
    console.error("[rules-recovery] recovery при старте не выполнен:", error);
  }

  const publicationConfig = evaluateRulesPublicationConfig();
  if (publicationConfig.issues.length > 0) {
    console.error(
      "[rules-publication] несогласованная конфигурация:",
      publicationConfig.issues.join("; "),
    );
  } else if (publicationConfig.production) {
    console.info(
      publicationConfig.blocked
        ? "[rules-publication] production-публикация заблокирована (D-9/CA-T-511)."
        : "[rules-publication] production-публикация разрешена конфигурацией.",
    );
  }

  const interval = resolveBackupIntervalMs(
    process.env.NODE_ENV,
    process.env.FORMAKUB_BACKUP_INTERVAL_MS,
  );
  if (interval > 0) {
    const timer = setInterval(() => {
      void runScheduledBackup().catch((error) => {
        console.error("[backup] плановая резервная копия не выполнена:", error);
      });
    }, interval);
    timer.unref?.();
  }

  if (
    resolveRecalcWorkerEnabled(
      process.env.NODE_ENV,
      process.env.FORMAKUB_RECALC_WORKER,
    )
  ) {
    await startRecalculationRuntimeWorker();
    const stopWorker = () => stopRecalculationRuntimeWorker();
    process.once("SIGTERM", stopWorker);
    process.once("SIGINT", stopWorker);
    process.once("beforeExit", stopWorker);
  }
}
