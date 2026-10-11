import type { ArenaSummaryRecord } from "./bridge";

export type RatingOutcome = { matchId: string; winnerId: string | null; competitorAId: string; competitorBId: string; category?: string | null; categoryName?: string | null; clusterId?: string | null; valid?: boolean };
export type RatingRuleVersion = "elo-v1" | "bradley-terry-v1";
export type RatingUncertaintyMethod = "sample_count_heuristic" | "laplace_standard_error" | "cluster_robust_standard_error_v1" | "prior_only_standard_deviation_insufficient_clusters_v1" | "component_specific_v1";
export type ModelRating = { competitorId: string; category: string | null; categoryName?: string | null; rating: number; sampleCount: number; /** Distinct source IDs when complete; this count does not assert statistical independence. */ sourceClusterCount?: number; uncertainty: number; uncertaintyMethod?: Exclude<RatingUncertaintyMethod, "component_specific_v1">; comparisonGroupId?: string | null; wins: number; losses: number; ties: number };
export type RatingSourceReference = { arenaId: string; contentHash: string };
export type RatingSet = { schemaVersion: 1; kind: "model_ratings"; ruleVersion: RatingRuleVersion; uncertaintyMethod?: RatingUncertaintyMethod; ratings: ModelRating[]; sourcePopulation?: RatingSourceReference[]; verificationStatus?: "unverified"; createdAt: string };

// An encoded tuple keeps null, an empty category, and embedded NULs distinct.
// Concatenating with a delimiter can merge unrelated imported model identities.
function ratingKey(category: string | null, competitorId: string): string {
  return JSON.stringify([category, competitorId]);
}

// Code-unit ordering is independent of host locale and input insertion order.
function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareOptionalText(left: string | null | undefined, right: string | null | undefined): number {
  if (left == null) return right == null ? 0 : -1;
  if (right == null) return 1;
  return compareText(left, right);
}

function compareRatingOutcomes(left: RatingOutcome, right: RatingOutcome): number {
  return compareText(left.matchId, right.matchId)
    || compareText(left.competitorAId, right.competitorAId)
    || compareText(left.competitorBId, right.competitorBId)
    || compareOptionalText(left.winnerId, right.winnerId)
    || compareOptionalText(left.category, right.category)
    || compareOptionalText(left.categoryName, right.categoryName)
    || compareOptionalText(left.clusterId, right.clusterId);
}

const RATING_UNCERTAINTY_METHODS: readonly RatingUncertaintyMethod[] = [
  "sample_count_heuristic",
  "laplace_standard_error",
  "cluster_robust_standard_error_v1",
  "prior_only_standard_deviation_insufficient_clusters_v1",
  "component_specific_v1",
];
const RATING_ROW_UNCERTAINTY_METHODS: readonly Exclude<RatingUncertaintyMethod, "component_specific_v1">[] = [
  "sample_count_heuristic",
  "laplace_standard_error",
  "cluster_robust_standard_error_v1",
  "prior_only_standard_deviation_insufficient_clusters_v1",
];

function isRatingSourceReference(value: unknown): value is RatingSourceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.arenaId === "string" && source.arenaId.length > 0 && source.arenaId.length <= 128
    && typeof source.contentHash === "string" && /^[a-f0-9]{64}$/iu.test(source.contentHash);
}

