async (page) => {
  const results = [];
  for (const [motionScale, reducedMotion] of [[0, false], [100, false], [200, false], [200, true]]) {
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await page.evaluate(({ motionScale, reducedMotion }) => {
      localStorage.setItem('prompt-arena-locale', 'pt-BR');
      localStorage.setItem('prompt-arena.appearance.v1', JSON.stringify({ surfaceId: 'paper', motionScale, reducedMotion, fontScale: 115 }));
    }, { motionScale, reducedMotion });
    await page.setViewportSize({ width: 960, height: 600 });
    await page.reload();
    await page.getByRole('navigation').first().getByRole('button', { name: 'Insights', exact: true }).click();
    const trigger = page.getByRole('button', { name: /^Configura.*Qwen/ });
    await trigger.waitFor();
    await trigger.evaluate(el => { window.scrollBy(0, el.getBoundingClientRect().bottom - innerHeight + 20); });
    await trigger.press('ArrowDown');
    const listbox = page.getByRole('listbox');
    await listbox.waitFor();
    await page.locator('[role="listbox"][data-state="open"]').waitFor();
    await page.waitForFunction(() => document.querySelector('[role="listbox"]')?.contains(document.activeElement), undefined, { timeout: 3000 });
    await page.screenshot({ path: `output/playwright/dropdown-${motionScale}-${reducedMotion}.png`, animations: 'disabled' });
    const state = await listbox.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: innerWidth, height: innerHeight, keyboardFocused: el.contains(document.activeElement) };
    });
    if (state.top < -1 || state.left < -1 || state.right > state.width + 1 || state.bottom > state.height + 1 || !state.keyboardFocused) throw new Error(JSON.stringify(state));
    await page.getByRole('option').first().press('Escape');
    if (await trigger.getAttribute('aria-expanded') !== 'false') throw new Error('Escape did not close dropdown');
    if (!(await trigger.evaluate(el => el === document.activeElement))) throw new Error('Focus was not restored');
    await trigger.press('Enter');
    await page.getByRole('option').first().press('Enter');
    if (await trigger.getAttribute('aria-expanded') !== 'false') throw new Error('Selection did not close dropdown');
    results.push({ motionScale, reducedMotion, ...state });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return results;
}
