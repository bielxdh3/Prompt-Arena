import type { ArenaSummaryRecord } from "./bridge";

export type RatingOutcome = { matchId: string; winnerId: string | null; competitorAId: string; competitorBId: string; category?: string | null; categoryName?: string | null; valid?: boolean };
export type RatingRuleVersion = "elo-v1" | "bradley-terry-v1";
export type RatingUncertaintyMethod = "sample_count_heuristic" | "laplace_standard_error";
export type ModelRating = { competitorId: string; category: string | null; categoryName?: string | null; rating: number; sampleCount: number; uncertainty: number; comparisonGroupId?: string | null; wins: number; losses: number; ties: number };
export type RatingSet = { schemaVersion: 1; kind: "model_ratings"; ruleVersion: RatingRuleVersion; uncertaintyMethod?: RatingUncertaintyMethod; ratings: ModelRating[]; createdAt: string };

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
    && o.competitorAId
    && o.competitorBId
    && o.competitorAId !== o.competitorBId
    && (o.winnerId === null || o.winnerId === o.competitorAId || o.winnerId === o.competitorBId))
    .sort((a, b) => a.matchId.localeCompare(b.matchId));
  for (const outcome of ordered) {
    const category = categoryOverride ? options.category ?? null : outcome.category ?? null;
    const categoryName = category === null ? null : outcome.categoryName ?? category;
    const categoryKey = category ?? "";
    const aKey = `${categoryKey}\u0000${outcome.competitorAId}`;
    const bKey = `${categoryKey}\u0000${outcome.competitorBId}`;
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
    const separator = key.indexOf("\u0000");
    const competitorId = separator < 0 ? key : key.slice(separator + 1);
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
      ...s,
    };
  }).sort((a, b) => b.rating - a.rating || (a.category ?? "").localeCompare(b.category ?? "") || a.competitorId.localeCompare(b.competitorId));
  return { schemaVersion: 1, kind: "model_ratings", ruleVersion: "elo-v1", uncertaintyMethod: "sample_count_heuristic", ratings: result, createdAt: options.createdAt ?? new Date().toISOString() };
}

type BradleyTerryOptions = { initialRating?: number; category?: string | null; createdAt?: string };
type PairObservation = { a: number; b: number; scoreA: number };
const BRADLEY_TERRY_PRIOR_PRECISION = 1 / 9;
const BRADLEY_TERRY_RATING_SCALE = 400 / Math.LN10;

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
  const columns: number[][] = [];
  for (let column = 0; column < size; column += 1) {
    const unit = Array.from({ length: size }, (_, row) => row === column ? 1 : 0);
    const solution = solveLinearSystem(matrix, unit);
    if (!solution) return null;
    columns.push(solution);
  }
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => columns[column][row]));
}

function fitBradleyTerryComponent(competitorIds: string[], outcomes: RatingOutcome[]): { theta: number[]; standardErrors: number[] } | null {
  const parameterCount = competitorIds.length - 1;
  if (parameterCount <= 0) return null;
  const indexById = new Map(competitorIds.map((id, index) => [id, index]));
  const observations: PairObservation[] = outcomes.map((outcome) => ({
    a: indexById.get(outcome.competitorAId)!,
    b: indexById.get(outcome.competitorBId)!,
    scoreA: outcome.winnerId === null ? 0.5 : outcome.winnerId === outcome.competitorAId ? 1 : 0,
  }));
  const basis = Array.from({ length: competitorIds.length }, (_, row) => Array.from({ length: parameterCount }, (_, column) => (row === column + 1 ? 1 : 0) - 1 / competitorIds.length));
  const priorGram = Array.from({ length: parameterCount }, (_, row) => Array.from({ length: parameterCount }, (_, column) => basis.reduce((sum, vector) => sum + vector[row] * vector[column], 0)));
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
      for (let row = 0; row < parameterCount; row += 1) {
        const xRow = (observation.a === row + 1 ? 1 : 0) - (observation.b === row + 1 ? 1 : 0);
        gradient[row] += xRow * residual;
        for (let column = 0; column < parameterCount; column += 1) {
          const xColumn = (observation.a === column + 1 ? 1 : 0) - (observation.b === column + 1 ? 1 : 0);
          hessian[row][column] += variance * xRow * xColumn;
        }
      }
    }
    for (let row = 0; row < parameterCount; row += 1) {
      for (let component = 0; component < competitorIds.length; component += 1) gradient[row] -= BRADLEY_TERRY_PRIOR_PRECISION * basis[component][row] * theta[component];
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
  const standardErrors = basis.map((row) => {
    let variance = 0;
    for (let left = 0; left < parameterCount; left += 1) for (let right = 0; right < parameterCount; right += 1) variance += row[left] * covariance[left][right] * row[right];
    return Math.sqrt(Math.max(0, variance));
  });
  if (![...fitted.theta, ...standardErrors].every(Number.isFinite)) return null;
  return { theta: fitted.theta, standardErrors };
}