/** Accept current rating snapshots while retaining compatibility with older snapshots that omitted the method. */
export function isRatingSet(value: unknown): value is RatingSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const method = record.uncertaintyMethod;
  return record.schemaVersion === 1
    && record.kind === "model_ratings"
    && (record.verificationStatus === undefined || record.verificationStatus === "unverified")
    && (record.ruleVersion === "elo-v1" || record.ruleVersion === "bradley-terry-v1")
    && (method === undefined || (typeof method === "string" && RATING_UNCERTAINTY_METHODS.includes(method as RatingUncertaintyMethod)))
    && typeof record.createdAt === "string"
    && (record.sourcePopulation === undefined || (Array.isArray(record.sourcePopulation)
      && record.sourcePopulation.length > 0 && record.sourcePopulation.length <= 4096
      && record.sourcePopulation.every(isRatingSourceReference)))
    && Array.isArray(record.ratings)
    && record.ratings.length <= 1000
    && record.ratings.every((rating: unknown) => {
      if (!rating || typeof rating !== "object" || Array.isArray(rating)) return false;
      const item = rating as Record<string, unknown>;
      const rowMethod = item.uncertaintyMethod;
      return typeof item.competitorId === "string"
        && (item.category === null || typeof item.category === "string")
        && typeof item.rating === "number" && Number.isFinite(item.rating)
        && Number.isSafeInteger(item.sampleCount) && Number(item.sampleCount) >= 0
        && (item.sourceClusterCount === undefined || (Number.isSafeInteger(item.sourceClusterCount) && Number(item.sourceClusterCount) > 0))
        && typeof item.uncertainty === "number" && Number.isFinite(item.uncertainty) && item.uncertainty >= 0
        && (rowMethod === undefined || (typeof rowMethod === "string" && RATING_ROW_UNCERTAINTY_METHODS.includes(rowMethod as Exclude<RatingUncertaintyMethod, "component_specific_v1">)))
        && ["wins", "losses", "ties"].every((key) => Number.isSafeInteger(item[key]) && Number(item[key]) >= 0)
        && (item.comparisonGroupId === undefined || item.comparisonGroupId === null || typeof item.comparisonGroupId === "string");
    });
}

export function computeEloRatings(outcomes: readonly RatingOutcome[], options: { initialRating?: number; kFactor?: number; category?: string | null; createdAt?: string } = {}): RatingSet {
  const initialRating = options.initialRating ?? 1_000;
  const kFactor = options.kFactor ?? 32;
  const ratings = new Map<string, number>();
  const stats = new Map<string, { wins: number; losses: number; ties: number }>();
  const categories = new Map<string, string | null>();
  const categoryNames = new Map<string, string | null>();
  const categoryOverride = Object.prototype.hasOwnProperty.call(options, "category");
  const ordered = [...outcomes].filter((o) => o.valid !== false
    && typeof o.matchId === "string" && o.matchId.trim()
    && typeof o.competitorAId === "string" && o.competitorAId.trim()
    && typeof o.competitorBId === "string" && o.competitorBId.trim()
    && o.competitorAId !== o.competitorBId
    && (o.category == null || typeof o.category === "string")
    && (o.categoryName == null || typeof o.categoryName === "string")
    && (o.winnerId === null || o.winnerId === o.competitorAId || o.winnerId === o.competitorBId))
    .sort(compareRatingOutcomes);
  for (const outcome of ordered) {
    const category = categoryOverride ? options.category ?? null : outcome.category ?? null;
    const categoryName = category === null ? null : outcome.categoryName ?? category;
    const aKey = ratingKey(category, outcome.competitorAId);
    const bKey = ratingKey(category, outcome.competitorBId);
    categories.set(aKey, category); categories.set(bKey, category);
    categoryNames.set(aKey, categoryName); categoryNames.set(bKey, categoryName);
    const a = ratings.get(aKey) ?? initialRating;
    const b = ratings.get(bKey) ?? initialRating;
    const expectedA = 1 / (1 + 10 ** ((b - a) / 400));
    const actualA = outcome.winnerId === null ? 0.5 : outcome.winnerId === outcome.competitorAId ? 1 : 0;
    ratings.set(aKey, a + kFactor * (actualA - expectedA)); ratings.set(bKey, b + kFactor * ((1 - actualA) - (1 - expectedA)));
    const aStats = stats.get(aKey) ?? { wins: 0, losses: 0, ties: 0 }; const bStats = stats.get(bKey) ?? { wins: 0, losses: 0, ties: 0 };
    if (outcome.winnerId === null) { aStats.ties += 1; bStats.ties += 1; } else if (outcome.winnerId === outcome.competitorAId) { aStats.wins += 1; bStats.losses += 1; } else { aStats.losses += 1; bStats.wins += 1; }
    stats.set(aKey, aStats); stats.set(bKey, bStats);
  }
  const result = [...ratings.entries()].map(([key, rating]) => {
    const [, competitorId] = JSON.parse(key) as [string | null, string];
    const s = stats.get(key) ?? { wins: 0, losses: 0, ties: 0 };
    const sampleCount = s.wins + s.losses + s.ties;
    const category = categories.get(key) ?? null;
    return {
      competitorId,
      category,
      categoryName: category === null ? null : categoryNames.get(key) ?? category,
      rating: Math.round(rating * 100) / 100,
      sampleCount,
      uncertainty: sampleCount === 0 ? 400 : 400 / Math.sqrt(sampleCount),
      uncertaintyMethod: "sample_count_heuristic" as const,
      ...s,
    };
  }).sort((a, b) => b.rating - a.rating || compareOptionalText(a.category, b.category) || compareText(a.competitorId, b.competitorId));
  return { schemaVersion: 1, kind: "model_ratings", ruleVersion: "elo-v1", uncertaintyMethod: "sample_count_heuristic", ratings: result, createdAt: options.createdAt ?? new Date().toISOString() };
}

