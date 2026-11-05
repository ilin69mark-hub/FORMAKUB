import Link from "next/link";
import { CubeMark } from "@/components/ui/CubeMark";

export function Logo({
  light = false,
  compact = false,
}: {
  light?: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label="FORMAKUB — на главную"
      className={`group inline-flex items-center leading-none ${
        light ? "gap-5" : "gap-4"
      }`}
    >
      <CubeMark size={light ? 56 : 46} className="shrink-0" />
      <span className="flex flex-col leading-none">
        <span
          className={`text-[0.98rem] font-extrabold tracking-[0.18em] transition-colors ${
            light ? "text-cream" : "text-ink"
          }`}
        >
          FORMAKUB
        </span>
        {!compact && (
          <span
            className={`mt-1.5 text-[0.53rem] font-medium uppercase tracking-[0.24em] ${
              light ? "text-cream/45" : "text-ink/45"
            }`}
          >
            мебель по размерам
          </span>
        )}
      </span>
    </Link>
  );
}
