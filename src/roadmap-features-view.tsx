import { HumanError } from "./human-error";
import { displayName, numberedName, profileDisplayName, metricDisplayName, runtimeDisplayName } from "./display-names";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
  executeRunOnce,
  isDesktopEnvironment,
  readBenchmarkVersion,
  readBenchmarkVersions,
  readArenaSummaries,
  readLiveProfileModelIdentity,
  readProfileRevisions,
  readRoadmapRecords,
  saveRoadmapRecord,
  readHardwareSnapshot,
  saveBenchmarkVersion,
  validateBenchmarkDocument,
  type AttemptRecord,
  type ArenaSummaryRecord,
  type BenchmarkVersion,
  type BenchmarkVersionSummary,
  type HardwareSnapshot,
  type ProfileRevision,
  type RoadmapRecord,
  type RunRecord,
  type PersistedExecution,
} from "./bridge";
import { buildRunPlan } from "./run-plan";
import { caseOptions, parseArenaDocument, taskOptions, versionOptions, type ArenaDocument } from "./arena-ui";
import {
  buildSingleModelBenchmarkPayload,
  singleModelRecord,
  type SingleModelBenchmarkPayload,
} from "./single-model-benchmark";
import { buildSingleModelSuitePayload, executeSingleModelSuiteCases, singleModelSuiteRecord, type SingleModelSuitePayload } from "./single-model-suite";
import { buildPerformanceRecord, performanceEvidenceFromExecution } from "./performance-lab";
import { buildHistoricalRegressionExport, compareHistoricalRuns, compareRepeatedHistoricalRuns, REPEATED_METRIC_CONFIDENCE_LEVEL, type HistoricalRegression, type HistoricalSource, type RepeatedRunHistoricalRegression } from "./historical-regression";
import { computeGlobalAndCategoryRatings, isRatingSet, ratingOutcomesFromArenaSummaries, type ModelRating, type RatingRuleVersion, type RatingSet, type RatingUncertaintyMethod } from "./model-ratings";
import { executeRobustnessVariants, generatePerturbations, isEffectivePerturbation, scoreRobustness, type PerturbationType, type RobustnessResult, type RobustnessVariantOutcome } from "./robustness-arena";
import { canReproRunWithLocalIdentity, compareReproLocalIdentity, decodeReproBenchmarkDocumentChunks, encodeReproBenchmarkDocumentChunks, exportReproBundle, importReproBundle, matchesReproSource, reproModelArtifactFromProfile, reproRunRequest, verifyReproBenchmarkSnapshot, MAX_REPRO_BUNDLE_BYTES, ReproBundleImportError, type ReproBundleDifference, type ReproIdentityDifference, type ReproRunRequest } from "./repro-bundle";
import { AccessibleListbox } from "./accessible-listbox";
import { formatLocaleNumber, formatLocalePercent, formatMessage, translate } from "./i18n";

type SurfaceState =
  | { status: "loading" }
  | { status: "ready"; versions: BenchmarkVersionSummary[]; profiles: ProfileRevision[]; records: RoadmapRecord[]; summaries: ArenaSummaryRecord[] }
  | { status: "preview" }
  | { status: "error"; message: string };

type ActiveOperation =
  | { kind: "single" | "repro" | "robustness_baseline" }
  | { kind: "suite"; completed: number; total: number }
  | { kind: "robustness_variants"; completed: number; total: number };

function ratingUncertaintyMethodKey(method: RatingUncertaintyMethod | undefined): string {
  switch (method) {
    case "sample_count_heuristic": return "sample_count_heuristic";
    case "laplace_standard_error": return "laplace_standard_error";
    case "cluster_robust_standard_error_v1": return "cluster_robust_standard_error_v1";
    case "prior_only_standard_deviation_insufficient_clusters_v1": return "prior_only_standard_deviation_insufficient_clusters_v1";
    case "component_specific_v1": return "component_specific_v1";
    default: return "Uncertainty method not recorded";
  }
}

function ratingRowUncertaintyMethodKey(method: ModelRating["uncertaintyMethod"], setMethod: RatingUncertaintyMethod | undefined): string {
  if (method) return ratingUncertaintyMethodKey(method);
  return setMethod === "component_specific_v1" ? "Uncertainty method not recorded" : ratingUncertaintyMethodKey(setMethod);
}

function isUsableArenaSummary(value: unknown): value is ArenaSummaryRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const summary = record.summary;
  const competitors = record.competitors;
  const evidence = record.evidence;
  const finiteOrNull = (item: unknown) => item === null || (typeof item === "number" && Number.isFinite(item) && item >= 0);
  return typeof record.arenaId === "string" && record.arenaId.length > 0 && record.arenaId.length <= 128
    && typeof record.benchmarkVersionId === "string" && record.benchmarkVersionId.length > 0
    && typeof record.taskId === "string" && record.taskId.length > 0
    && typeof record.caseId === "string" && record.caseId.length > 0
    && typeof record.contentHash === "string" && /^[a-f0-9]{64}$/iu.test(record.contentHash)
    && typeof record.createdAt === "string"
    && (record.arenaWallTimeMs === undefined || finiteOrNull(record.arenaWallTimeMs))
    && summary !== null && typeof summary === "object" && !Array.isArray(summary)
    && Array.isArray(competitors) && competitors.length <= 8 && competitors.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))
    && Array.isArray(evidence) && evidence.length <= 80 && evidence.every((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
      const sample = item as Record<string, unknown>;
      return typeof sample.competitorId === "string"
        && typeof sample.runId === "string"
        && finiteOrNull(sample.durationMs)
        && (sample.ttftMs === undefined || finiteOrNull(sample.ttftMs))
        && (sample.tokensPerSecond === undefined || finiteOrNull(sample.tokensPerSecond));
    });
}

function encodeHistoricalSelection(kind: "single_model_benchmark" | "arena_summary", sourceId: string): string {
  return JSON.stringify([kind, sourceId]);
}

function resolveHistoricalSelection(
  selection: string,
  singlePayloads: SingleModelBenchmarkPayload[],
  arenaSummaries: ArenaSummaryRecord[],
): HistoricalSource | undefined {
  try {
    const decoded = JSON.parse(selection) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[1] !== "string") return undefined;
    if (decoded[0] === "single_model_benchmark") return singlePayloads.find((payload) => payload.runId === decoded[1]);
    if (decoded[0] === "arena_summary") return arenaSummaries.find((payload) => payload.arenaId === decoded[1]);
    return undefined;
  } catch {
    return undefined;
  }
}

