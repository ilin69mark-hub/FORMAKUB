import type { ActorContext } from "./parameters";

/**
 * CA-T-502/503 — явная локальная идентичность вызова из панели.
 *
 * Аутентификация не подключена (CA-T-602/603), поэтому актор не выдаётся
 * за пользователя с ролью: в аудит попадает фактический источник вызова.
 */
export const LOCAL_ACTOR: ActorContext = {
  actorId: "local-ui",
  actorRole: "local-prototype",
};