/** Regularized Bradley-Terry logit ability estimates with Laplace-approximation standard errors. */
export function computeBradleyTerryRatings(outcomes: readonly RatingOutcome[], options: BradleyTerryOptions = {}): RatingSet {
  const initialRating = options.initialRating ?? 1_000;
  const categoryOverride = Object.prototype.hasOwnProperty.call(options, "category");
  const ordered = [...outcomes].filter((outcome) => outcome.valid !== false
    && typeof outcome.matchId === "string" && outcome.matchId.trim()
    && outcome.competitorAId && outcome.competitorBId && outcome.competitorAId !== outcome.competitorBId
    && (outcome.winnerId === null || outcome.winnerId === outcome.competitorAId || outcome.winnerId === outcome.competitorBId))
    .sort((left, right) => left.matchId.localeCompare(right.matchId) || left.competitorAId.localeCompare(right.competitorAId) || left.competitorBId.localeCompare(right.competitorBId));
  const matchesByCategory = new Map<string, { category: string | null; categoryName: string | null; outcomes: RatingOutcome[] }>();
  const statistics = new Map<string, { wins: number; losses: number; ties: number }>();
  for (const original of ordered) {
    const category = categoryOverride ? options.category ?? null : original.category ?? null;
    const categoryName = category === null ? null : original.categoryName ?? category;
    const key = category ?? "";
    const group = matchesByCategory.get(key) ?? { category, categoryName, outcomes: [] };
    group.outcomes.push({ ...original, category, categoryName });
    matchesByCategory.set(key, group);
    const aKey = `${key}\u0000${original.competitorAId}`;
    const bKey = `${key}\u0000${original.competitorBId}`;
    const a = statistics.get(aKey) ?? { wins: 0, losses: 0, ties: 0 };
    const b = statistics.get(bKey) ?? { wins: 0, losses: 0, ties: 0 };
    if (original.winnerId === null) { a.ties += 1; b.ties += 1; }
    else if (original.winnerId === original.competitorAId) { a.wins += 1; b.losses += 1; }
    else { a.losses += 1; b.wins += 1; }
    statistics.set(aKey, a); statistics.set(bKey, b);
  }

  const result: ModelRating[] = [];
  for (const [, group] of [...matchesByCategory.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const adjacency = new Map<string, Set<string>>();
    for (const outcome of group.outcomes) {
      const a = adjacency.get(outcome.competitorAId) ?? new Set<string>();
      const b = adjacency.get(outcome.competitorBId) ?? new Set<string>();
      a.add(outcome.competitorBId); b.add(outcome.competitorAId);
      adjacency.set(outcome.competitorAId, a); adjacency.set(outcome.competitorBId, b);
    }
    const remaining = new Set(adjacency.keys());
    const components: string[][] = [];
    while (remaining.size > 0) {
      const seed = [...remaining].sort((left, right) => left.localeCompare(right))[0];
      const component = new Set<string>([seed]);
      const pending = [seed];
      remaining.delete(seed);
      while (pending.length > 0) {
        const current = pending.pop()!;
        for (const neighbor of adjacency.get(current) ?? []) if (remaining.delete(neighbor)) { component.add(neighbor); pending.push(neighbor); }
      }
      components.push([...component].sort((left, right) => left.localeCompare(right)));
    }
    components.sort((left, right) => left[0].localeCompare(right[0]));
    components.forEach((competitorIds, componentIndex) => {
      const idSet = new Set(competitorIds);
      const componentOutcomes = group.outcomes.filter((outcome) => idSet.has(outcome.competitorAId) && idSet.has(outcome.competitorBId));
      const fit = fitBradleyTerryComponent(competitorIds, componentOutcomes);
      if (!fit) return;
      const comparisonGroupId = `${group.category ?? "global"}:component-${componentIndex + 1}`;
      competitorIds.forEach((competitorId, index) => {
        const key = `${group.category ?? ""}\u0000${competitorId}`;
        const stats = statistics.get(key) ?? { wins: 0, losses: 0, ties: 0 };
        result.push({
          competitorId,
          category: group.category,
          categoryName: group.categoryName,
          rating: Math.round((initialRating + fit.theta[index] * BRADLEY_TERRY_RATING_SCALE) * 100) / 100,
          sampleCount: stats.wins + stats.losses + stats.ties,
          uncertainty: Math.round(fit.standardErrors[index] * BRADLEY_TERRY_RATING_SCALE * 100) / 100,
          comparisonGroupId,
          ...stats,
        });
      });
    });
  }
  result.sort((left, right) => (left.category ?? "").localeCompare(right.category ?? "")
    || (left.comparisonGroupId ?? "").localeCompare(right.comparisonGroupId ?? "")
    || right.rating - left.rating
    || left.competitorId.localeCompare(right.competitorId));
  return { schemaVersion: 1, kind: "model_ratings", ruleVersion: "bradley-terry-v1", uncertaintyMethod: "laplace_standard_error", ratings: result, createdAt: options.createdAt ?? new Date().toISOString() };
}

export function computeGlobalAndCategoryRatings(outcomes: readonly RatingOutcome[], createdAt = new Date().toISOString(), ruleVersion: RatingRuleVersion = "elo-v1"): RatingSet {
  const compute = ruleVersion === "bradley-terry-v1" ? computeBradleyTerryRatings : computeEloRatings;
  const global = compute(outcomes, { category: null, createdAt });
  const categoryIds = [...new Set(outcomes
    .filter((outcome) => outcome.valid !== false && outcome.category)
    .map((outcome) => outcome.category as string))]
    .sort((left, right) => left.localeCompare(right));
  const categoryRatings = categoryIds.flatMap((category) => compute(
    outcomes.filter((outcome) => outcome.category === category),
    { category, createdAt },
  ).ratings);
  return { ...global, ratings: [...global.ratings, ...categoryRatings] };
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
      });
    }
  }
  return outcomes.sort((a, b) => a.matchId.localeCompare(b.matchId));
}
