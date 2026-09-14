async (page) => {
  await page.reload();
  await page.getByRole('navigation').first().getByRole('button', { name: 'Insights', exact: true }).click();
  await page.getByRole('button', { name: 'Caso Caso 1', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Executar este caso', exact: true }).click();
  const alert = page.getByRole('alert').last();
  await alert.waitFor();
  const summary = await alert.innerText();
  if (!summary.includes('Não foi possível concluir o benchmark deste modelo.') || summary.includes('QA fixture:')) throw new Error(summary);
  const details = alert.locator('details');
  if (await details.getAttribute('open') !== null) throw new Error('Raw error was expanded by default');
  await details.getByText('Detalhes técnicos', { exact: true }).click();
  const raw = await details.innerText();
  if (!raw.includes('QA fixture: unsupported operation')) throw new Error('Original fixture failure was not retained');
  await page.screenshot({ path: 'output/playwright/single-model-error-pt-BR.png', animations: 'disabled' });
  return { summary, rawPreserved: true };
}
