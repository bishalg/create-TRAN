import { type SupportedLocale, TRAN_LOCALES, t } from '@tran/core';
import { TranStack } from '../shared/ui/TranStack.js';
import { TranSurface } from '../shared/ui/TranSurface.js';
import { TranText } from '../shared/ui/TranText.js';

/** The fragment id of each language's section, so the language links work without a script. */
export const sectionId = (locale: SupportedLocale) => `account-deletion-${locale}`;

function LocaleSection({ locale }: { locale: SupportedLocale }) {
  const steps = [
    t('auth.deletionPage.stepOpen', locale),
    t('auth.deletionPage.stepChoose', locale, {
      deleteAction: t('common.deleteAccount', locale),
      signOutAction: t('common.signOut', locale),
    }),
    t('auth.deletionPage.stepConfirm', locale),
  ];
  return (
    <TranSurface
      padding="lg"
      radius="lg"
      className="deletion-section"
      role="region"
      id={sectionId(locale)}
      lang={locale}
      aria-labelledby={`${sectionId(locale)}-title`}
    >
      <TranStack gap="md">
        <TranText variant="title" as="h2" id={`${sectionId(locale)}-title`}>
          {t('auth.deletionPage.title', locale)}
        </TranText>
        <TranText variant="body">{t('auth.deletionPage.intro', locale)}</TranText>

        <TranText variant="title" as="h3">
          {t('auth.deletionPage.howTitle', locale)}
        </TranText>
        <ol className="deletion-steps">
          {steps.map((step) => (
            <li key={step}>
              <TranText variant="body" as="span">
                {step}
              </TranText>
            </li>
          ))}
        </ol>

        <TranText variant="title" as="h3">
          {t('auth.deletionPage.deletedTitle', locale)}
        </TranText>
        <TranText variant="body">{t('auth.deletionPage.deletedBody', locale)}</TranText>

        <TranText variant="title" as="h3">
          {t('auth.deletionPage.keptTitle', locale)}
        </TranText>
        <TranText variant="body">{t('auth.deletionPage.keptBody', locale)}</TranText>

        {/* The web app is where the action is performed (REQ-ACC-007). */}
        <a className="tran-button deletion-open-app" data-variant="primary" href="/">
          {t('auth.deletionPage.openApp', locale)}
        </a>
      </TranStack>
    </TranSurface>
  );
}

/**
 * The public account-deletion page (REQ-ACC-007, ADR-0041): what the stores link to. It is
 * rendered to static HTML at build time, in every app language at once, so it needs no session,
 * no app and no script; the language links jump to a section.
 */
export function AccountDeletionPage() {
  return (
    <main id="main" className="shell deletion-page">
      <TranText variant="display" as="h1">
        {t('common.appName', 'en')}
      </TranText>
      <nav aria-label={t('shell.language.label', 'en')} className="segmented deletion-languages">
        {TRAN_LOCALES.map((locale) => (
          <a
            key={locale}
            className="tran-button segmented-item"
            data-variant="secondary"
            data-size="md"
            href={`#${sectionId(locale)}`}
            hrefLang={locale}
            lang={locale}
          >
            {locale.toUpperCase()}
          </a>
        ))}
      </nav>
      {TRAN_LOCALES.map((locale) => (
        <LocaleSection key={locale} locale={locale} />
      ))}
    </main>
  );
}