type BradleyTerryOptions = { initialRating?: number; category?: string | null; createdAt?: string };
type PairObservation = { a: number; b: number; scoreA: number; clusterId?: string | null };
type BradleyTerryUncertaintyMethod = Exclude<RatingUncertaintyMethod, "sample_count_heuristic" | "component_specific_v1">;
const BRADLEY_TERRY_PRIOR_PRECISION = 1 / 9;
const BRADLEY_TERRY_RATING_SCALE = 400 / Math.LN10;

function aggregateUncertaintyMethod(methods: readonly RatingUncertaintyMethod[]): RatingUncertaintyMethod {
  const distinct = new Set(methods);
  if (distinct.size === 0) return "laplace_standard_error";
  if (distinct.size === 1) return methods[0];
  return "component_specific_v1";
}

function logistic(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function logLogistic(value: number): number {
  return value >= 0 ? -Math.log1p(Math.exp(-value)) : value - Math.log1p(Math.exp(value));
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    const pivot = augmented[pivotRow][column];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-14) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const divisor = augmented[column][column];
    for (let cell = column; cell <= size; cell += 1) augmented[column][cell] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cell = column; cell <= size; cell += 1) augmented[row][cell] -= factor * augmented[column][cell];
    }
  }
  const solution = augmented.map((row) => row[size]);
  return solution.every(Number.isFinite) ? solution : null;
}

function invertMatrix(matrix: number[][]): number[][] | null {
  const size = matrix.length;
  // Eliminate [A | I] once. Solving A*x=e_i independently for each column
  // would repeat cubic elimination N times, making covariance O(N^4).
  const augmented = matrix.map((row, index) => [...row, ...Array.from({ length: size }, (_, column) => Number(index === column))]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    const pivot = augmented[pivotRow][column];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-14) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    for (let cell = column; cell < size * 2; cell += 1) augmented[column][cell] /= pivot;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cell = column; cell < size * 2; cell += 1) augmented[row][cell] -= factor * augmented[column][cell];
    }
  }
  const inverse = augmented.map((row) => row.slice(size));
  return inverse.every((row) => row.every(Number.isFinite)) ? inverse : null;
}

