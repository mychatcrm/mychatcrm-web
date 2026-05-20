/** Renderiza trechos estáticos de legal.json (apenas <strong>). */
export function LegalRichText({ html }: { html: string }) {
  const parts = html.split(/(<strong>.*?<\/strong>)/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^<strong>(.*)<\/strong>$/);
        if (match) {
          return <strong key={i}>{match[1]}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
