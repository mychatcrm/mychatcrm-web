type BlogSearchFormProps = {
  query?: string;
  niche?: string;
  niches: string[];
  total: number;
};

export function BlogSearchForm({ query = "", niche = "", niches, total }: BlogSearchFormProps) {
  return (
    <section className="rounded-2xl border border-line/80 bg-surface-card p-4 sm:p-6" aria-labelledby="blog-search-title">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Busca editorial</p>
          <h2 id="blog-search-title" className="mt-2 font-display text-2xl font-bold text-content">
            Encontre o guia ideal para o seu nicho
          </h2>
        </div>
        <p className="text-sm text-content-muted">{total} artigo(s) encontrados</p>
      </div>
      <form action="/blog" className="grid gap-3 md:grid-cols-[1fr_260px_auto]">
        <label className="sr-only" htmlFor="q">
          Buscar por título, nicho ou conteúdo
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Busque por clínica, CRM, automação, conversão..."
          className="min-h-[48px] rounded-xl border border-line bg-surface-deep px-4 text-sm text-content placeholder:text-content-muted transition focus:border-primary"
        />
        <label className="sr-only" htmlFor="niche">
          Filtrar por nicho
        </label>
        <select
          id="niche"
          name="niche"
          defaultValue={niche}
          className="min-h-[48px] rounded-xl border border-line bg-surface-deep px-4 text-sm text-content transition focus:border-primary"
        >
          <option value="">Todos os nichos</option>
          {niches.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Buscar
        </button>
      </form>
      {(query || niche) && (
        <a href="/blog" className="mt-4 inline-flex text-sm font-medium text-content-secondary transition hover:text-primary">
          Limpar filtros
        </a>
      )}
    </section>
  );
}