function fitBradleyTerryComponent(competitorIds: string[], outcomes: RatingOutcome[]): { theta: number[]; standardErrors: number[]; uncertaintyMethod: BradleyTerryUncertaintyMethod; sourceClusterCount?: number } | null {
  const parameterCount = competitorIds.length - 1;
  if (parameterCount <= 0) return null;
  const indexById = new Map(competitorIds.map((id, index) => [id, index]));
  const observations: PairObservation[] = outcomes.map((outcome) => ({
    a: indexById.get(outcome.competitorAId)!,
    b: indexById.get(outcome.competitorBId)!,
    scoreA: outcome.winnerId === null ? 0.5 : outcome.winnerId === outcome.competitorAId ? 1 : 0,
    clusterId: outcome.clusterId,
  }));
  const basis = Array.from({ length: competitorIds.length }, (_, row) => Array.from({ length: parameterCount }, (_, column) => (row === column + 1 ? 1 : 0) - 1 / competitorIds.length));
  // Centered basis Gram matrix is identity minus the all-ones matrix / N.
  const priorGram = Array.from({ length: parameterCount }, (_, row) => Array.from({ length: parameterCount }, (_, column) => Number(row === column) - 1 / competitorIds.length));
  const evaluate = (parameters: number[]) => {
    const theta = basis.map((row) => row.reduce((sum, coefficient, index) => sum + coefficient * parameters[index], 0));
    let logPosterior = -BRADLEY_TERRY_PRIOR_PRECISION * theta.reduce((sum, value) => sum + value ** 2, 0) / 2;
    const gradient = Array(parameterCount).fill(0) as number[];
    const hessian = Array.from({ length: parameterCount }, () => Array(parameterCount).fill(0) as number[]);
    for (const observation of observations) {
      const difference = theta[observation.a] - theta[observation.b];
      const probabilityA = logistic(difference);
      const residual = observation.scoreA - probabilityA;
      const variance = probabilityA * (1 - probabilityA);
      logPosterior += observation.scoreA * logLogistic(difference) + (1 - observation.scoreA) * logLogistic(-difference);
      // Each pair touches at most two coordinates; updating the full dense
      // Hessian for every observation needlessly costs O(matches * N^2).
      const a = observation.a - 1;
      const b = observation.b - 1;
      if (a >= 0) {
        gradient[a] += residual;
        hessian[a][a] += variance;
      }
      if (b >= 0) {
        gradient[b] -= residual;
        hessian[b][b] += variance;
      }
      if (a >= 0 && b >= 0) {
        hessian[a][b] -= variance;
        hessian[b][a] -= variance;
      }
    }
    for (let row = 0; row < parameterCount; row += 1) {
      gradient[row] -= BRADLEY_TERRY_PRIOR_PRECISION * theta[row + 1];
      for (let column = 0; column < parameterCount; column += 1) hessian[row][column] += BRADLEY_TERRY_PRIOR_PRECISION * priorGram[row][column];
    }
    return { theta, logPosterior, gradient, hessian };
  };

  let parameters = Array(parameterCount).fill(0) as number[];
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const current = evaluate(parameters);
    const step = solveLinearSystem(current.hessian, current.gradient);
    if (!step) return null;
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
    let scale = 1;
    let accepted: number[] | null = null;
    while (scale >= 1 / 1024) {
      const candidate = parameters.map((value, index) => value + step[index] * scale);
      if (evaluate(candidate).logPosterior >= current.logPosterior - 1e-12) {
        accepted = candidate;
        break;
      }
      scale /= 2;
    }
    if (!accepted) break;
    parameters = accepted;
  }

  const fitted = evaluate(parameters);
  const covariance = invertMatrix(fitted.hessian);
  if (!covariance) return null;
  // Only covariance row sums and diagonals are needed for centered abilities.
  const standardErrorsFromCovariance = (matrix: number[][]) => {
    const rowSums = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
    const centeredCommon = rowSums.reduce((sum, value) => sum + value, 0) / (competitorIds.length ** 2);
    return competitorIds.map((_, index) => {
      const variance = index === 0 ? centeredCommon : matrix[index - 1][index - 1] - 2 * rowSums[index - 1] / competitorIds.length + centeredCommon;
      return Math.sqrt(Math.max(0, variance));
    });
  };
  const hasCompleteClusterIds = observations.every((observation) => typeof observation.clusterId === "string" && observation.clusterId.trim().length > 0);
  let uncertaintyMethod: BradleyTerryUncertaintyMethod = "laplace_standard_error";
  let standardErrors: number[];
  let sourceClusterCount: number | undefined;
  if (!hasCompleteClusterIds) {
    standardErrors = standardErrorsFromCovariance(covariance);
  } else {
    const clusterIds = [...new Set(observations.map((observation) => observation.clusterId!))];
    sourceClusterCount = clusterIds.length;
    if (clusterIds.length < 2) {
      // With one source run there is no between-run variation to estimate. Use the BT prior SD, not the falsely precise Laplace SE.
      const priorStandardError = Math.sqrt((1 - 1 / competitorIds.length) / BRADLEY_TERRY_PRIOR_PRECISION);
      standardErrors = competitorIds.map(() => priorStandardError);
      uncertaintyMethod = "prior_only_standard_deviation_insufficient_clusters_v1";
    } else {
      const clusterScores = new Map(clusterIds.map((clusterId) => [clusterId, Array(parameterCount).fill(0) as number[]]));
      for (const observation of observations) {
        const score = clusterScores.get(observation.clusterId!)!;
        const probabilityA = logistic(fitted.theta[observation.a] - fitted.theta[observation.b]);
        const residual = observation.scoreA - probabilityA;
        if (observation.a > 0) score[observation.a - 1] += residual;
        if (observation.b > 0) score[observation.b - 1] -= residual;
      }
      const correction = clusterIds.length / (clusterIds.length - 1);
      // The sandwich diagonal equals the sum of squared cluster influences.
      // This avoids materializing the meat and full robust covariance matrices.
      const variances = Array(competitorIds.length).fill(0) as number[];
      for (const score of clusterScores.values()) {
        const influence = covariance.map((row) => row.reduce((sum, value, index) => sum + value * score[index], 0));
        const meanInfluence = influence.reduce((sum, value) => sum + value, 0) / competitorIds.length;
        for (let index = 0; index < competitorIds.length; index += 1) {
          const centered = (index === 0 ? 0 : influence[index - 1]) - meanInfluence;
          variances[index] += centered * centered;
        }
      }
      standardErrors = variances.map((variance) => Math.sqrt(correction * variance));
      uncertaintyMethod = "cluster_robust_standard_error_v1";
    }
  }
  if (![...fitted.theta, ...standardErrors].every(Number.isFinite)) return null;
  return { theta: fitted.theta, standardErrors, uncertaintyMethod, ...(sourceClusterCount === undefined ? {} : { sourceClusterCount }) };
}

