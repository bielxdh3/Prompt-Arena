async (page) => {
 const results=[];
 for (const locale of ['en','pt-BR']) {
  for (const surfaceId of ['neutral','warm','paper']) {
   for (const width of [960,1280]) {
    const prefs={surfaceId,motionScale:100,reducedMotion:false,fontScale:100};
    await page.evaluate(({locale,prefs})=>{localStorage.setItem('prompt-arena-locale',locale);localStorage.setItem('prompt-arena.appearance.v1',JSON.stringify(prefs));},{locale,prefs});
    await page.setViewportSize({width,height:900});await page.reload();
    await page.getByRole('button',{name:'Insights',exact:true}).click();
    await page.getByRole('button',{name:locale==='en'?/^Model configuration Qwen/:/^Configura.*Qwen/}).waitFor();
    const audit=await page.evaluate(()=>{
     const panel=document.querySelector('[aria-labelledby="single-model-heading"]');const box=panel.getBoundingClientRect();
     const overflow=[...panel.querySelectorAll('button,.arena-select-control')].filter(el=>{const r=el.getBoundingClientRect();return r.left<box.left-1||r.right>box.right+1}).map(el=>el.textContent);
     const raw=[...document.querySelectorAll('h1,h2,h3,h4,.arena-listbox-trigger')].filter(el=>/[a-f0-9]{8}-[a-f0-9]{4}-/i.test(el.textContent)).map(el=>el.textContent);
     return {overflow,raw,documentOverflow:document.documentElement.scrollWidth>innerWidth};
    });
    if(audit.overflow.length||audit.raw.length||audit.documentOverflow)throw new Error(JSON.stringify({locale,surfaceId,width,audit}));
    await page.getByRole('heading',{name:locale==='en'?'Single-model benchmark':'Benchmark de modelo único',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/insights-${locale}-${surfaceId}-${width}.png`});
    results.push({locale,surfaceId,width,...audit});
   }
  }
 }
 console.log(JSON.stringify(results));
}

