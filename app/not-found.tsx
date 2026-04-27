import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="text-2xl font-semibold text-content">Página não encontrada</h1>
      <p className="text-sm text-content-muted">
        Confira se o endereço está certo e se o terminal do <code className="rounded bg-white/10 px-1.5 py-0.5">npm run dev</code> mostra a mesma porta
        (ex.: 3000 ou 3001). Se o app travou, rode <code className="rounded bg-white/10 px-1.5 py-0.5">npm run dev:clean</code>.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-hover"
        >
          Ir ao início
        </Link>
        <Link href="/login" className="rounded-full border border-white/15 px-5 py-2 text-sm font-medium text-content hover:bg-white/5">
          Login cliente
        </Link>
        <Link href="/admin/login" className="rounded-full border border-white/15 px-5 py-2 text-sm font-medium text-content hover:bg-white/5">
          Login admin
        </Link>
      </div>
    </div>
  );
}