let fallbackIdSequence = 0;
function newId(prefix: string): string {
  return `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${(++fallbackIdSequence).toString(36)}`}`;
}

function asRunRecord(execution: PersistedExecution): RunRecord {
  return execution.run;
}

function asAttemptRecord(execution: PersistedExecution): AttemptRecord {
  return execution.attempt;
}

export function RoadmapFeaturesView() {
  const [state, setState] = useState<SurfaceState>(() => isDesktopEnvironment() ? { status: "loading" } : { status: "preview" });
  const [version, setVersion] = useState<BenchmarkVersion | null>(null);
  const [document, setDocument] = useState<ArenaDocument | null>(null);
  const [versionId, setVersionId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [single, setSingle] = useState<SingleModelBenchmarkPayload | null>(null);
  const [performanceRunId, setPerformanceRunId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [regression, setRegression] = useState<HistoricalRegression | null>(null);
  const [baselineRunIds, setBaselineRunIds] = useState<string[]>([]);
  const [candidateRunIds, setCandidateRunIds] = useState<string[]>([]);
  const [repeatedRegression, setRepeatedRegression] = useState<RepeatedRunHistoricalRegression | null>(null);
  const [comparisonDownload, setComparisonDownload] = useState<{ url: string; fileName: string } | null>(null);
  const [ratingRuleVersion, setRatingRuleVersion] = useState<RatingRuleVersion>("elo-v1");
  const [selectedRobustnessRecordId, setSelectedRobustnessRecordId] = useState("");
  const [bundle, setBundle] = useState("");
  const [bundleDownloadUrl, setBundleDownloadUrl] = useState<string | null>(null);
  const bundleInput = useRef<HTMLInputElement>(null);
  const [importedBundle, setImportedBundle] = useState<ReproRunRequest | null>(null);
  const [legacyBundleUnverifiable, setLegacyBundleUnverifiable] = useState(false);
  const [bundleDifferences, setBundleDifferences] = useState<ReproBundleDifference[]>([]);

  async function refresh() {
    if (!isDesktopEnvironment()) {
      setState({ status: "preview" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [versions, profiles, records, summaries] = await Promise.all([
        readBenchmarkVersions(),
        readProfileRevisions(),
        readRoadmapRecords(),
        readArenaSummaries(),
      ]);
      setState({
        status: "ready",
        versions,
        profiles,
        records,
        summaries,
      });
      if (!versionId && versions[0]) setVersionId(versions[0].versionId);
      if (!profileId && profiles[0]) setProfileId(profiles[0].profileRevisionId);
    } catch (error: unknown) {
      setState({ status: "error", message: error instanceof Error ? error.message : "The local single-model evidence is unavailable." });
    }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => () => {
    if (bundleDownloadUrl) URL.revokeObjectURL(bundleDownloadUrl);
  }, [bundleDownloadUrl]);

  useEffect(() => () => {
    if (comparisonDownload) URL.revokeObjectURL(comparisonDownload.url);
  }, [comparisonDownload]);

  useEffect(() => {
    if (!versionId || !isDesktopEnvironment()) return;
    let active = true;
    void readBenchmarkVersion(versionId)
      .then((value) => {
        if (!active) return;
        setVersion(value);
        if (!value) {
          setDocument(null);
          return;
        }
        try {
          setDocument(parseArenaDocument(value.documentJson));
        } catch {
          setDocument(null);
        }
      })
      .catch(() => {
        if (active) {
          setVersion(null);
          setDocument(null);
        }
      });
    return () => { active = false; };
  }, [versionId]);

  const taskChoices = document ? taskOptions(document) : [];
  const caseChoices = document ? caseOptions(document, taskId) : [];

  useEffect(() => {
    setTaskId((current) => taskChoices.some((option) => option.value === current) ? current : taskChoices[0]?.value ?? "");
  }, [document]);

  useEffect(() => {
    setCaseId((current) => caseChoices.some((option) => option.value === current) ? current : caseChoices[0]?.value ?? "");
  }, [document, taskId]);

  const singlePayloads = useMemo(() => state.status === "ready"
    ? state.records.filter((record) => record.kind === "single_model_benchmark").map((record) => record.payload as unknown as SingleModelBenchmarkPayload)
    : [], [state]);
  const importedLocalIdentity = useMemo(() => {
    if (!importedBundle) return null;
    const localVersion = state.status === "ready" ? state.versions.find((item) => item.versionId === importedBundle.benchmarkVersionId) : undefined;
    const localProfile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === importedBundle.profileRevisionId) : undefined;
    return compareReproLocalIdentity(importedBundle, {
      benchmarkVersionId: localVersion?.versionId ?? null,
      benchmarkContentHash: localVersion?.contentHash ?? null,
      profileRevision: localProfile ?? null,
      modelArtifact: localProfile ? reproModelArtifactFromProfile(localProfile) : null,
    });
  }, [importedBundle, state]);
  const importedLocalVersionExists = importedBundle !== null && state.status === "ready"
    && state.versions.some((item) => item.versionId === importedBundle.benchmarkVersionId);
  const importedRerunReady = importedBundle !== null && importedBundle.executionControls.seed === null
    && importedLocalIdentity !== null
    && canReproRunWithLocalIdentity(importedLocalIdentity, importedLocalVersionExists);
  const importedSourceVerified = importedBundle !== null
    && importedLocalIdentity?.matches === true
    && singlePayloads.some((payload) => matchesReproSource(importedBundle, payload as unknown as Record<string, unknown>));
  const suitePayloads = useMemo(() => state.status === "ready"
    ? state.records.filter((record) => record.kind === "single_model_suite" && isSingleModelSuitePayload(record.payload)).map((record) => record.payload as unknown as SingleModelSuitePayload)
    : [], [state]);
  const performancePayload = singlePayloads.find((payload) => payload.runId === performanceRunId) ?? single ?? singlePayloads[0] ?? null;
  const singleRunOptions = singlePayloads.map((payload) => ({
    value: payload.runId,
    label: `${displayName(payload.profileRevision.model, "Model")} / ${numberedName("Run", payload.runId, singlePayloads.map((item) => item.runId))}`,
  }));
  const comparableArenaSummaries = state.status === "ready" ? state.summaries.filter(isUsableArenaSummary) : [];
  const historicalRunOptions = [
    ...singlePayloads.map((payload) => ({
      value: encodeHistoricalSelection("single_model_benchmark", payload.runId),
      label: `${displayName(payload.profileRevision.model, "Model")} / ${numberedName("Run", payload.runId, singlePayloads.map((item) => item.runId))}`,
    })),
    ...comparableArenaSummaries.map((summary) => ({
      value: encodeHistoricalSelection("arena_summary", summary.arenaId),
      label: `${translate("Arena")} / ${displayName(summary.taskId, "Task")} / ${displayName(summary.caseId, "Case")}`,
    })),
  ];
  const repeatedRunGroupsOverlap = baselineRunIds.some((runId) => candidateRunIds.includes(runId));

  const ratings = useMemo<RatingSet | null>(() => {
    if (state.status !== "ready") return null;
    const outcomes = ratingOutcomesFromArenaSummaries(state.summaries);
    if (outcomes.length === 0) return null;
    const sourceClusters = new Set(outcomes.map((outcome) => outcome.clusterId).filter((value): value is string => typeof value === "string"));
    const sourcePopulation = [...new Map(state.summaries
      .filter((summary) => sourceClusters.has(`arena-summary:${summary.contentHash}`))
      .map((summary) => [`${summary.arenaId}:${summary.contentHash}`, { arenaId: summary.arenaId, contentHash: summary.contentHash }] as const))
      .values()]
      .sort((left, right) => left.arenaId.localeCompare(right.arenaId) || left.contentHash.localeCompare(right.contentHash));
    return { ...computeGlobalAndCategoryRatings(outcomes, undefined, ratingRuleVersion), sourcePopulation };
  }, [state, ratingRuleVersion]);
  const ratingHistory = useMemo(() => state.status === "ready"
    ? state.records.filter((record) => record.kind === "model_ratings" && isRatingSet(record.payload)).map((record) => ({ recordId: record.recordId, payload: record.payload as unknown as RatingSet })).sort((left, right) => right.payload.createdAt.localeCompare(left.payload.createdAt))
    : [], [state]);
  const regressionHistory = useMemo(() => state.status === "ready"
    ? state.records.filter((record) => record.kind === "historical_regression" && (isHistoricalRegression(record.payload) || isRepeatedHistoricalRegression(record.payload))).map((record) => ({
      recordId: record.recordId,
      createdAt: record.createdAt,
      comparison: record.payload as unknown as HistoricalRegression | RepeatedRunHistoricalRegression,
    })).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    : [], [state]);
  const robustnessHistory = useMemo(() => state.status === "ready"
    ? state.records.filter((record) => record.kind === "robustness_arena" && isRobustnessResult(record.payload)).map((record) => ({
      recordId: record.recordId,
      result: record.payload as unknown as RobustnessResult,
    })).sort((left, right) => right.result.createdAt.localeCompare(left.result.createdAt))
    : [], [state]);
  const selectedRobustness = robustnessHistory.find((record) => record.recordId === selectedRobustnessRecordId) ?? robustnessHistory[0] ?? null;
  const activeOperationLabel = activeOperation === null ? null
    : activeOperation.kind === "single" ? translate("Running single benchmark")
      : activeOperation.kind === "repro" ? translate("Running reproduced benchmark")
        : activeOperation.kind === "suite" ? activeOperation.completed === 0 ? translate("Running benchmark suite") : formatMessage("Benchmark case {completed} of {total}", activeOperation)
          : activeOperation.kind === "robustness_baseline" ? translate("Running robustness baseline")
            : formatMessage("Running robustness variant {completed} of {total}", activeOperation);

  async function persistRatings() {
    if (!ratings) {
      setNotice(translate("No eligible head-to-head evidence"));
      return;
    }
    try {
      await saveRoadmapRecord({ recordId: newId("ratings"), kind: "model_ratings", payload: ratings as unknown as Record<string, unknown> });
      setNotice(translate("Ratings saved immutably."));
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("Ratings could not be saved."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  async function generateRobustness() {
    if (!version || !document || !profileId) {
      setNotice(translate("Choose a benchmark and immutable model profile first."));
      return;
    }
    const task = document.tasks.find((item) => item.taskId === taskId);
    const sourceCase = task?.cases.find((item) => item.caseId === caseId);
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!task || !sourceCase || !profile) {
      setNotice(translate("The selected immutable task, case, or profile is unavailable."));
      return;
    }
    const sourcePrompt = [task.prompt.trim(), sourceCase.prompt?.trim() ?? null].filter(Boolean).join("\n\n");
    const variants = generatePerturbations(sourcePrompt, sourceCase.expected, version.summary.versionId, 1, ["paraphrase", "instruction_reorder", "variable_rename", "formatting_variation", "concise_wording", "verbose_wording", "irrelevant_noise"] as PerturbationType[]);
    setBusy(true);
    setActiveOperation({ kind: "robustness_baseline" });
    setNotice(null);
    setErrorDetail(null);
    try {
      const hardware = await readHardwareSnapshot().catch(() => null);
      const basePlan = buildRunPlan({ runId: newId("robust-base"), version, taskId, caseId, profileRevision: profile, metadata: { mode: "robustness_arena", variant: "base", featureVersion: 1 } });
      let basePayload: SingleModelBenchmarkPayload | null = null;
      let baseRunId: string | undefined;
      let baseAttemptId: string | undefined;
      let basePassed: boolean | null = null;
      let baseStatus: "completed" | "failed" | "cancelled" | "unavailable" = "unavailable";
      let baseEvidenceSaved: boolean | undefined;
      let baseFailure: string | null = null;
      if (basePlan.executionBoundary.status === "available") {
        try {
          const baseExecution = await executeRunOnce(basePlan);
          baseRunId = baseExecution.run.runId;
          baseAttemptId = baseExecution.attempt.attemptId;
          baseStatus = baseExecution.attempt.status === "completed" ? "completed" : baseExecution.attempt.status === "cancelled" ? "cancelled" : "failed";
          const passed = baseExecution.attempt.result?.score;
          basePassed = passed && typeof passed === "object" && !Array.isArray(passed) && typeof (passed as Record<string, unknown>).passed === "boolean"
            ? (passed as Record<string, unknown>).passed as boolean
            : null;
          basePayload = buildSingleModelBenchmarkPayload({ run: baseExecution.run, attempt: baseExecution.attempt, profile, execution: baseExecution, performance: performanceEvidenceFromExecution(baseExecution), benchmarkVersionId: version.summary.versionId, benchmarkContentHash: version.summary.contentHash, taskId, caseId, hardware });
          try {
            await saveRoadmapRecord(singleModelRecord(basePayload));
            await saveRoadmapRecord(buildPerformanceRecord(basePayload));
            baseEvidenceSaved = true;
          } catch (error: unknown) {
            baseEvidenceSaved = false;
            baseFailure = error instanceof Error ? error.message : String(error);
          }
        } catch (error: unknown) {
          baseStatus = "failed";
          baseFailure = error instanceof Error ? error.message : String(error);
        }
      } else {
        baseFailure = basePlan.executionBoundary.reason ?? translate("The selected case is unavailable in this environment.");
      }
      let variantIndex = 0;
      const outcomes = await executeRobustnessVariants(
        variants,
        async (variant) => {
          variantIndex += 1;
          setActiveOperation({ kind: "robustness_variants", completed: variantIndex, total: variants.length });
          const runId = newId("robust");
          const plan = buildRunPlan({
            runId,
            version,
            taskId,
            caseId,
            profileRevision: profile,
            promptVariant: {
              version: variant.version,
              transformationType: variant.transformationType,
              seed: variant.seed,
              sourceTaskVersion: variant.sourceTaskVersion,
            },
            metadata: { mode: "robustness_arena", variantId: variant.perturbationId, transformVersion: variant.version, featureVersion: 1 },
          });
          if (plan.generation.prompt !== variant.prompt) throw new Error("The generated variant does not match its typed transformation request.");
          if (plan.executionBoundary.status !== "available") return { status: "unavailable", passed: null };
          if (!isEffectivePerturbation(variant, plan.generation.prompt ?? "", basePlan.generation.prompt ?? "")) return { status: "unavailable", passed: null };
          const execution = await executeRunOnce(plan);
          const status = execution.attempt.status === "completed" ? "completed" : execution.attempt.status === "cancelled" ? "cancelled" : "failed";
          const objective = execution.attempt.result?.score;
          const passed = objective && typeof objective === "object" && !Array.isArray(objective) && typeof (objective as Record<string, unknown>).passed === "boolean"
            ? (objective as Record<string, unknown>).passed as boolean
            : null;
          const payload = buildSingleModelBenchmarkPayload({ run: execution.run, attempt: execution.attempt, profile, execution, performance: performanceEvidenceFromExecution(execution), benchmarkVersionId: version.summary.versionId, benchmarkContentHash: version.summary.contentHash, taskId, caseId, hardware });
          return { status, passed, runId: execution.run.runId, attemptId: execution.attempt.attemptId, value: payload };
        },
        async (_variant, payload) => {
          await saveRoadmapRecord(singleModelRecord(payload));
          await saveRoadmapRecord(buildPerformanceRecord(payload));
        },
      );
      const result = scoreRobustness(basePassed, outcomes, undefined, { taskId, caseId, profileRevisionId: profile.profileRevisionId, baseRunId, baseAttemptId, baseEvidenceSaved, baseStatus });
      setSingle(basePayload);
      let recordId: string;
      try {
        const saved = await saveRoadmapRecord({ recordId: newId("robustness"), kind: "robustness_arena", payload: result as unknown as Record<string, unknown> });
        recordId = saved.record.recordId;
        setState((current) => current.status === "ready"
          ? { ...current, records: [saved.record, ...current.records.filter((record) => record.recordId !== saved.record.recordId)] }
          : current);
      } catch (error: unknown) {
        setNotice(translate("The robustness run completed, but its evidence could not be saved."));
        setErrorDetail(error instanceof Error ? error.message : String(error));
        return;
      }
      setSelectedRobustnessRecordId(recordId);
      const evidenceErrors = outcomes.filter((outcome) => outcome.errorCode === "evidence_save_failed").length + (baseEvidenceSaved === false ? 1 : 0);
      const failures = outcomes.filter((outcome) => outcome.executionStatus === "failed").length;
      const cancellations = outcomes.filter((outcome) => outcome.executionStatus === "cancelled").length;
      const unavailable = outcomes.filter((outcome) => outcome.executionStatus === "unavailable").length;
      setNotice(`${translate("Robustness results saved with the same immutable profile.")} ${formatLocaleNumber(outcomes.length)} ${translate("variants")} · ${formatLocaleNumber(failures)} ${translate("failed cases")} · ${formatLocaleNumber(cancellations)} ${translate("cancelled cases")} · ${formatLocaleNumber(unavailable)} ${translate("unavailable")} · ${formatLocaleNumber(evidenceErrors)} ${translate("evidence save errors")}`);
      if (baseFailure) setErrorDetail(baseFailure);
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("The robustness run could not be completed."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setActiveOperation(null);
    }
  }

  async function exportBundle() {
    const source = single ?? singlePayloads[0];
    if (!source) {
      setNotice(translate("Run a single-model benchmark before exporting a bundle."));
      return;
    }
    try {
      const sourceVersion = await readBenchmarkVersion(source.benchmarkVersionId);
      if (!sourceVersion) throw new Error(translate("The source benchmark version is unavailable locally."));
      const validated = await validateBenchmarkDocument(sourceVersion.documentJson);
      if (validated.versionId !== source.benchmarkVersionId
        || validated.contentHash !== source.benchmarkContentHash
        || sourceVersion.summary.versionId !== source.benchmarkVersionId
        || sourceVersion.summary.contentHash !== source.benchmarkContentHash) {
        throw new Error(translate("The source benchmark snapshot does not match its immutable evidence."));
      }
      const profile = source.profileRevision;
      const serialized = await exportReproBundle({
        ...source,
        reproductionSnapshot: {
          schemaVersion: 1,
          benchmark: {
            versionId: sourceVersion.summary.versionId,
            contentHash: sourceVersion.summary.contentHash,
            documentJsonBase64Chunks: encodeReproBenchmarkDocumentChunks(sourceVersion.documentJson),
          },
          modelArtifact: reproModelArtifactFromProfile(profile),
          executionControls: { seed: null, randomnessControl: "runtime_default_unseeded" },
        },
      } as unknown as Record<string, unknown>);
      setImportedBundle(null);
      setLegacyBundleUnverifiable(false);
      setBundleDifferences([]);
      setBundle(serialized);
      setBundleDownloadUrl(URL.createObjectURL(new Blob([serialized], { type: "application/json" })));
      try {
        await saveRoadmapRecord({ recordId: `bundle-${source.runId}`, kind: "repro_bundle", payload: JSON.parse(serialized) as Record<string, unknown> });
        setNotice(translate("Repro bundle generated. Review profile prompt text before sharing."));
      } catch (error: unknown) {
        setNotice(translate("Bundle file is ready, but its local history record could not be saved."));
        setErrorDetail(error instanceof Error ? error.message : String(error));
      }
    } catch (error: unknown) {
      setNotice(translate("The repro bundle could not be generated."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  async function importBundle(file: File) {
    setNotice(null);
    setErrorDetail(null);
    setImportedBundle(null);
    setLegacyBundleUnverifiable(false);
    setBundleDifferences([]);
    setBundle("");
    setBundleDownloadUrl(null);
    if (file.size > MAX_REPRO_BUNDLE_BYTES) {
      setNotice(translate("The repro bundle could not be imported."));
      setErrorDetail(translate("The selected repro bundle exceeds the local size limit."));
      return;
    }
    try {
      const availableProfiles = state.status === "ready" ? state.profiles : [];
      const platform = await readHardwareSnapshot().then((snapshot) => snapshot.platform).catch(() => undefined);
      const imported = await importReproBundle(await file.text(), {
        availableRuntimes: [...new Set(availableProfiles.map((profile) => profile.runtime))],
        availableModels: [...new Set(availableProfiles.map((profile) => profile.model))],
        ...(platform ? { platform } : {}),
      });
      const runRequest = imported.reproductionSnapshotVerified ? await reproRunRequest(imported.payload) : null;
      const isLegacySingleModel = imported.payload.kind === "single_model_benchmark"
        && imported.schemaMigration.legacySingleModelReadOnlyReason !== null;
      setImportedBundle(runRequest);
      setLegacyBundleUnverifiable(isLegacySingleModel && runRequest === null);
      setBundleDifferences(imported.differences);
      setBundle(JSON.stringify(imported.payload, null, 2));
      const localVersion = runRequest && state.status === "ready" ? state.versions.find((item) => item.versionId === runRequest.benchmarkVersionId) : undefined;
      const localProfile = runRequest && state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === runRequest.profileRevisionId) : undefined;
      const identity = runRequest ? compareReproLocalIdentity(runRequest, {
        benchmarkVersionId: localVersion?.versionId ?? null,
        benchmarkContentHash: localVersion?.contentHash ?? null,
        profileRevision: localProfile ?? null,
        modelArtifact: localProfile ? reproModelArtifactFromProfile(localProfile) : null,
      }) : null;
      const mayReconstructBenchmark = runRequest !== null && identity !== null && !localVersion
        && canReproRunWithLocalIdentity(identity, false);
      const identityAllowsRerun = identity !== null && canReproRunWithLocalIdentity(identity, localVersion !== undefined);
      const sourceIsLocal = runRequest !== null && identity?.matches === true
        && singlePayloads.some((payload) => matchesReproSource(runRequest, payload as unknown as Record<string, unknown>));
      const statusMessage = !runRequest
        ? isLegacySingleModel
          ? "This legacy single-model bundle has no complete portable snapshot; importing it is read-only and rerunning is disabled."
          : "Repro bundle integrity verified, but it does not contain a supported single-model run request."
        : runRequest.executionControls.seed !== null
          ? "This bundle uses a seed control that the local single-model runner cannot apply; rerunning is disabled."
        : !identityAllowsRerun
          ? "The imported benchmark/profile identity is unavailable locally or differs from local records; rerunning is disabled."
          : mayReconstructBenchmark
            ? "The benchmark snapshot is verified and will be validated and saved locally only when you click Re-run. The saved profile matches; the current Ollama model digest is checked before and after generation."
            : sourceIsLocal
            ? "Imported benchmark and saved profile match local records. The source run is also stored locally; the current Ollama model digest is checked before and after Re-run."
            : "Imported benchmark and saved profile match local records, but the source run is not stored locally; its ID remains an unverified external reference. The current Ollama model digest is checked before and after Re-run.";
      const identityDifferences = identity?.differences.map(reproIdentityDifferenceLabel).join("; ") ?? "";
      setNotice(`${translate(statusMessage)}${identityDifferences ? ` · ${identityDifferences}` : ""}`);
    } catch (error: unknown) {
      setNotice(translate("The repro bundle could not be imported."));
      setErrorDetail(translate(reproBundleImportErrorKey(error)));
    }
  }

  async function rerunImportedBundle() {
    if (!importedBundle || state.status !== "ready") {
      setNotice(translate("Import a verified single-model bundle and load local evidence before rerunning."));
      return;
    }
    const profile = state.profiles.find((item) => item.profileRevisionId === importedBundle.profileRevisionId);
    if (!profile) {
      setNotice(translate("The imported profile identity is not available in local storage."));
      return;
    }
    const snapshotStillMatches = await verifyReproBenchmarkSnapshot(importedBundle.benchmarkSnapshot, importedBundle);
    if (!snapshotStillMatches) {
      setNotice(translate("The embedded benchmark snapshot no longer matches its verified identity; rerunning is disabled."));
      return;
    }
    if (importedBundle.executionControls.seed !== null) {
      setNotice(translate("This bundle uses a seed control that the local single-model runner cannot apply; rerunning is disabled."));
      return;
    }
    const profileIdentity = compareReproLocalIdentity(importedBundle, {
      benchmarkVersionId: null,
      benchmarkContentHash: null,
      profileRevision: profile,
      modelArtifact: reproModelArtifactFromProfile(profile),
    });
    const profileAndArtifactDifferences = profileIdentity.differences.filter((difference) => (
      difference !== "benchmark_version_unavailable" && difference !== "benchmark_content_unavailable"
    ));
    if (profileAndArtifactDifferences.length > 0) {
      setNotice(translate("The imported benchmark/profile identity is unavailable locally or differs from local records; rerunning is disabled."));
      setErrorDetail(profileAndArtifactDifferences.map(reproIdentityDifferenceLabel).join("; "));
      return;
    }
    setBusy(true);
    setActiveOperation({ kind: "repro" });
    setNotice(null);
    setErrorDetail(null);
    try {
      const liveModel = await readLiveProfileModelIdentity(profile.profileRevisionId);
      const liveIdentity = compareReproLocalIdentity(importedBundle, {
        benchmarkVersionId: null,
        benchmarkContentHash: null,
        profileRevision: profile,
        modelArtifact: liveModel,
      });
      const liveModelDifferences = liveIdentity.differences.filter((difference) => (
        difference !== "benchmark_version_unavailable" && difference !== "benchmark_content_unavailable"
      ));
      if (liveModelDifferences.length > 0) {
        throw new Error(`${translate("The current local runtime model does not match the imported model identity.")} ${liveModelDifferences.map(reproIdentityDifferenceLabel).join("; ")}`);
      }
      let storedVersion = await readBenchmarkVersion(importedBundle.benchmarkVersionId);
      if (storedVersion) {
        const localValidation = await validateBenchmarkDocument(storedVersion.documentJson);
        if (storedVersion.summary.versionId !== importedBundle.benchmarkVersionId
          || storedVersion.summary.contentHash !== importedBundle.benchmarkContentHash
          || localValidation.versionId !== importedBundle.benchmarkVersionId
          || localValidation.contentHash !== importedBundle.benchmarkContentHash) {
          throw new Error(translate("A local benchmark with this version ID has different content; the imported snapshot was not saved or run."));
        }
      } else {
        const documentJson = decodeReproBenchmarkDocumentChunks(importedBundle.benchmarkSnapshot.documentJsonBase64Chunks);
        if (documentJson === null) throw new Error(translate("The imported benchmark snapshot is malformed or exceeds the local size limit."));
        const validation = await validateBenchmarkDocument(documentJson);
        if (validation.versionId !== importedBundle.benchmarkVersionId || validation.contentHash !== importedBundle.benchmarkContentHash) {
          throw new Error(translate("The imported benchmark snapshot failed local validation; it was not saved or run."));
        }
        const saved = await saveBenchmarkVersion(documentJson);
        if (saved.summary.versionId !== importedBundle.benchmarkVersionId || saved.summary.contentHash !== importedBundle.benchmarkContentHash) {
          throw new Error(translate("The saved benchmark version does not match the imported snapshot; it was not run."));
        }
        storedVersion = await readBenchmarkVersion(importedBundle.benchmarkVersionId);
        if (!storedVersion || storedVersion.summary.versionId !== importedBundle.benchmarkVersionId
          || storedVersion.summary.contentHash !== importedBundle.benchmarkContentHash) {
          throw new Error(translate("The saved benchmark version could not be verified after import; it was not run."));
        }
      }
      const loadedIdentity = compareReproLocalIdentity(importedBundle, {
        benchmarkVersionId: storedVersion.summary.versionId,
        benchmarkContentHash: storedVersion.summary.contentHash,
        profileRevision: profile,
        modelArtifact: reproModelArtifactFromProfile(profile),
      });
      if (!loadedIdentity.matches) throw new Error(loadedIdentity.differences.map(reproIdentityDifferenceLabel).join("; "));
      const sourceRunVerified = singlePayloads.some((payload) => matchesReproSource(importedBundle, payload as unknown as Record<string, unknown>));
      const plan = buildRunPlan({
        runId: newId("repro"),
        version: storedVersion,
        taskId: importedBundle.taskId,
        caseId: importedBundle.caseId,
        profileRevision: profile,
        metadata: { mode: "repro_bundle", reproSourceRunReference: importedBundle.sourceRunId, reproSourceRunVerified: sourceRunVerified, featureVersion: 1 },
      });
      if (plan.executionBoundary.status !== "available") throw new Error(plan.executionBoundary.reason ?? translate("The imported task is unavailable in this environment."));
      const hardware = await readHardwareSnapshot().catch(() => null);
      const execution = await executeRunOnce(plan);
      const postRunModel = await readLiveProfileModelIdentity(profile.profileRevisionId, true);
      const postRunIdentity = compareReproLocalIdentity(importedBundle, {
        benchmarkVersionId: storedVersion.summary.versionId,
        benchmarkContentHash: storedVersion.summary.contentHash,
        profileRevision: profile,
        modelArtifact: postRunModel,
      });
      if (!postRunIdentity.matches) {
        throw new Error(`${translate("The model identity changed around this run, so the run is not marked as reproduced.")} ${postRunIdentity.differences.map(reproIdentityDifferenceLabel).join("; ")}`);
      }
      const payload = buildSingleModelBenchmarkPayload({
        run: execution.run,
        attempt: execution.attempt,
        profile,
        execution,
        performance: performanceEvidenceFromExecution(execution),
        benchmarkVersionId: importedBundle.benchmarkVersionId,
        benchmarkContentHash: storedVersion.summary.contentHash,
        taskId: importedBundle.taskId,
        caseId: importedBundle.caseId,
        hardware,
        ...(sourceRunVerified ? { reproducedFromRunId: importedBundle.sourceRunId } : {}),
        reproSourceRunReference: importedBundle.sourceRunId,
        reproSourceRunVerified: sourceRunVerified,
      });
      await saveRoadmapRecord(singleModelRecord(payload));
      await saveRoadmapRecord(buildPerformanceRecord(payload));
      setSingle(payload);
      setPerformanceRunId(payload.runId);
      setNotice(translate(sourceRunVerified
        ? "Reproduced run saved with a link to its source run."
        : "Reproduced run saved. The imported source run ID remains an unverified external reference."));
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("The imported run could not be reproduced from local immutable identities."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setActiveOperation(null);
    }
  }

  async function calculateRegression() {
    const baseline = resolveHistoricalSelection(baselineId, singlePayloads, comparableArenaSummaries);
    const candidate = resolveHistoricalSelection(candidateId, singlePayloads, comparableArenaSummaries);
    if (!baseline || !candidate || baselineId === candidateId) {
      setNotice(translate("Select two different immutable runs."));
      return;
    }
    const result = compareHistoricalRuns(baseline, candidate);
    setRegression(result);
    setRepeatedRegression(null);
    try {
      const saved = await saveRoadmapRecord({ recordId: newId("regression"), kind: "historical_regression", payload: result as unknown as Record<string, unknown> });
      setState((current) => current.status === "ready"
        ? { ...current, records: [saved.record, ...current.records.filter((record) => record.recordId !== saved.record.recordId)] }
        : current);
      setNotice(translate("Historical comparison saved immutably."));
    } catch (error: unknown) {
      setNotice(translate("The comparison was calculated but could not be saved."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  function exportRegressionComparison(comparison: HistoricalRegression | RepeatedRunHistoricalRegression) {
    const exported = buildHistoricalRegressionExport(comparison, [...singlePayloads, ...comparableArenaSummaries]);
    if (!exported) {
      setNotice(translate("The comparison export is missing a verifiable source record."));
      return;
    }
    const serialized = JSON.stringify(exported, null, 2);
    if (comparisonDownload) URL.revokeObjectURL(comparisonDownload.url);
    setComparisonDownload({ url: URL.createObjectURL(new Blob([serialized], { type: "application/json" })), fileName: `prompt-arena-regression-${comparison.createdAt.slice(0, 10)}.json` });
    setNotice(translate("The derived comparison export includes source IDs and content hashes."));
  }

  async function calculateRepeatedRegression() {
    if (repeatedRunGroupsOverlap) {
      setNotice(translate("A saved run cannot appear in both repeated-run groups."));
      setRepeatedRegression(null);
      return;
    }
    const baseline = baselineRunIds.map((id) => singlePayloads.find((payload) => payload.runId === id)).filter((payload): payload is SingleModelBenchmarkPayload => payload !== undefined);
    const candidate = candidateRunIds.map((id) => singlePayloads.find((payload) => payload.runId === id)).filter((payload): payload is SingleModelBenchmarkPayload => payload !== undefined);
    if (baseline.length < 5 || candidate.length < 5 || baseline.length !== baselineRunIds.length || candidate.length !== candidateRunIds.length) {
      setNotice(translate("Select at least five saved runs for each repeated-run group."));
      setRepeatedRegression(null);
      return;
    }
    const result = compareRepeatedHistoricalRuns(baseline, candidate);
    setRepeatedRegression(result);
    setRegression(null);
    try {
      const saved = await saveRoadmapRecord({ recordId: newId("repeated-regression"), kind: "historical_regression", payload: result as unknown as Record<string, unknown> });
      setState((current) => current.status === "ready"
        ? { ...current, records: [saved.record, ...current.records.filter((record) => record.recordId !== saved.record.recordId)] }
        : current);
      setNotice(translate("Repeated-run comparison saved immutably."));
    } catch (error: unknown) {
      setNotice(translate("The repeated-run comparison was calculated but could not be saved."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSingle(execution: PersistedExecution, profile: ProfileRevision, selectedTaskId: string, selectedCaseId: string, hardware: HardwareSnapshot | null): Promise<SingleModelBenchmarkPayload> {
    if (!version) throw new Error(translate("Select an immutable benchmark version first."));
    const payload = buildSingleModelBenchmarkPayload({
      run: asRunRecord(execution),
      attempt: asAttemptRecord(execution),
      profile,
      execution,
      performance: performanceEvidenceFromExecution(execution),
      benchmarkVersionId: version.summary.versionId,
      benchmarkContentHash: version.summary.contentHash,
      taskId: selectedTaskId,
      caseId: selectedCaseId,
      hardware,
    });
    await saveRoadmapRecord(singleModelRecord(payload));
    await saveRoadmapRecord(buildPerformanceRecord(payload));
    setSingle(payload);
    setPerformanceRunId(payload.runId);
    return payload;
  }

  async function runSingle() {
    if (!version || !document || !profileId || !taskId || !caseId) {
      setNotice(translate("Choose a benchmark, model, task, and case first."));
      return;
    }
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!profile) {
      setNotice(translate("The selected immutable profile is unavailable."));
      return;
    }
    setBusy(true);
    setActiveOperation({ kind: "single" });
    setNotice(null);
    setErrorDetail(null);
    try {
      const hardware = await readHardwareSnapshot().catch(() => null);
      const execution = await executeRunOnce(buildRunPlan({
        runId: newId("single"),
        version,
        taskId,
        caseId,
        profileRevision: profile,
        metadata: { mode: "single_model_benchmark", featureVersion: 1 },
      }));
      await saveSingle(execution, profile, taskId, caseId, hardware);
      setNotice(translate("Single-model evidence saved immutably."));
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("The single-model benchmark could not be completed."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setActiveOperation(null);
    }
  }

  async function runSuite() {
    if (!version || !document || !profileId) {
      setNotice(translate("Choose a benchmark and immutable model profile first."));
      return;
    }
    const profile = state.status === "ready" ? state.profiles.find((item) => item.profileRevisionId === profileId) : undefined;
    if (!profile) {
      setNotice(translate("The selected immutable profile is unavailable."));
      return;
    }
    const challenges = document.tasks.flatMap((task) => task.cases.map((benchmarkCase) => ({ taskId: task.taskId, caseId: benchmarkCase.caseId })));
    if (challenges.length === 0) {
      setNotice(translate("The selected benchmark has no executable challenges."));
      return;
    }
    setBusy(true);
    setActiveOperation({ kind: "suite", completed: 0, total: challenges.length });
    setNotice(null);
    setErrorDetail(null);
    const suiteId = newId("suite");
    const startedAt = new Date().toISOString();
    const hardware = await readHardwareSnapshot().catch(() => null);
    let lastPayload: SingleModelBenchmarkPayload | null = null;
    let currentCaseIndex = 0;
    try {
      const outcomes = await executeSingleModelSuiteCases<PersistedExecution>(challenges,
        async (challenge) => {
          currentCaseIndex += 1;
          setActiveOperation({ kind: "suite", completed: currentCaseIndex, total: challenges.length });
          const plan = buildRunPlan({
            runId: newId("suite-case"),
            version,
            taskId: challenge.taskId,
            caseId: challenge.caseId,
            profileRevision: profile,
            metadata: { mode: "single_model_benchmark", suite: true, suiteId, featureVersion: 1 },
          });
          if (plan.executionBoundary.status !== "available") return { status: "unavailable", runId: null } as const;
          const execution = await executeRunOnce(plan);
          const status = execution.attempt.status === "completed"
            ? "completed"
            : execution.attempt.status === "cancelled" ? "cancelled" : "failed";
          const objective = execution.attempt.result?.score;
          const objectivePassed = objective && typeof objective === "object" && !Array.isArray(objective) && typeof (objective as Record<string, unknown>).passed === "boolean"
            ? (objective as Record<string, unknown>).passed as boolean
            : null;
          return { status, runId: plan.runId, attemptId: execution.attempt.attemptId, objectivePassed, value: execution };
        },
        async (challenge, execution) => {
          lastPayload = await saveSingle(execution, profile, challenge.taskId, challenge.caseId, hardware);
        });
      const suitePayload = buildSingleModelSuitePayload({
        suiteId,
        benchmarkVersionId: version.summary.versionId,
        profileRevision: profile as unknown as Record<string, unknown>,
        cases: outcomes,
        startedAt,
      });
      await saveRoadmapRecord(singleModelSuiteRecord(suitePayload));
      if (lastPayload) setSingle(lastPayload);
      const { completed, failed, cancelled, unavailable, evidenceErrors } = suitePayload.summary;
      setNotice(`${translate("Benchmark suite saved immutably")} · ${completed}/${suitePayload.summary.total} ${translate("completed")} · ${failed} ${translate("failed")} · ${cancelled} ${translate("cancelled")} · ${unavailable} ${translate("unavailable")} · ${evidenceErrors} ${translate("evidence save errors")}`);
      await refresh();
    } catch (error: unknown) {
      setNotice(translate("The benchmark suite could not be completed."));
      setErrorDetail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setActiveOperation(null);
    }
  }

  if (state.status === "preview") return <section className="panel roadmap-features-view"><p className="eyebrow">{translate("Insights")}</p><h2>{translate("Roadmap features are desktop-only")}</h2><p>{translate("Browser preview never invents benchmark runs, telemetry, ratings, or bundles. Open the desktop app to use local evidence.")}</p></section>;
  if (state.status === "loading") return <section className="panel"><StateMessage title={translate("Loading roadmap evidence")} description={translate("Reading immutable local model records.")} /></section>;
  if (state.status === "error") return <section className="panel"><StateMessage title={translate("Roadmap evidence unavailable")} description={state.message} error /></section>;

  return (
    <div className="view-stack roadmap-features-view">
      <section className="panel page-intro">
        <p className="eyebrow">{translate("Insights")}</p>
        <h2>{translate("Single-model evidence without a competitor matrix.")}</h2>
        <p>{translate("Run one immutable model/profile against one case, or process every case in the selected benchmark. Every saved record keeps the source run, objective result, and measured runtime fields together.")}</p>
        {notice && (errorDetail ? <HumanError summary={notice} detail={errorDetail} /> : <p className="field-help" role="status">{notice}</p>)}
      </section>

      <section className="panel" aria-labelledby="single-model-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Benchmark")}</p><h3 id="single-model-heading">{translate("Single-model benchmark")}</h3></div></div>
        <div className="arena-selection-grid">
          <FieldSelect id="insights-version" label={translate("Benchmark version")} value={versionId} options={versionOptions(state.versions)} onChange={setVersionId} />
          <FieldSelect id="insights-profile" label={translate("Immutable model profile")} value={profileId} options={state.profiles.map((profile) => ({ value: profile.profileRevisionId, label: profileDisplayName(profile) }))} onChange={setProfileId} />
          <FieldSelect id="insights-task" label={translate("Task")} value={taskId} options={taskChoices.map((option) => ({ value: option.value, label: option.label }))} onChange={setTaskId} />
          <FieldSelect id="insights-case" label={translate("Case")} value={caseId} options={caseChoices.map((option) => ({ value: option.value, label: option.label }))} onChange={setCaseId} />
        </div>
        <div className="arena-actions"><button className="primary-button" type="button" onClick={() => void runSingle()} disabled={busy}>{activeOperation?.kind === "single" ? translate("Running…") : translate("Run single benchmark")}</button><button className="secondary-button" type="button" onClick={() => void runSuite()} disabled={busy}>{activeOperation?.kind === "suite" ? translate("Running…") : translate("Run full benchmark suite")}</button></div>
        {activeOperationLabel && activeOperation?.kind !== "robustness_baseline" && activeOperation?.kind !== "robustness_variants" && <p className="field-help" role="status" aria-live="polite" aria-atomic="true">{activeOperationLabel}</p>}
        {single && <EvidenceSummary payload={single} />}
      </section>

      <section className="panel" aria-labelledby="single-history-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Immutable source records")}</p><h3 id="single-history-heading">{translate("Saved single-model runs")}</h3></div><span className="run-status run-status-neutral">{formatLocaleNumber(singlePayloads.length)}</span></div>
        {singlePayloads.length === 0 ? <StateMessage title={translate("No single-model records yet")} description={translate("Run a bounded case to create the first immutable evidence record.")} /> : <div className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}><table><thead><tr><th>{translate("Run")}</th><th>{translate("Model")}</th><th>{translate("Task / case")}</th><th>{translate("Status")}</th><th>{translate("Objective")}</th></tr></thead><tbody>{singlePayloads.map((payload) => {
          const attemptStatus = payload.attempt?.status;
          const status = payload.status ?? (typeof attemptStatus === "string" ? attemptStatus : "unavailable");
          return <tr key={payload.runId}><td>{numberedName("Run", payload.runId, singlePayloads.map((item) => item.runId))}<details><summary>{translate("Technical details")}</summary><code>{payload.runId}</code>{payload.reproducedFromRunId && <p>{translate("Reproduced from")}: <code>{payload.reproducedFromRunId}</code></p>}{payload.reproSourceRunReference && !payload.reproducedFromRunId && <p>{translate("Imported source reference")}: <code>{payload.reproSourceRunReference}</code> ({translate("Unverified external reference")})</p>}</details></td><td>{displayName(payload.profileRevision.model, "Model")}</td><td>{displayName(payload.taskId, "Task")} / {displayName(payload.caseId, "Case")}</td><td>{translate(status)}</td><td>{status !== "completed" ? translate("Unavailable") : payload.objective?.passed === true ? translate("Pass") : payload.objective?.passed === false ? translate("Fail") : translate("Unavailable")}</td></tr>;
        })}</tbody></table></div>}
      </section>

      <section className="panel" aria-labelledby="suite-history-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Suite summaries")}</p><h3 id="suite-history-heading">{translate("Saved benchmark suites")}</h3></div><span className="run-status run-status-neutral">{formatLocaleNumber(suitePayloads.length)}</span></div>
        {suitePayloads.length === 0 ? <StateMessage title={translate("No benchmark suite summaries yet")} description={translate("Run a full suite to save a per-case terminal outcome summary.")} /> : <div className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}><table><thead><tr><th>{translate("Suite")}</th><th>{translate("Model")}</th><th>{translate("Status")}</th><th>{translate("Case outcomes")}</th></tr></thead><tbody>{suitePayloads.map((payload) => <tr key={payload.suiteId}><td><code>{payload.suiteId}</code><details><summary>{translate("Cases")}</summary><ul>{payload.cases.map((result) => <li key={`${result.taskId}:${result.caseId}`}>{displayName(result.taskId, "Task")} / {displayName(result.caseId, "Case")}: {translate(result.status)}{result.errorCode ? ` · ${translate(result.errorCode === "execution_failed" ? "Execution failed before a record was saved" : "Evidence could not be saved")}` : ""}</li>)}</ul></details></td><td>{displayName(String(payload.profileRevision.model ?? ""), "Model")}</td><td>{translate(payload.status === "completed" ? "Suite completed" : payload.status === "partial" ? "Suite partially completed" : "Suite failed")}</td><td>{formatLocaleNumber(payload.summary.completed)} {translate("completed")} · {formatLocaleNumber(payload.summary.failed)} {translate("failed")} · {formatLocaleNumber(payload.summary.cancelled)} {translate("cancelled")} · {formatLocaleNumber(payload.summary.unavailable)} {translate("unavailable")}{payload.summary.evidenceErrors > 0 ? ` · ${formatLocaleNumber(payload.summary.evidenceErrors)} ${translate("evidence save errors")}` : ""}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="panel" aria-labelledby="performance-lab-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Metrics")}</p><h3 id="performance-lab-heading">{translate("Performance Lab")}</h3></div></div>
        <p className="field-help">{translate("Runtime and derived metrics retain unit, source, confidence, warm/cold state, and explicit unavailable values.")}</p>
        {singlePayloads.length > 0 && <FieldSelect id="insights-performance-run" label={translate("Select run for metrics")} value={performancePayload?.runId ?? ""} options={singleRunOptions} onChange={setPerformanceRunId} />}
        {performancePayload ? <MetricTable payload={performancePayload} /> : <StateMessage title={translate("No performance evidence yet")} description={translate("Run a single-model benchmark to populate this local table.")} />}
      </section>

      <section className="panel" aria-labelledby="historical-regression-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Comparison")}</p><h3 id="historical-regression-heading">{translate("Historical regression")}</h3></div></div>
        <p className="field-help">{translate("Compare saved single-model or Arena source runs while surfacing changed model, runtime, benchmark, seed, hardware, or prompt conditions.")}</p>
        <p className="field-help">{translate("Unverified app-calculated snapshot. The local store preserves it immutably but does not verify it against source evidence.")}</p>
        <div className="arena-selection-grid"><FieldSelect id="insights-baseline" label={translate("Baseline run")} value={baselineId} options={historicalRunOptions} onChange={(id) => { setBaselineId(id); setRegression(null); }} /><FieldSelect id="insights-candidate" label={translate("Candidate run")} value={candidateId} options={historicalRunOptions} onChange={(id) => { setCandidateId(id); setRegression(null); }} /></div>
        <button className="secondary-button" type="button" onClick={() => void calculateRegression()} disabled={historicalRunOptions.length < 2}>{translate("Compare immutable runs")}</button>
        {regression && <><RegressionTable comparison={regression} sources={[...singlePayloads, ...comparableArenaSummaries]} /><button className="secondary-button" type="button" onClick={() => exportRegressionComparison(regression)}>{translate("Export derived comparison")}</button></>}
        <div className="repeated-regression-panel">
          <h4>{translate("Repeated-run statistical comparison")}</h4>
          <p className="field-help" id="repeated-run-help">{translate("Select at least five saved runs for each group. Use Ctrl or Command to select multiple runs. The analysis uses independent repeated runs and reports simultaneous intervals with at least 95% family-wise coverage across all seven metrics.")} {translate("Select each saved run in only one group; overlapping groups cannot be compared.")}</p>
          <div className="arena-selection-grid">
            <MultiRunSelect id="repeated-baseline-runs" label={translate("Baseline run group")} selectedValues={baselineRunIds} options={singleRunOptions} onChange={(ids) => { setBaselineRunIds(ids); setRepeatedRegression(null); }} />
            <MultiRunSelect id="repeated-candidate-runs" label={translate("Candidate run group")} selectedValues={candidateRunIds} options={singleRunOptions} onChange={(ids) => { setCandidateRunIds(ids); setRepeatedRegression(null); }} />
          </div>
          {repeatedRunGroupsOverlap && <p className="field-help" role="status">{translate("A saved run cannot appear in both repeated-run groups.")}</p>}
          <button className="secondary-button" type="button" onClick={() => void calculateRepeatedRegression()} disabled={baselineRunIds.length < 5 || candidateRunIds.length < 5 || repeatedRunGroupsOverlap}>{translate("Compare repeated runs")}</button>
          {repeatedRegression && <><RepeatedRegressionTable comparison={repeatedRegression} payloads={singlePayloads} /><button className="secondary-button" type="button" onClick={() => exportRegressionComparison(repeatedRegression)}>{translate("Export derived comparison")}</button></>}
        </div>
        {regressionHistory.length > 0 && <details className="roadmap-table"><summary>{translate("Saved comparisons")} · {formatLocaleNumber(regressionHistory.length)}</summary><table><thead><tr><th>{translate("Recorded")}</th><th>{translate("Baseline")}</th><th>{translate("Candidate")}</th></tr></thead><tbody>{regressionHistory.map(({ recordId, createdAt, comparison }) => {
          const isRepeated = comparison.kind === "repeated_run_historical_regression";
          const baselineRuns = isRepeated ? comparison.baselineRunIds : [comparison.baselineId];
          const candidateRuns = isRepeated ? comparison.candidateRunIds : [comparison.candidateId];
          return <Fragment key={recordId}>
            <tr><td>{createdAt}<br /><small>{translate(isRepeated ? "Repeated-run comparison" : "Single-run comparison")}</small></td><td>{formatLocaleNumber(baselineRuns.length)} {translate("saved runs")}</td><td>{formatLocaleNumber(candidateRuns.length)} {translate("saved runs")}</td></tr>
            <tr><td colSpan={3}><details><summary>{translate("Open saved comparison")}</summary><button className="secondary-button" type="button" onClick={() => exportRegressionComparison(comparison)}>{translate("Export derived comparison")}</button>{isRepeated
              ? <RepeatedRegressionTable comparison={comparison} payloads={singlePayloads} />
              : <RegressionTable comparison={comparison} sources={[...singlePayloads, ...comparableArenaSummaries]} />}</details></td></tr>
          </Fragment>;
        })}</tbody></table></details>}
        {comparisonDownload && <a className="secondary-button" href={comparisonDownload.url} download={comparisonDownload.fileName}>{translate("Download comparison JSON")}</a>}
      </section>

      <section className="panel" aria-labelledby="model-ratings-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Ranking")}</p><h3 id="model-ratings-heading">{translate("Persistent model ratings")}</h3></div></div>
        <p className="field-help">{translate("Ratings use eligible immutable objective Arena outcomes and recompute deterministically from the same evidence.")}</p>
        <p className="field-help">{translate("Unverified app-calculated snapshot. The local store preserves it immutably but does not verify it against source evidence.")}</p>
        <FieldSelect id="insights-rating-rule" label={translate("Rating method")} value={ratingRuleVersion} options={[{ value: "elo-v1", label: translate("Elo v1") }, { value: "bradley-terry-v1", label: translate("Bradley-Terry v1") }]} onChange={(value) => setRatingRuleVersion(value as RatingRuleVersion)} />
        <p className="field-help">{translate(ratingRuleVersion === "elo-v1" ? "Elo v1 uncertainty is a rough sample-count heuristic, not a calibrated confidence interval. Only categories attached to validated benchmark tasks are shown." : "Bradley-Terry v1 fits regularized logit abilities. Outcomes from the same saved Arena summary are clustered for CR1 sandwich standard errors. With fewer than two source clusters, prior-only standard deviations are reported; legacy outcomes without source IDs retain Laplace standard errors. These values are not calibrated confidence intervals; separate connected groups cannot be compared.")}</p>
        <p className="field-help">{translate("Source-cluster counts group outcomes by saved Arena summary IDs. Distinct summary IDs do not prove that source runs are statistically independent.")}</p>
        {ratings ? <><div className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}><table><thead><tr><th>{translate("Model")}</th><th>{translate("Category")}</th><th>{translate("Comparison group")}</th><th>{translate("Rating")}</th><th>{translate("Samples")}</th><th>{translate("Source clusters")}</th><th>{translate("Uncertainty")}</th><th>{translate("Uncertainty method")}</th></tr></thead><tbody>{ratings.ratings.map((rating) => <tr key={`${rating.category === null ? "global" : `category-${rating.category}`}:${rating.comparisonGroupId ?? "elo"}:${rating.competitorId}`}><td>{state.profiles.find((profile) => profile.profileRevisionId === rating.competitorId)?.model ?? numberedName("Model", rating.competitorId, ratings.ratings.map((item) => item.competitorId))}</td><td>{rating.categoryName ? translate(rating.categoryName) : translate("All")}</td><td>{rating.comparisonGroupId ?? "—"}</td><td>{formatLocaleNumber(rating.rating, undefined, { maximumFractionDigits: 2 })}</td><td>{formatLocaleNumber(rating.sampleCount)}</td><td>{rating.sourceClusterCount === undefined ? "—" : formatLocaleNumber(rating.sourceClusterCount)}</td><td>±{formatLocaleNumber(rating.uncertainty, undefined, { maximumFractionDigits: 2 })}</td><td>{translate(ratingRowUncertaintyMethodKey(rating.uncertaintyMethod, ratings.uncertaintyMethod))}</td></tr>)}</tbody></table></div><button className="secondary-button" type="button" onClick={() => void persistRatings()}>{translate("Persist ratings")}</button></> : <StateMessage title={translate("No eligible head-to-head evidence")} description={translate("Ratings remain empty until comparable immutable Arena outcomes exist.")} />}
        {ratingHistory.length > 0 && <details className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}><summary>{translate("Persisted rating history")} · {formatLocaleNumber(ratingHistory.length)}</summary><table><thead><tr><th>{translate("Recorded")}</th><th>{translate("Models")}</th><th>{translate("Top model")}</th><th>{translate("Rule")}</th><th>{translate("Uncertainty method")}</th></tr></thead><tbody>{ratingHistory.map(({ recordId, payload }) => <Fragment key={recordId}><tr><td>{payload.createdAt}</td><td>{formatLocaleNumber(payload.ratings.length)}</td><td>{displayName(state.profiles.find((profile) => profile.profileRevisionId === payload.ratings[0]?.competitorId)?.model, "Model")}</td><td>{payload.ruleVersion}</td><td>{translate(ratingUncertaintyMethodKey(payload.uncertaintyMethod))}</td></tr><tr><td colSpan={5}><details><summary>{translate("Open saved rating snapshot")}</summary><div className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}><table><thead><tr><th>{translate("Model")}</th><th>{translate("Category")}</th><th>{translate("Comparison group")}</th><th>{translate("Rating")}</th><th>{translate("Samples")}</th><th>{translate("Source clusters")}</th><th>{translate("Uncertainty")}</th><th>{translate("Uncertainty method")}</th></tr></thead><tbody>{payload.ratings.map((rating) => <tr key={`${rating.comparisonGroupId ?? "elo"}:${rating.competitorId}:${rating.category ?? "global"}`}><td>{displayName(state.profiles.find((profile) => profile.profileRevisionId === rating.competitorId)?.model ?? rating.competitorId, "Model")}</td><td>{rating.categoryName ? translate(rating.categoryName) : translate("All")}</td><td>{rating.comparisonGroupId ?? "—"}</td><td>{formatLocaleNumber(rating.rating, undefined, { maximumFractionDigits: 2 })}</td><td>{formatLocaleNumber(rating.sampleCount)}</td><td>{rating.sourceClusterCount === undefined ? "—" : formatLocaleNumber(rating.sourceClusterCount)}</td><td>±{formatLocaleNumber(rating.uncertainty, undefined, { maximumFractionDigits: 2 })}</td><td>{translate(ratingRowUncertaintyMethodKey(rating.uncertaintyMethod, payload.uncertaintyMethod))}</td></tr>)}</tbody></table></div></details></td></tr></Fragment>)}</tbody></table></details>}
      </section>

      <section className="panel" aria-labelledby="robustness-arena-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Robustness Arena")}</p><h3 id="robustness-arena-heading">{translate("Robustness Arena")}</h3></div></div>
        <p className="field-help">{translate("Generate deterministic prompt perturbations, execute them with the same immutable model profile, and keep unavailable outcomes explicit.")}</p>
        <p className="field-help">{translate("Unverified app-calculated snapshot. The local store preserves it immutably but does not verify it against source evidence.")}</p>
        <button className="secondary-button" type="button" onClick={() => void generateRobustness()} disabled={busy || !version || !document}>{activeOperation?.kind === "robustness_baseline" || activeOperation?.kind === "robustness_variants" ? translate("Running…") : translate("Run robustness variants")}</button>
        {(activeOperation?.kind === "robustness_baseline" || activeOperation?.kind === "robustness_variants") && activeOperationLabel && <p className="field-help" role="status" aria-live="polite" aria-atomic="true">{activeOperationLabel}</p>}
        <p className="field-help">{translate("Deterministic prompt transformations do not prove semantic equivalence. The original benchmark verifier and expected-answer contract remain authoritative.")}</p>
        {robustnessHistory.length === 0 ? <StateMessage title={translate("No saved robustness results yet")} description={translate("Run robustness variants to save an immutable result that can be reopened here.")} /> : <>
          <div className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}><table><thead><tr><th>{translate("Recorded")}</th><th>{translate("Model")}</th><th>{translate("Task / case")}</th><th>{translate("Robustness score")}</th><th>{translate("Open")}</th></tr></thead><tbody>{robustnessHistory.map(({ recordId, result }) => {
            const isSelected = selectedRobustness?.recordId === recordId;
            return <tr key={recordId}><td>{result.createdAt}</td><td>{displayName(state.profiles.find((profile) => profile.profileRevisionId === result.profileRevisionId)?.model, "Model")}</td><td>{displayName(result.taskId, "Task")} / {displayName(result.caseId, "Case")}</td><td>{result.robustnessScore === null ? translate("Unavailable") : formatLocalePercent(result.robustnessScore)}</td><td><button className="secondary-button" type="button" aria-pressed={isSelected} onClick={() => setSelectedRobustnessRecordId(recordId)}>{translate("Open")}</button></td></tr>;
          })}</tbody></table></div>
          {selectedRobustness && <RobustnessResultDetails result={selectedRobustness.result} recordId={selectedRobustness.recordId} model={state.profiles.find((profile) => profile.profileRevisionId === selectedRobustness.result.profileRevisionId)?.model} />}
        </>}
      </section>

      <section className="panel" aria-labelledby="repro-bundle-heading">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{translate("Repro Bundle")}</p><h3 id="repro-bundle-heading">{translate("Repro Bundle")}</h3></div></div>
        <p className="field-help">{translate("Credential fields are filtered, but profile prompt text remains and may contain private information. Review the bundle before sharing; its checksum does not identify the creator.")}</p>
        <p className="field-help">{translate("SHA-256 detects changes but does not authenticate the bundle source.")}</p>
        <p className="field-help">{translate("Re-run checks the current Ollama model digest at the saved loopback endpoint before and after generation. Providers without a current model digest remain read-only.")}</p>
        <p className="field-help">{translate("After generation, Re-run also confirms that Ollama reports the matching digest for the loaded model. These checks are best-effort and do not atomically pin a digest to the generation request.")}</p>
        <div className="arena-actions">
          <button className="secondary-button" type="button" onClick={() => void exportBundle()} disabled={busy || !single && singlePayloads.length === 0}>{translate("Export bundle")}</button>
          {bundleDownloadUrl && <a className="secondary-button" href={bundleDownloadUrl} download="prompt-arena-repro-bundle.json">{translate("Export bundle file")}</a>}
          <button className="secondary-button" type="button" onClick={() => bundleInput.current?.click()} disabled={busy}>{translate("Import bundle")}</button>
          <input ref={bundleInput} type="file" accept="application/json,.json" hidden aria-label={translate("Import bundle")} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importBundle(file); }} />
        <button className="secondary-button" type="button" onClick={() => void rerunImportedBundle()} disabled={busy || !importedBundle || state.status !== "ready" || !importedRerunReady}>{translate("Re-run from local records")}</button>
        </div>
        {legacyBundleUnverifiable && <p className="field-help" role="status">{translate("This legacy single-model bundle has no complete portable snapshot; importing it is read-only and rerunning is disabled.")}</p>}
        {importedBundle && importedLocalIdentity?.matches === false && !importedRerunReady && <div className="field-help" role="status"><p>{translate("The imported benchmark/profile identity is unavailable locally or differs from local records; rerunning is disabled.")}</p><ul>{importedLocalIdentity.differences.map((difference) => <li key={difference}>{reproIdentityDifferenceLabel(difference)}</li>)}</ul></div>}
        {importedBundle && importedLocalIdentity?.matches === true && <p className="field-help" role="status">{translate(importedSourceVerified ? "Imported benchmark and saved profile match local records. The source run is also stored locally; the current Ollama model digest is checked before and after Re-run." : "Imported benchmark and saved profile match local records, but the source run is not stored locally; its ID remains an unverified external reference. The current Ollama model digest is checked before and after Re-run.")}</p>}
        {bundleDifferences.length > 0 && <div className="field-help"><p>{translate("Imported configuration differences")}</p><ul>{bundleDifferences.map((difference, index) => <li key={`${difference.kind}:${index}`}>{reproBundleDifferenceLabel(difference)}</li>)}</ul></div>}
        {bundle && <pre className="roadmap-bundle-preview">{bundle}</pre>}
      </section>
    </div>
  );
}

function isSingleModelSuitePayload(value: Record<string, unknown>): value is Record<string, unknown> & SingleModelSuitePayload {
  const summary = value.summary;
  return value.schemaVersion === 1
    && value.kind === "single_model_suite"
    && typeof value.suiteId === "string"
    && typeof value.benchmarkVersionId === "string"
    && typeof value.profileRevision === "object"
    && value.profileRevision !== null
    && !Array.isArray(value.profileRevision)
    && (value.status === "completed" || value.status === "partial" || value.status === "failed")
    && typeof value.startedAt === "string"
    && typeof value.createdAt === "string"
    && Array.isArray(value.cases)
    && typeof summary === "object"
    && summary !== null
    && ["total", "completed", "failed", "cancelled", "unavailable", "evidenceErrors"].every((key) => Number.isSafeInteger((summary as Record<string, unknown>)[key]));
}

function isRobustnessResult(value: Record<string, unknown>): value is Record<string, unknown> & RobustnessResult {
  const variants = value.variants;
  const status = (item: unknown): item is RobustnessVariantOutcome["executionStatus"] => item === "completed" || item === "failed" || item === "cancelled" || item === "unavailable";
  const nullableString = (item: unknown): item is string | null => item === null || typeof item === "string";
  return value.schemaVersion === 1
    && value.kind === "robustness_arena"
    && typeof value.createdAt === "string" && value.createdAt.length <= 64
    && typeof value.sourceTaskVersion === "string" && value.sourceTaskVersion.length <= 128
    && nullableString(value.taskId)
    && nullableString(value.caseId)
    && nullableString(value.profileRevisionId)
    && nullableString(value.baseRunId)
    && nullableString(value.baseAttemptId)
    && (value.baseEvidenceSaved === null || typeof value.baseEvidenceSaved === "boolean")
    && status(value.baseStatus)
    && (value.basePassed === null || typeof value.basePassed === "boolean")
    && (value.robustnessScore === null || (typeof value.robustnessScore === "number" && Number.isFinite(value.robustnessScore) && value.robustnessScore >= 0 && value.robustnessScore <= 1))
    && (value.variance === null || (typeof value.variance === "number" && Number.isFinite(value.variance) && value.variance >= 0 && value.variance <= 0.25))
    && Array.isArray(value.failureClusters)
    && value.failureClusters.every((cluster) => typeof cluster === "string")
    && Array.isArray(variants)
    && variants.length <= 7
    && variants.every((variant) => variant !== null
      && typeof variant === "object"
      && !Array.isArray(variant)
      && typeof (variant as Record<string, unknown>).perturbationId === "string"
      && typeof (variant as Record<string, unknown>).transformationType === "string"
      && typeof (variant as Record<string, unknown>).provenance === "string"
      && status((variant as Record<string, unknown>).executionStatus)
      && ((variant as Record<string, unknown>).passed === null || typeof (variant as Record<string, unknown>).passed === "boolean")
      && ((variant as Record<string, unknown>).errorCode === undefined || (variant as Record<string, unknown>).errorCode === "execution_failed" || (variant as Record<string, unknown>).errorCode === "evidence_save_failed"));
}

function isHistoricalRegression(value: Record<string, unknown>): value is Record<string, unknown> & HistoricalRegression {
  const compatibility = value.compatibility;
  const metrics = value.metrics;
  const changedDimensions = typeof compatibility === "object" && compatibility !== null && !Array.isArray(compatibility)
    ? (compatibility as Record<string, unknown>).changedDimensions
    : null;
  const warnings = typeof compatibility === "object" && compatibility !== null && !Array.isArray(compatibility)
    ? (compatibility as Record<string, unknown>).warnings
    : null;
  return value.schemaVersion === 1
    && value.kind === "historical_regression"
    && typeof value.baselineId === "string"
    && typeof value.candidateId === "string"
    && (value.baselineSourceKind === undefined || ["single_model_benchmark", "arena_summary"].includes(String(value.baselineSourceKind)))
    && (value.candidateSourceKind === undefined || ["single_model_benchmark", "arena_summary"].includes(String(value.candidateSourceKind)))
    && typeof value.createdAt === "string"
    && Array.isArray(metrics)
    && metrics.length <= 32
    && metrics.every((metric: unknown) => metric !== null
      && typeof metric === "object"
      && !Array.isArray(metric)
      && typeof (metric as Record<string, unknown>).metric === "string"
      && ["improved", "regressed", "tie", "insufficient_data"].includes(String((metric as Record<string, unknown>).status))
      && ["directional_only", "uncertainty_aware", "insufficient_data"].includes(String((metric as Record<string, unknown>).evidence))
      && ["baseline", "candidate", "absoluteDelta", "percentDelta", "uncertainty"].every((key) => (metric as Record<string, unknown>)[key] === null || (typeof (metric as Record<string, unknown>)[key] === "number" && Number.isFinite((metric as Record<string, unknown>)[key]))))
    && typeof compatibility === "object"
    && compatibility !== null
    && !Array.isArray(compatibility)
    && typeof (compatibility as Record<string, unknown>).compatible === "boolean"
    && Array.isArray(changedDimensions)
    && changedDimensions.every((dimension: unknown) => typeof dimension === "string")
    && Array.isArray(warnings)
    && warnings.every((warning: unknown) => typeof warning === "string");
}

function isRepeatedHistoricalRegression(value: Record<string, unknown>): value is Record<string, unknown> & RepeatedRunHistoricalRegression {
  const compatibility = value.compatibility;
  const compatibleRecord = typeof compatibility === "object" && compatibility !== null && !Array.isArray(compatibility)
    ? compatibility as Record<string, unknown>
    : null;
  const validRunIds = (items: unknown): items is string[] => Array.isArray(items)
    && items.length >= 5
    && items.length <= 500
    && items.every((item: unknown) => typeof item === "string" && item.length > 0 && item.length <= 128);
  const numericOrNull = (item: unknown): item is number | null => item === null || (typeof item === "number" && Number.isFinite(item));
  return value.schemaVersion === 1
    && value.kind === "repeated_run_historical_regression"
    && validRunIds(value.baselineRunIds)
    && validRunIds(value.candidateRunIds)
    && new Set([...value.baselineRunIds, ...value.candidateRunIds]).size === value.baselineRunIds.length + value.candidateRunIds.length
    && typeof value.createdAt === "string" && value.createdAt.length <= 64
    && value.minimumSamplesPerGroup === 5
    && value.confidenceLevel === 0.95
    && typeof value.statisticalMethod === "string" && value.statisticalMethod.length <= 512
    && Array.isArray(value.assumptions) && value.assumptions.length <= 32 && value.assumptions.every((assumption: unknown) => typeof assumption === "string" && assumption.length <= 512)
    && compatibleRecord !== null
    && typeof compatibleRecord.compatible === "boolean"
    && Array.isArray(compatibleRecord.changedDimensions) && compatibleRecord.changedDimensions.length <= 128 && compatibleRecord.changedDimensions.every((dimension: unknown) => typeof dimension === "string" && dimension.length <= 128)
    && Array.isArray(compatibleRecord.unverifiedDimensions) && compatibleRecord.unverifiedDimensions.length <= 128 && compatibleRecord.unverifiedDimensions.every((dimension: unknown) => typeof dimension === "string" && dimension.length <= 128)
    && Array.isArray(compatibleRecord.warnings) && compatibleRecord.warnings.length <= 128 && compatibleRecord.warnings.every((warning: unknown) => typeof warning === "string" && warning.length <= 512)
    && (compatibleRecord.incompatibilityReasons === undefined || (Array.isArray(compatibleRecord.incompatibilityReasons) && compatibleRecord.incompatibilityReasons.length <= 128 && compatibleRecord.incompatibilityReasons.every((reason: unknown) => typeof reason === "string" && reason.length <= 512)))
    && Array.isArray(value.metrics) && value.metrics.length <= 32
    && value.metrics.every((metric: unknown) => {
      if (metric === null || typeof metric !== "object" || Array.isArray(metric)) return false;
      const item = metric as Record<string, unknown>;
      const interval = item.confidenceInterval;
      const evidence = String(item.evidence);
      const familywiseEvidence = ["bonferroni_welch_t_familywise_ci", "bonferroni_wilson_familywise_ci"];
      const legacyEvidence = ["welch_t_95_ci", "bonferroni_wilson_95_ci"];
      const validInterval = interval === null || (typeof interval === "object" && !Array.isArray(interval)
        && ((familywiseEvidence.includes(evidence) && (interval as Record<string, unknown>).level === REPEATED_METRIC_CONFIDENCE_LEVEL)
          || (legacyEvidence.includes(evidence) && (interval as Record<string, unknown>).level === 0.95))
        && typeof (interval as Record<string, unknown>).lower === "number" && Number.isFinite((interval as Record<string, unknown>).lower)
        && typeof (interval as Record<string, unknown>).upper === "number" && Number.isFinite((interval as Record<string, unknown>).upper)
        && ((interval as Record<string, unknown>).lower as number) <= ((interval as Record<string, unknown>).upper as number));
      return typeof item.metric === "string" && item.metric.length <= 128
        && Number.isSafeInteger(item.baselineSampleCount) && Number(item.baselineSampleCount) >= 0
        && Number.isSafeInteger(item.candidateSampleCount) && Number(item.candidateSampleCount) >= 0
        && ["baselineMean", "candidateMean", "meanDelta", "percentDelta", "baselineStandardDeviation", "candidateStandardDeviation", "standardError", "uncertainty"].every((key) => numericOrNull(item[key]))
        && validInterval
        && (interval !== null || evidence === "insufficient_data")
        && ["improved", "regressed", "no_detected_change", "insufficient_data"].includes(String(item.status))
        && [...legacyEvidence, ...familywiseEvidence, "insufficient_data"].includes(evidence);
    });
}

function FieldSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <AccessibleListbox id={id} label={label} value={value} options={options} placeholder={translate("Select…")} onChange={onChange} />;
}

function MultiRunSelect({ id, label, selectedValues, options, onChange }: { id: string; label: string; selectedValues: string[]; options: Array<{ value: string; label: string }>; onChange: (values: string[]) => void }) {
  return <label className="arena-select-control repeated-run-select" htmlFor={id}>
    <span className="field-label">{label}</span>
    <select id={id} multiple aria-describedby="repeated-run-help" size={Math.min(8, Math.max(5, options.length))} value={selectedValues} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

function EvidenceSummary({ payload }: { payload: SingleModelBenchmarkPayload }) {
  const runtime = typeof payload.profileRevision.runtime === "string" ? payload.profileRevision.runtime : "";
  return <div className="metric-grid"><RoadmapMetricCard label={translate("Run")} value={translate("Saved run")} detail={displayName(payload.benchmarkVersionId, "Benchmark")} /><RoadmapMetricCard label={translate("Model")} value={displayName(payload.profileRevision.model, "Model")} detail={runtimeDisplayName(runtime)} /><RoadmapMetricCard label={translate("Objective")} value={payload.objective?.passed === true ? translate("Pass") : payload.objective?.passed === false ? translate("Fail") : translate("Unavailable")} detail={translate("Immutable verifier evidence")} /></div>;
}

function MetricTable({ payload }: { payload: SingleModelBenchmarkPayload }) {
  return <div className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}><table><thead><tr><th>{translate("Metric")}</th><th>{translate("Value")}</th><th>{translate("Evidence")}</th></tr></thead><tbody>{Object.entries(payload.performance.metrics).map(([name, metric]) => <tr key={name}><td>{metricDisplayName(name)}</td><td>{metric.value === null ? translate("Unavailable") : formatLocaleNumber(metric.value)}</td><td>{metric.unit}<details><summary>{translate("Technical details")}</summary>{metric.source} / {translate(metric.confidence)} / {translate(metric.temperature)}</details></td></tr>)}</tbody></table></div>;
}

function RegressionTable({ comparison, sources }: { comparison: HistoricalRegression; sources: HistoricalSource[] }) {
  return <div className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}>
    <p className="field-help">{comparison.compatibility.compatible ? translate("Conditions are compatible.") : `${translate("Changed conditions")}: ${comparison.compatibility.changedDimensions.map(metricDisplayName).join(", ")}`}</p>
    <div className="field-help"><p><strong>{translate("Baseline")}</strong>: <HistoricalSourceReference sourceId={comparison.baselineId} sourceKind={comparison.baselineSourceKind ?? "single_model_benchmark"} sources={sources} /></p><p><strong>{translate("Candidate")}</strong>: <HistoricalSourceReference sourceId={comparison.candidateId} sourceKind={comparison.candidateSourceKind ?? "single_model_benchmark"} sources={sources} /></p></div>
    <table><thead><tr><th>{translate("Metric")}</th><th>{translate("Baseline")}</th><th>{translate("Candidate")}</th><th>{translate("Delta")}</th><th>{translate("Percent change")}</th></tr></thead><tbody>{comparison.metrics.map((metric) => <tr key={metric.metric}><td>{metricDisplayName(metric.metric)}</td><td>{metric.baseline === null ? "—" : formatLocaleNumber(metric.baseline)}</td><td>{metric.candidate === null ? "—" : formatLocaleNumber(metric.candidate)}</td><td>{metric.absoluteDelta === null ? translate("Insufficient data") : `${metric.absoluteDelta > 0 ? "+" : ""}${formatLocaleNumber(metric.absoluteDelta)} · ${translate(metric.status)} · ${translate(metric.evidence)}`}</td><td>{metric.percentDelta === null ? "—" : `${metric.percentDelta > 0 ? "+" : ""}${formatLocaleNumber(metric.percentDelta * 100, undefined, { maximumFractionDigits: 2 })}%`}</td></tr>)}</tbody></table>
  </div>;
}

function HistoricalSourceReference({ sourceId, sourceKind, sources }: { sourceId: string; sourceKind: "single_model_benchmark" | "arena_summary"; sources: HistoricalSource[] }) {
  const source = sources.find((item) => sourceKind === "single_model_benchmark" ? "runId" in item && item.runId === sourceId : "arenaId" in item && item.arenaId === sourceId);
  const label = !source
    ? translate("Local source run unavailable")
    : "runId" in source
      ? `${displayName(source.profileRevision.model, "Model")} / ${displayName(source.taskId, "Task")} / ${displayName(source.caseId, "Case")}`
      : `${translate("Arena")} / ${displayName(source.taskId, "Task")} / ${displayName(source.caseId, "Case")}`;
  return <span>{label} <code>{sourceId}</code></span>;
}

function RepeatedRegressionTable({ comparison, payloads }: { comparison: RepeatedRunHistoricalRegression; payloads: SingleModelBenchmarkPayload[] }) {
  const profileDimensions = comparison.compatibility.changedDimensions.filter((dimension) => dimension.startsWith("profile.")).map((dimension) => metricDisplayName(dimension.slice("profile.".length)));
  const familywiseCorrection = comparison.statisticalMethod.includes("family-wise");
  return <div className="roadmap-table" role="region" aria-label={translate("Scrollable comparison table")} tabIndex={0}>
    <p className="field-help">{translate(comparison.compatibility.compatible ? "Recorded execution controls match across both groups." : "Recorded execution controls differ; statistical inference is unavailable.")}</p>
    {!comparison.compatibility.compatible && (comparison.compatibility.incompatibilityReasons?.length ?? 0) > 0 && <div className="field-help"><strong>{translate("Reasons statistical inference is unavailable:")}</strong><ul>{comparison.compatibility.incompatibilityReasons?.map((reason, index) => <li key={`${reason}:${index}`}>{repeatedRegressionReasonLabel(reason)}</li>)}</ul></div>}
    {comparison.compatibility.changedDimensions.length > 0 && <p className="field-help">{translate("Changed conditions")}: {comparison.compatibility.changedDimensions.map((dimension) => dimension.startsWith("profile.") ? `${translate("Profile")}: ${metricDisplayName(dimension.slice("profile.".length))}` : metricDisplayName(dimension)).join(", ")}</p>}
    {comparison.compatibility.unverifiedDimensions.length > 0 && <p className="field-help"><strong>{translate("Unverified conditions:")}</strong> {comparison.compatibility.unverifiedDimensions.map(metricDisplayName).join(", ")}. {translate("Missing condition values are not evidence that the conditions were equal.")}</p>}
    {profileDimensions.length > 0 && <p className="field-help">{translate("Profile differences show group association and do not isolate a causal effect.")}</p>}
    <details><summary>{translate("Repeated-run assumptions and source runs")}</summary>
      <p>{translate(comparison.statisticalMethod)}</p>
      <ul>{comparison.assumptions.map((assumption) => <li key={assumption}>{translate(assumption)}</li>)}</ul>
      <h5>{translate("Baseline run group")} · {formatLocaleNumber(comparison.baselineRunIds.length)}</h5>
      <ul>{comparison.baselineRunIds.map((runId) => <li key={runId}><HistoricalRunReference runId={runId} payloads={payloads} /></li>)}</ul>
      <h5>{translate("Candidate run group")} · {formatLocaleNumber(comparison.candidateRunIds.length)}</h5>
      <ul>{comparison.candidateRunIds.map((runId) => <li key={runId}><HistoricalRunReference runId={runId} payloads={payloads} /></li>)}</ul>
    </details>
    <table><thead><tr><th>{translate("Metric")}</th><th>{translate("Baseline n / mean")}</th><th>{translate("Candidate n / mean")}</th><th>{translate(familywiseCorrection ? "Candidate − baseline (family-wise 95% CI)" : "Candidate − baseline (95% CI)")}</th><th>{translate("Assessment")}</th></tr></thead><tbody>{comparison.metrics.map((metric) => <tr key={metric.metric}>
      <td>{metricDisplayName(metric.metric)}</td>
      <td>{formatLocaleNumber(metric.baselineSampleCount)} / {metric.baselineMean === null ? "—" : formatLocaleNumber(metric.baselineMean)}</td>
      <td>{formatLocaleNumber(metric.candidateSampleCount)} / {metric.candidateMean === null ? "—" : formatLocaleNumber(metric.candidateMean)}</td>
      <td>{metric.meanDelta === null ? translate("Insufficient data") : `${metric.meanDelta > 0 ? "+" : ""}${formatLocaleNumber(metric.meanDelta)} ${metric.confidenceInterval ? `[${formatLocaleNumber(metric.confidenceInterval.lower)}, ${formatLocaleNumber(metric.confidenceInterval.upper)}]` : ""}`}</td>
      <td>{translate(metric.status)} · {translate(metric.evidence)}</td>
    </tr>)}</tbody></table>
  </div>;
}

function repeatedRegressionReasonLabel(reason: string): string {
  if (reason === "baseline is empty") return translate("The baseline group has no runs.");
  if (reason === "candidate is empty") return translate("The candidate group has no runs.");
  if (reason === "baseline contains a malformed benchmark sample") return translate("The baseline group contains an invalid saved run.");
  if (reason === "candidate contains a malformed benchmark sample") return translate("The candidate group contains an invalid saved run.");
  if (reason === "a sample has no runId") return translate("A selected saved run has no source run ID.");
  if (reason === "sample runIds are duplicated") return translate("A saved run appears more than once across the groups.");
  const profileGroup = /^(baseline|candidate)\.profileRevision varies within the sample group$/u.exec(reason);
  if (profileGroup) return translate(profileGroup[1] === "baseline" ? "The baseline group contains more than one profile revision." : "The candidate group contains more than one profile revision.");
  const withinGroup = /^(baseline|candidate)\.(.+) varies within the sample group$/u.exec(reason);
  if (withinGroup) return `${translate(withinGroup[1] === "baseline" ? "A required condition varies within the baseline group:" : "A required condition varies within the candidate group:")} ${metricDisplayName(withinGroup[2])}`;
  const betweenGroups = /^(.+) differs between groups$/u.exec(reason);
  if (betweenGroups) return `${translate("The groups differ on a required matching condition:")} ${metricDisplayName(betweenGroups[1])}`;
  return translate("The selected runs do not meet the comparison requirements.");
}

function HistoricalRunReference({ runId, payloads }: { runId: string; payloads: SingleModelBenchmarkPayload[] }) {
  const payload = payloads.find((item) => item.runId === runId);
  const label = payload
    ? `${displayName(payload.profileRevision.model, "Model")} / ${displayName(payload.taskId, "Task")} / ${displayName(payload.caseId, "Case")}`
    : translate("Local source run unavailable");
  return <span>{label} <code>{runId}</code></span>;
}

function reproIdentityDifferenceLabel(difference: ReproIdentityDifference): string {
  switch (difference) {
    case "benchmark_version_unavailable": return translate("Local benchmark version is unavailable.");
    case "benchmark_version_differs": return translate("Local benchmark version differs from the imported bundle.");
    case "benchmark_content_unavailable": return translate("Local benchmark content hash is unavailable.");
    case "benchmark_content_differs": return translate("Local benchmark content differs from the imported bundle.");
    case "profile_revision_unavailable": return translate("Local profile revision is unavailable.");
    case "profile_revision_differs": return translate("Local profile revision ID differs from the imported bundle.");
    case "profile_configuration_differs": return translate("Full local profile configuration differs from the imported bundle.");
    case "model_artifact_unavailable": return translate("The bundle does not contain a model artifact identity.");
    case "model_artifact_hash_unavailable": return translate("The bundle model artifact has no usable SHA-256 digest or content hash; rerunning is disabled.");
    case "local_model_artifact_unavailable": return translate("The local profile has no model artifact identity.");
    case "local_model_artifact_hash_unavailable": return translate("The local model artifact digest or file hash is unavailable.");
    case "model_artifact_identity_differs": return translate("The local model artifact identity differs from the bundle.");
    case "model_artifact_hash_differs": return translate("The local model artifact hash differs from the bundle.");
    case "runtime_version_unavailable": return translate("The bundle does not record a runtime version.");
    case "local_runtime_version_unavailable": return translate("The local runtime version is unavailable.");
    case "runtime_version_differs": return translate("The local runtime version differs from the bundle.");
  }
}

function reproBundleDifferenceLabel(difference: ReproBundleDifference): string {
  switch (difference.kind) {
    case "runtime_unavailable": return `${translate("Runtime unavailable locally:")} ${difference.value}`;
    case "model_unavailable": return `${translate("Model unavailable locally:")} ${difference.value}`;
    case "model_artifact_hash_unavailable": return translate("The bundle model artifact hash is unavailable.");
    case "seed_control_unsupported": return translate("The bundle uses a seed control that the local single-model runner cannot apply; rerunning is disabled.");
    case "runtime_version_unavailable": return translate("The bundle does not record a runtime version.");
    case "hardware_platform_differs": return `${translate("Bundle platform differs:")} ${difference.source} → ${difference.current}`;
  }
}

function reproBundleImportErrorKey(error: unknown): string {
  if (!(error instanceof ReproBundleImportError)) return "The selected file could not be read as a repro bundle.";
  switch (error.code) {
    case "too_large": return "The selected repro bundle exceeds the local size limit.";
    case "malformed_json": return "The bundle file is not valid JSON.";
    case "invalid_shape": return "The file does not have a valid Prompt Arena bundle structure.";
    case "unsupported_schema": return "This Prompt Arena bundle schema is not supported.";
    case "invalid_integrity_schema": return "The bundle integrity schema is missing or invalid.";
    case "invalid_manifest": return "The bundle integrity manifest is invalid.";
    case "invalid_byte_count": return "The bundle byte count does not match its manifest.";
    case "integrity_mismatch": return "The bundle checksum does not match; the file may have changed.";
    case "invalid_reproduction_snapshot": return "The embedded benchmark or model identity snapshot is inconsistent.";
  }
}

function RobustnessResultDetails({ result, recordId, model }: { result: RobustnessResult; recordId: string; model?: string }) {
  const scoredCount = result.variants.filter((variant) => variant.passed !== null && variant.errorCode !== "evidence_save_failed").length;
  return <div className="field-grid" aria-live="polite">
    <p><strong>{translate("Source record")}</strong>: <code>{recordId}</code></p>
    <p><strong>{translate("Base run")}</strong>: {result.baseRunId ? <code>{result.baseRunId}</code> : translate("Unavailable")}</p>
    <p><strong>{translate("Model")}</strong>: {displayName(model, "Model")}</p>
    <p><strong>{translate("Task / case")}</strong>: {displayName(result.taskId, "Task")} / {displayName(result.caseId, "Case")}</p>
    <p><strong>{translate("Recorded")}</strong>: {result.createdAt}</p>
    <p className="field-help">{translate("Variants scored with saved evidence:")} {formatLocaleNumber(scoredCount)}</p>
    <p><strong>{translate("Base result")}</strong>: {result.basePassed === null ? translate(result.baseStatus) : translate(result.basePassed ? "Pass" : "Fail")} · {translate(result.baseEvidenceSaved === true ? "Base evidence saved." : result.baseEvidenceSaved === false ? "Base evidence was not saved." : "Base evidence status is unavailable.")}</p>
    <p><strong>{translate("Robustness score")}</strong>: {result.robustnessScore === null ? translate("Unavailable") : formatLocalePercent(result.robustnessScore)}</p>
    <p><strong>{translate("Variance")}</strong>: {result.variance === null ? translate("Unavailable") : formatLocaleNumber(result.variance, undefined, { maximumFractionDigits: 3 })}</p>
    <p><strong>{translate("Failure clusters")}</strong>: {result.failureClusters.length ? result.failureClusters.map(metricDisplayName).join(", ") : translate("None")}</p>
    <ul className="roadmap-list">{result.variants.map((variant) => <li key={variant.perturbationId}><strong>{metricDisplayName(variant.transformationType)}</strong><span>{variant.provenance} · {variant.passed === null ? translate(variant.executionStatus) : variant.passed ? translate("Pass") : translate("Fail")}{variant.errorCode ? ` · ${translate(variant.errorCode)}` : ""}</span></li>)}</ul>
  </div>;
}

function RoadmapMetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><span>{translate(label)}</span><strong>{value}</strong><small>{translate(detail)}</small></article>;
}

function StateMessage({ title, description, error = false }: { title: string; description: string; error?: boolean }) {
  return <div className={`state-message ${error ? "is-error" : ""}`} role={error ? "alert" : undefined}><strong>{translate(title)}</strong>{error ? <HumanError summary={title} detail={description} /> : <p>{translate(description)}</p>}</div>;
}
