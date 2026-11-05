"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  PencilLine,
  Send,
  X,
} from "lucide-react";
import type {
  FurnitureConfig,
  FurnitureInterest,
} from "@/lib/configurator/types";
import { calculatePrice, formatRub, kitchenTotalWidth } from "@/lib/configurator/pricing";
import { isConfigValid, validateConfig } from "@/lib/configurator/validation";
import { loadLocalDraft } from "@/lib/configurator/storage";
import { FURNITURE_TYPES } from "@/content/catalog";
import { KitchenScene } from "@/components/configurator/KitchenScene";
import { WardrobeScene } from "@/components/configurator/WardrobeScene";

const INTERESTS: { id: FurnitureInterest; label: string }[] = [
  { id: "kitchen", label: "Кухня" },
  { id: "wardrobe", label: "Шкаф" },
  { id: "dressing", label: "Гардеробная" },
  { id: "dressers", label: "Комод или тумба" },
  { id: "other", label: "Другая мебель" },
];

const CONTACT_METHODS = [
  { id: "phone", label: "Телефон" },
  { id: "telegram", label: "Telegram" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
] as const;

type PreferredContact = (typeof CONTACT_METHODS)[number]["id"];

interface LeadFormProps {
  initialConfig?: FurnitureConfig | null;
  autoAttachDraft?: boolean;
  source?: string;
  submitLabel?: string;
  hideIntro?: boolean;
  onSuccess?: (leadId: string) => void;
}

interface SuccessState {
  leadId: string;
  total: number | null;
}

function configSummary(config: FurnitureConfig): string {
  if (config.kind === "kitchen") {
    return `${Math.round(kitchenTotalWidth(config))} см · ${config.modules.length} модул.`;
  }
  const width = config.sections.reduce((sum, section) => sum + section.width, 0);
  return `${Math.round(width)} × ${Math.round(config.height)} см · ${config.sections.length} секц.`;
}

export function LeadForm({
  initialConfig = null,
  autoAttachDraft = false,
  source = "site",
  submitLabel = "Отправить заявку",
  hideIntro = false,
  onSuccess,
}: LeadFormProps) {
  const [config, setConfig] = useState<FurnitureConfig | null>(initialConfig);
  const [interest, setInterest] = useState<FurnitureInterest>(
    initialConfig?.kind === "wardrobe" ? "wardrobe" : "kitchen",
  );
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [preferredContact, setPreferredContact] = useState<PreferredContact>("phone");
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<SuccessState | null>(null);

  useEffect(() => {
    if (initialConfig || !autoAttachDraft) return;
    const timer = window.setTimeout(() => {
      const draft = loadLocalDraft("kitchen") ?? loadLocalDraft("wardrobe");
      if (draft) {
        setConfig(draft);
        setInterest(draft.kind === "wardrobe" ? "wardrobe" : "kitchen");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialConfig, autoAttachDraft]);

  const preview = useMemo(() => {
    if (!config) return null;
    return calculatePrice(config);
  }, [config]);

  const attachedInvalid = useMemo(() => {
    if (!config) return null;
    const issues = validateConfig(config);
    return isConfigValid(issues) ? null : issues.find((issue) => issue.severity === "error");
  }, [config]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const nextFieldErrors: Record<string, string> = {};
    if (name.trim().length < 2) nextFieldErrors.name = "Укажите имя.";
    if (contact.trim().length < 5)
      nextFieldErrors.contact = "Укажите телефон, @telegram или другой способ связи.";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      nextFieldErrors.email = "Проверьте адрес email.";
    if (preferredContact === "email" && !email.trim())
      nextFieldErrors.email = "Для связи по email укажите адрес.";
    if (!consent) nextFieldErrors.consent = "Нужно согласие на обработку данных.";
    if (config && attachedInvalid) {
      nextFieldErrors.config = "В конфигурации есть ошибки. Вернитесь в конфигуратор и исправьте их.";
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError("");
      return;
    }

    setFieldErrors({});
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: config ?? undefined,
          interest: config ? undefined : interest,
          source,
          website,
          customer: {
            name: name.trim(),
            contact: contact.trim(),
            email: email.trim() || undefined,
            preferredContact,
            comment: comment.trim() || undefined,
            consent: true,
          },
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: boolean; leadId?: string; total?: number | null; error?: string }
        | null;

      if (!response.ok || !data?.ok || !data.leadId) {
        setError(
          data?.error ??
            "Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.",
        );
        return;
      }

      setSuccess({ leadId: data.leadId, total: data.total ?? null });
      onSuccess?.(data.leadId);
    } catch {
      setError("Не удалось связаться с сервером. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div
        className="flex min-h-[28rem] flex-col justify-center rounded-[1.5rem] border border-emerald-900/10 bg-white/60 p-6 text-center sm:p-10"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-700/10 text-emerald-700">
          <CheckCircle2 size={26} strokeWidth={1.7} />
        </div>
        <h3 className="mt-5 font-display text-3xl leading-tight">
          Заявка сохранена
        </h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink/60">
          Номер заявки:{" "}
          <span className="font-semibold tracking-wide text-ink">{success.leadId}</span>
          . Конфигурация и предварительный расчёт приложены. Мы свяжемся удобным
          способом после проверки заявки.
        </p>
        {success.total != null && (
          <div className="mx-auto mt-5 rounded-2xl border border-ink/10 bg-cream/80 px-5 py-3">
            <div className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink/45">
              Ориентир по стоимости
            </div>
            <div className="mt-1 font-display text-2xl">{formatRub(success.total)}</div>
            <div className="text-[0.62rem] text-ink/45">Не является офертой</div>
          </div>
        )}
        <p className="mt-4 text-xs leading-relaxed text-ink/45">
          Онлайн-оплата не требуется. Окончательные цена, доставка и монтаж
          согласуются отдельно.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setSuccess(null);
              setName("");
              setContact("");
              setEmail("");
              setComment("");
              setConsent(false);
              setError("");
            }}
            className="btn btn-glass btn-sm"
          >
            Отправить ещё одну
          </button>
          <Link
            href={`/configurator/${config?.kind === "wardrobe" ? "wardrobe" : "kitchen"}`}
            className="btn btn-primary btn-sm"
          >
            Вернуться в конфигуратор
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {!hideIntro && (
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Заявка</span>
            <span className="badge-demo">demo</span>
          </div>
          <h3 className="mt-3 font-display text-[clamp(1.8rem,3vw,2.4rem)] leading-[1.05]">
            Обсудим ваш проект
          </h3>
        </div>
      )}

      {config ? (
        <div className="rounded-2xl border border-ink/10 bg-white/55 p-3">
          <div className="flex items-center gap-3">
            <div className="hidden h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-ink/8 bg-[#f5efe6] sm:block lg:h-28 lg:w-36">
              {config.kind === "kitchen" ? (
                <KitchenScene
                  config={config}
                  compact
                  showDimensions={false}
                  className="h-full w-full"
                />
              ) : (
                <WardrobeScene
                  config={config}
                  compact
                  showDimensions={false}
                  className="h-full w-full"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-copper">
                Конфигурация приложена
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold">
                  {FURNITURE_TYPES[config.kind].label}
                </span>
                <span className="text-[0.7rem] text-ink/50">{configSummary(config)}</span>
              </div>
              {preview && (
                <div className="mt-0.5 text-[0.7rem] text-ink/50">
                  Ориентир: <span className="font-semibold text-ink/75">{formatRub(preview.total)}</span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={`/configurator/${config.kind}`}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/10 bg-white/70 text-ink/60 transition-colors hover:text-ink"
                aria-label="Изменить конфигурацию"
              >
                <PencilLine size={14} />
              </Link>
              <button
                type="button"
                onClick={() => {
                  setConfig(null);
                  setInterest(config.kind === "wardrobe" ? "wardrobe" : "kitchen");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/10 bg-white/70 text-ink/60 transition-colors hover:text-ink"
                aria-label="Открепить конфигурацию"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          {attachedInvalid && (
            <p className="mt-2 text-[0.68rem] text-red-800/80">
              {attachedInvalid.message}
            </p>
          )}
        </div>
      ) : (
        <div className="field">
          <label className="field-label" htmlFor="lead-interest">
            Что вас интересует
          </label>
          <select
            id="lead-interest"
            value={interest}
            onChange={(event) => setInterest(event.target.value as FurnitureInterest)}
            className="select"
          >
            {INTERESTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label className="field-label" htmlFor="lead-name">
            Имя
          </label>
          <input
            id="lead-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="input"
            placeholder="Как к вам обращаться"
            autoComplete="name"
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "lead-name-error" : undefined}
            required
          />
          {fieldErrors.name && (
            <p id="lead-name-error" className="error-text">
              {fieldErrors.name}
            </p>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="lead-contact">
            Телефон или мессенджер
          </label>
          <input
            id="lead-contact"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            className="input"
            placeholder="+7 ··· или @username"
            autoComplete="tel"
            aria-invalid={Boolean(fieldErrors.contact)}
            aria-describedby={fieldErrors.contact ? "lead-contact-error" : undefined}
            required
          />
          {fieldErrors.contact && (
            <p id="lead-contact-error" className="error-text">
              {fieldErrors.contact}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label className="field-label" htmlFor="lead-email">
            Email <span className="font-normal text-ink/35">— по желанию</span>
          </label>
          <input
            id="lead-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input"
            placeholder="name@example.com"
            autoComplete="email"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "lead-email-error" : undefined}
          />
          {fieldErrors.email && (
            <p id="lead-email-error" className="error-text">
              {fieldErrors.email}
            </p>
          )}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="lead-method">
            Предпочтительный способ связи
          </label>
          <select
            id="lead-method"
            value={preferredContact}
            onChange={(event) =>
              setPreferredContact(event.target.value as PreferredContact)
            }
            className="select"
          >
            {CONTACT_METHODS.map((method) => (
              <option key={method.id} value={method.id}>
                {method.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="lead-comment">
          Комментарий <span className="font-normal text-ink/35">— по желанию</span>
        </label>
        <textarea
          id="lead-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="textarea"
          placeholder="Город, помещение, пожелания, ссылка на референс"
          maxLength={1000}
        />
      </div>

      <div className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden>
        <label htmlFor="lead-website">Website</label>
        <input
          id="lead-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          aria-invalid={Boolean(fieldErrors.consent)}
          required
        />
        <span>
          Согласен на обработку персональных данных в соответствии с{" "}
          <Link href="/privacy" className="underline decoration-ink/25 underline-offset-2 hover:text-ink">
            политикой
          </Link>
          . Понимаю, что расчёт предварительный.
        </span>
      </label>
      {fieldErrors.consent && <p className="error-text">{fieldErrors.consent}</p>}
      {fieldErrors.config && <p className="error-text">{fieldErrors.config}</p>}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-800/15 bg-red-700/6 px-3 py-2 text-[0.72rem] leading-relaxed text-red-900/80" role="alert">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn btn-primary w-full"
      >
        {submitting ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            Сохраняем заявку…
          </>
        ) : (
          <>
            {submitLabel}
            <Send size={14} />
          </>
        )}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-center text-[0.63rem] text-ink/40">
        <Lock size={11} />
        Заявка сохраняется на сервере. Без онлайн-оплаты.
      </p>
      <p className="sr-only" aria-live="polite">
        {submitting ? "Отправляем заявку" : ""}
      </p>
    </form>
  );
}
