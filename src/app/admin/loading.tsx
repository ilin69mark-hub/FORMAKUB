export default function AdminLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-3 w-40 rounded-full bg-ink/10" />
      <div className="mt-4 h-9 w-2/3 max-w-md rounded-2xl bg-ink/8" />
      <div className="mt-3 h-4 w-full max-w-xl rounded-full bg-ink/7" />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 rounded-[var(--radius-card)] border border-white/60 bg-white/32"
          />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-[var(--radius-card)] border border-white/60 bg-white/32" />
        <div className="h-56 rounded-[var(--radius-card)] border border-white/60 bg-white/32" />
      </div>
    </div>
  );
}
