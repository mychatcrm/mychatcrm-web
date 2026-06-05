import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LEGAL_PRIVACY_PATHNAME } from "@/lib/legal-routes";
import { LegalRichText } from "@/components/legal/LegalRichText";
import { LegalSection, LEGAL_CONTACT_EMAIL, PublicLegalPageShell } from "@/components/legal/PublicLegalPageShell";

type SectionBlock = {
  title: string;
  intro?: string;
  paragraphs?: string[];
  list?: string[];
  subIntro?: string;
  subList?: string[];
};

function renderParagraphs(paragraphs: string[] | undefined) {
  if (!paragraphs?.length) return null;
  return paragraphs.map((p) => (
    <p key={p} className="mt-3 first:mt-0">
      <LegalRichText html={p} />
    </p>
  ));
}

function renderList(items: string[] | undefined) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 list-disc space-y-2 pl-6">
      {items.map((item) => (
        <li key={item}>
          <LegalRichText html={item} />
        </li>
      ))}
    </ul>
  );
}

function renderSection(block: SectionBlock) {
  return (
    <LegalSection title={block.title}>
      {block.intro ? <p>{block.intro}</p> : null}
      {renderList(block.list)}
      {renderParagraphs(block.paragraphs)}
      {block.subIntro ? <p className="mt-3">{block.subIntro}</p> : null}
      {block.subList ? (
        <ul className="mt-2 list-disc space-y-1 pl-6">
          {block.subList.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </LegalSection>
  );
}

export async function LocalizedTermsPage() {
  const locale = await getLocale();
  const t = await getTranslations("legal");
  const sections = t.raw("termsPage.sections") as Record<string, SectionBlock>;
  const homeHref = `/${locale}`;

  return (
    <PublicLegalPageShell
      title={t("termsPage.title")}
      updated={t("termsPage.updated")}
      homeHref={homeHref}
      backHomeLabel={t("shell.backHome")}
      updatedLabel={t("shell.updatedLabel")}
      footer={
        <p>
          {t("termsPage.footerBefore")}
          <Link href={LEGAL_PRIVACY_PATHNAME} className="text-primary hover:underline">
            {t("termsPage.footerLink")}
          </Link>
          {t("termsPage.footerAfter")}
        </p>
      }
    >
      {renderSection(sections.acceptance)}
      {renderSection(sections.permittedUse)}
      {renderSection(sections.responsibilities)}
      {renderSection(sections.cancellation)}
      {renderSection(sections.liability)}
      {renderSection(sections.changes)}
      <LegalSection title={sections.contact.title}>
        {renderParagraphs(sections.contact.paragraphs)}
        <p className="mt-3">
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </PublicLegalPageShell>
  );
}