/** Regularized Bradley-Terry abilities with Laplace or source-cluster robust standard errors; fewer than two clusters use prior-only SDs. These are not calibrated confidence intervals. */
export function computeBradleyTerryRatings(outcomes: readonly RatingOutcome[], options: BradleyTerryOptions = {}): RatingSet {
  const initialRating = options.initialRating ?? 1_000;
  const categoryOverride = Object.prototype.hasOwnProperty.call(options, "category");
  const ordered = [...outcomes].filter((outcome) => outcome.valid !== false
    && typeof outcome.matchId === "string" && outcome.matchId.trim()
    && typeof outcome.competitorAId === "string" && outcome.competitorAId.trim()
    && typeof outcome.competitorBId === "string" && outcome.competitorBId.trim()
    && outcome.competitorAId !== outcome.competitorBId
    && (outcome.category == null || typeof outcome.category === "string")
    && (outcome.categoryName == null || typeof outcome.categoryName === "string")
    && (outcome.winnerId === null || outcome.winnerId === outcome.competitorAId || outcome.winnerId === outcome.competitorBId))
    .sort(compareRatingOutcomes);
  const matchesByCategory = new Map<string | null, { category: string | null; categoryName: string | null; outcomes: RatingOutcome[] }>();
  const statistics = new Map<string, { wins: number; losses: number; ties: number }>();
  const uncertaintyMethods = new Set<RatingUncertaintyMethod>();
  for (const original of ordered) {
    const category = categoryOverride ? options.category ?? null : original.category ?? null;
    const categoryName = category === null ? null : original.categoryName ?? category;
    const key = category;
    const group = matchesByCategory.get(key) ?? { category, categoryName, outcomes: [] };
    group.outcomes.push({ ...original, category, categoryName });
    matchesByCategory.set(key, group);
    const aKey = ratingKey(category, original.competitorAId);
    const bKey = ratingKey(category, original.competitorBId);
    const a = statistics.get(aKey) ?? { wins: 0, losses: 0, ties: 0 };
    const b = statistics.get(bKey) ?? { wins: 0, losses: 0, ties: 0 };
    if (original.winnerId === null) { a.ties += 1; b.ties += 1; }
    else if (original.winnerId === original.competitorAId) { a.wins += 1; b.losses += 1; }
    else { a.losses += 1; b.wins += 1; }
    statistics.set(aKey, a); statistics.set(bKey, b);
  }

  const result: ModelRating[] = [];
  for (const [, group] of [...matchesByCategory.entries()].sort(([left], [right]) => compareOptionalText(left, right))) {
    const adjacency = new Map<string, Set<string>>();
    for (const outcome of group.outcomes) {
      const a = adjacency.get(outcome.competitorAId) ?? new Set<string>();
      const b = adjacency.get(outcome.competitorBId) ?? new Set<string>();
      a.add(outcome.competitorBId); b.add(outcome.competitorAId);
      adjacency.set(outcome.competitorAId, a); adjacency.set(outcome.competitorBId, b);
    }
    const remaining = new Set(adjacency.keys());
    const components: string[][] = [];
    // Sort once; re-sorting the shrinking set for every disconnected component
    // turns a large collection of independent pairs into quadratic work.
    for (const seed of [...remaining].sort(compareText)) {
      if (!remaining.has(seed)) continue;
      const component = new Set<string>([seed]);
      const pending = [seed];
      remaining.delete(seed);
      while (pending.length > 0) {
        const current = pending.pop()!;
        for (const neighbor of adjacency.get(current) ?? []) if (remaining.delete(neighbor)) { component.add(neighbor); pending.push(neighbor); }
      }
      components.push([...component].sort(compareText));
    }
    components.sort((left, right) => compareText(left[0], right[0]));
    const componentIndexById = new Map<string, number>();
    const matchesByComponent = components.map(() => [] as RatingOutcome[]);
    components.forEach((ids, componentIndex) => ids.forEach((id) => componentIndexById.set(id, componentIndex)));
    for (const outcome of group.outcomes) {
      matchesByComponent[componentIndexById.get(outcome.competitorAId)!].push(outcome);
    }
    components.forEach((competitorIds, componentIndex) => {
      const fit = fitBradleyTerryComponent(competitorIds, matchesByComponent[componentIndex]);
      if (!fit) return;
      uncertaintyMethods.add(fit.uncertaintyMethod);
      // Preserve ordinary historical group labels; encode reserved/imported
      // category strings so global and category-specific groups cannot alias.
      const groupLabel = group.category === null ? "global"
        : group.category !== "global" && /^[A-Za-z0-9._@-]+$/u.test(group.category)
          ? group.category
          : `category:${JSON.stringify(group.category)}`;
      const comparisonGroupId = `${groupLabel}:component-${componentIndex + 1}`;
      competitorIds.forEach((competitorId, index) => {
        const key = ratingKey(group.category, competitorId);
        const stats = statistics.get(key) ?? { wins: 0, losses: 0, ties: 0 };
        result.push({
          competitorId,
          category: group.category,
          categoryName: group.categoryName,
          rating: Math.round((initialRating + fit.theta[index] * BRADLEY_TERRY_RATING_SCALE) * 100) / 100,
          sampleCount: stats.wins + stats.losses + stats.ties,
          ...(fit.sourceClusterCount === undefined ? {} : { sourceClusterCount: fit.sourceClusterCount }),
          uncertainty: Math.round(fit.standardErrors[index] * BRADLEY_TERRY_RATING_SCALE * 100) / 100,
          uncertaintyMethod: fit.uncertaintyMethod,
          comparisonGroupId,
          ...stats,
        });
      });
    });
  }
  result.sort((left, right) => compareOptionalText(left.category, right.category)
    || compareOptionalText(left.comparisonGroupId, right.comparisonGroupId)
    || right.rating - left.rating
    || compareText(left.competitorId, right.competitorId));
  return { schemaVersion: 1, kind: "model_ratings", ruleVersion: "bradley-terry-v1", uncertaintyMethod: aggregateUncertaintyMethod([...uncertaintyMethods]), ratings: result, createdAt: options.createdAt ?? new Date().toISOString() };
}

