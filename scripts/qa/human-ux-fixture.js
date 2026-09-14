async (page) => {
  await page.addInitScript(() => {
    const id = 'f750c9c0-c39f-45e2-b8e6-5562efa53cbe';
    const summary = {versionId:`benchmark-${id}@1`,benchmarkId:`benchmark-${id}`,versionNumber:1,contentHash:'a'.repeat(64),createdAt:'2026-09-13T21:14:00Z'};
    const profile = {profileId:`profile-${id}`,profileRevisionId:`profile-${id}@1`,revision:1,model:'Qwen 3.5 9B - long model name for responsive desktop readability '.repeat(3),runtime:'ollama',parameters:{},systemPrompt:null};
    const document = {schemaVersion:1,kind:'benchmark',benchmark:{benchmarkId:summary.benchmarkId,name:'Benchmark de raciocinio com um nome extenso para verificar a leitura e o alinhamento'},benchmarkVersion:{versionId:summary.versionId,versionNumber:1,defaultRepetitions:1,tasks:[{taskId:'task-1',name:'Tarefa de raciocinio',prompt:'Respond clearly',cases:[{caseId:'case-1',prompt:'What is 2 + 2?',expected:'4'}]}]}};
    const run = {runId:`arena-${id}-1-1`,benchmarkVersionId:summary.versionId,profileRevisionIds:[profile.profileRevisionId],status:'completed',startedAt:'2026-09-13T21:14:00Z',attemptIds:['attempt-1'],environment:{}};
    window.__TAURI_INTERNALS__ = {invoke: async (command) => {
      switch(command){
        case 'app_status': return {appName:'Prompt Arena',protocolVersion:1,platform:'windows',storageReady:true};
        case 'list_benchmark_versions':return [summary];
        case 'get_benchmark_version':return {summary,documentJson:JSON.stringify(document)};
        case 'list_profile_revisions':return [profile];
        case 'list_runs':return [run];
        case 'list_local_ollama_models':return [];
        case 'list_arena_summaries':case 'list_roadmap_records':case 'list_run_attempts':case 'list_benchmark_drafts':case 'list_official_packs':case 'list_external_providers':case 'list_external_generation_evidence':case 'list_model_operations':case 'list_model_removals':case 'list_calibration_results':case 'list_tournament_results':return [];
        default:throw new Error('QA fixture: unsupported operation '+command);
      }
    }};
  });
  await page.goto('http://localhost:1422');
}
