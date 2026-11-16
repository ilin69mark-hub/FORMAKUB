import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import type { BackupResult } from "./backup";
import { backupDatabase } from "./backup";

/**
 * S3-совместимая выгрузка резервных копий (ADR-03: внешнее
 * S3-совместимое хранилище) с конфигурацией через ENV.
 *
 * Переменные: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
 * `S3_SECRET_ACCESS_KEY` (обязательные для включения), `S3_REGION`
 * (по умолчанию `us-east-1`), `S3_PREFIX` (по умолчанию `backups/`).
 * Без полного набора выгрузка **выключена** — никаких значений по
 * умолчанию не выдумывается (credentials не создаются).
 *
 * Транспорт: path-style PUT с подписью AWS Signature V4
 * (`x-amz-content-sha256`, `x-amz-date`, canonical request) на чистом
 * `fetch`/`node:crypto` — без новых зависимостей.
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

export interface S3UploadResult {
  key: string;
  status: number;
  etag?: string;
}

/** Конфигурация из ENV; неполный набор → `null` (выгрузка выключена). */
export function s3ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3Config | null {
  const endpoint = env.S3_ENDPOINT?.trim().replace(/\/+$/, "");
  const bucket = env.S3_BUCKET?.trim();
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    region: env.S3_REGION?.trim() || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: (env.S3_PREFIX ?? "backups/").replace(/^\/+|\/+$/g, ""),
  };
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** AWS Signature V4 для PUT (path-style; канонические заголовки host/x-amz-*). */
export function signedPutRequest(
  config: S3Config,
  key: string,
  body: Buffer,
  now = new Date(),
): { url: string; method: "PUT"; headers: Record<string, string> } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const uri =
    "/" +
    config.bucket +
    "/" +
    key
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/");
  const host = new URL(config.endpoint).host;
  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    uri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest, "utf8")),
  ].join("\n");

  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return {
    url: `${config.endpoint}${uri}`,
    method: "PUT",
    headers: {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** Загрузка файла в S3-совместимое хранилище. Ошибки не маскируются. */
export async function uploadFileToS3(
  config: S3Config,
  localPath: string,
  remoteKey?: string,
): Promise<S3UploadResult> {
  const key = `${config.prefix ? `${config.prefix}/` : ""}${remoteKey ?? basename(localPath)}`;
  const body = readFileSync(localPath);
  const request = signedPutRequest(config, key, body);
  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body: new Uint8Array(body),
  });
  if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `S3-выгрузка отклонена: HTTP ${response.status} ${response.statusText} (${request.url}) ${text.slice(0, 200)}`,
    );
  }
  return {
    key,
    status: response.status,
    etag: response.headers.get("etag") ?? undefined,
  };
}

/**
 * Один полный цикл планового бэкапа: копия (+ ротация 48/30/12 внутри
 * `backupDatabase`) и — при настроенном ENV — выгрузка во внешнее
 * S3-совместимое хранилище. Без конфигурации S3 выгрузка пропускается.
 */
export async function runScheduledBackup(): Promise<{
  backup: BackupResult;
  uploaded: S3UploadResult | null;
}> {
  const backup = await backupDatabase();
  const config = s3ConfigFromEnv();
  const uploaded = config ? await uploadFileToS3(config, backup.file) : null;
  return { backup, uploaded };
}