export function computeGlobalAndCategoryRatings(outcomes: readonly RatingOutcome[], createdAt = new Date().toISOString(), ruleVersion: RatingRuleVersion = "elo-v1"): RatingSet {
  const compute = ruleVersion === "bradley-terry-v1" ? computeBradleyTerryRatings : computeEloRatings;
  const global = compute(outcomes, { category: null, createdAt });
  const categoryIds = [...new Set(outcomes
    .filter((outcome) => outcome.valid !== false && outcome.category)
    .map((outcome) => outcome.category as string))]
    .sort(compareText);
  const categorySets = categoryIds.map((category) => compute(
    outcomes.filter((outcome) => outcome.category === category),
    { category, createdAt },
  ));
  return {
    ...global,
    uncertaintyMethod: aggregateUncertaintyMethod([global.uncertaintyMethod ?? "laplace_standard_error", ...categorySets.map((set) => set.uncertaintyMethod ?? "laplace_standard_error")]),
    ratings: [...global.ratings, ...categorySets.flatMap((set) => set.ratings)],
  };
}

function integer(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }

export function ratingOutcomesFromArenaSummaries(summaries: readonly ArenaSummaryRecord[]): RatingOutcome[] {
  const outcomes: RatingOutcome[] = [];
  for (const summary of summaries) {
    const competitors = summary.competitors.map((value) => ({
      id: typeof value.competitorId === "string" ? value.competitorId : null,
      passed: integer(value.objectivePassed),
      checked: integer(value.objectiveChecked),
    })).filter((value): value is { id: string; passed: number | null; checked: number | null } => value.id !== null);
    for (let leftIndex = 0; leftIndex < competitors.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < competitors.length; rightIndex += 1) {
      const left = competitors[leftIndex]; const right = competitors[rightIndex];
      const leftRate = left.checked && left.checked > 0 && left.passed !== null ? left.passed / left.checked : null;
      const rightRate = right.checked && right.checked > 0 && right.passed !== null ? right.passed / right.checked : null;
      if (leftRate === null || rightRate === null || left.passed === null || left.checked === null || left.passed > left.checked || right.passed === null || right.checked === null || right.passed > right.checked) continue;
      outcomes.push({
        matchId: `${summary.arenaId}:${summary.taskId}:${summary.caseId}:${left.id}:${right.id}`,
        competitorAId: left.id,
        competitorBId: right.id,
        winnerId: leftRate === rightRate ? null : leftRate > rightRate ? left.id : right.id,
        category: typeof summary.categoryId === "string" ? summary.categoryId : null,
        categoryName: typeof summary.categoryName === "string" ? summary.categoryName : null,
        clusterId: `arena-summary:${summary.contentHash}`,
      });
    }
  }
  return outcomes.sort(compareRatingOutcomes);
}
