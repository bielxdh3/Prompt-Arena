async (page) => {
  const results = [];
  const labels = {
    en: ['Overview', 'Arena', 'Advanced Arena', 'Insights', 'Benchmarks', 'Models', 'Runs', 'Settings'],
    'pt-BR': ['Visão geral', 'Arena', 'Arena avançada', 'Insights', 'Benchmarks', 'Modelos', 'Execuções', 'Configurações'],
  };
  for (const locale of ['en', 'pt-BR']) {
    for (const motionScale of [0, 100, 200]) {
      await page.evaluate(({ locale, motionScale }) => {
        localStorage.setItem('prompt-arena-locale', locale);
        localStorage.setItem('prompt-arena.appearance.v1', JSON.stringify({ surfaceId: 'neutral', motionScale, fontScale: 115 }));
      }, { locale, motionScale });
      await page.setViewportSize({ width: 960, height: 720 });
      await page.reload();
      for (const label of labels[locale]) {
        await page.getByRole('navigation').first().getByRole('button', { name: label, exact: true }).click();
        await page.getByRole('heading', { name: label, exact: true, level: 1 }).waitFor();
        await page.screenshot({ path: `output/playwright/navigation-${locale}-${motionScale}-${labels[locale].indexOf(label)}.png`, animations: 'disabled' });
        const audit = await page.evaluate(() => {
          const primary = [...document.querySelectorAll('h1,h2,h3,h4,.arena-listbox-trigger,.benchmark-record-row strong,.competitor-result-card h4,.advanced-ranking-list strong')].map((el) => el.textContent || '');
          const summaryLabels = [...document.querySelectorAll('.benchmark-record-row > span:first-child > small')]
            .flatMap((el) => [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent || ''));
          const raw = [...primary, ...summaryLabels].filter((text) => /[a-f0-9]{8}-[a-f0-9]{4}-/i.test(text));
          return { raw, overflow: document.documentElement.scrollWidth > innerWidth, replacement: document.body.innerText.includes('\uFFFD') };
        });
        results.push({ locale, motionScale, label, ...audit });
        if (audit.raw.length || audit.overflow || audit.replacement) throw new Error(JSON.stringify(results.at(-1)));
      }
    }
  }
  return results;
}
