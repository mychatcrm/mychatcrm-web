/**
 * Estado de carregamento do painel administrativo.
 *
 * Mostrado pelo Next.js enquanto os Server Components da página estão
 * fazendo streaming. O fundo dark evita flash branco durante a transição.
 */
export default function AdminLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 animate-pulse">
      {/* Linha de KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-[80px] rounded-xl border border-line/50 bg-surface-card/60"
          />
        ))}
      </div>
      {/* Gráfico principal */}
      <div className="h-[280px] rounded-xl border border-line/50 bg-surface-card/60" />
      {/* Blocos secundários */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-[180px] rounded-xl border border-line/50 bg-surface-card/60"
          />
        ))}
      </div>
    </div>
  );
}
