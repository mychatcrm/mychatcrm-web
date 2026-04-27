/**
 * Estado de carregamento do painel do cliente.
 *
 * Mostrado pelo Next.js enquanto os Server Components da página estão
 * fazendo streaming (ex.: carregando sessão, dataset). O fundo dark
 * evita flash branco durante a transição.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 animate-pulse">
      {/* Linha de KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[88px] rounded-2xl border border-line/50 bg-surface-card/60"
          />
        ))}
      </div>
      {/* Bloco principal */}
      <div className="h-[320px] rounded-2xl border border-line/50 bg-surface-card/60" />
      {/* Bloco secundário */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-[200px] rounded-2xl border border-line/50 bg-surface-card/60" />
        <div className="h-[200px] rounded-2xl border border-line/50 bg-surface-card/60" />
      </div>
    </div>
  );
}
