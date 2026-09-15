import type { ArenaSummaryRecord } from "./bridge";

export type RatingOutcome = { matchId: string; winnerId: string | null; competitorAId: string; competitorBId: string; category?: string | null; valid?: boolean };
export type ModelRating = { competitorId: string; category: string | null; rating: number; sampleCount: number; uncertainty: number; wins: number; losses: number; ties: number };
export type RatingSet = { schemaVersion: 1; kind: "model_ratings"; ruleVersion: "elo-v1"; ratings: ModelRating[]; createdAt: string };

export function computeEloRatings(outcomes: readonly RatingOutcome[], options: { initialRating?: number; kFactor?: number; category?: string | null; createdAt?: string } = {}): RatingSet {
  const initialRating = options.initialRating ?? 1_000;
  const kFactor = options.kFactor ?? 32;
  const ratings = new Map<string, number>();
  const stats = new Map<string, { wins: number; losses: number; ties: number }>();
  const categories = new Map<string, string | null>();
  const ordered = [...outcomes].filter((o) => o.valid !== false && o.competitorAId && o.competitorBId).sort((a, b) => a.matchId.localeCompare(b.matchId));
  for (const outcome of ordered) {
    const category = options.category ?? outcome.category ?? null;
    const categoryKey = category ?? "";
    const aKey = `${categoryKey}\u0000${outcome.competitorAId}`;
    const bKey = `${categoryKey}\u0000${outcome.competitorBId}`;
    categories.set(aKey, category); categories.set(bKey, category);
    const a = ratings.get(aKey) ?? initialRating; const b = ratings.get(bKey) ?? initialRating;
    const expectedA = 1 / (1 + 10 ** ((b - a) / 400));
    const actualA = outcome.winnerId === null ? 0.5 : outcome.winnerId === outcome.competitorAId ? 1 : 0;
    ratings.set(aKey, a + kFactor * (actualA - expectedA)); ratings.set(bKey, b + kFactor * ((1 - actualA) - (1 - expectedA)));
    const aStats = stats.get(aKey) ?? { wins: 0, losses: 0, ties: 0 }; const bStats = stats.get(bKey) ?? { wins: 0, losses: 0, ties: 0 };
    if (outcome.winnerId === null) { aStats.ties += 1; bStats.ties += 1; } else if (outcome.winnerId === outcome.competitorAId) { aStats.wins += 1; bStats.losses += 1; } else { aStats.losses += 1; bStats.wins += 1; }
    stats.set(aKey, aStats); stats.set(bKey, bStats);
  }
  const result = [...ratings.entries()].map(([key, rating]) => {
    const separator = key.indexOf("\u0000"); const competitorId = separator < 0 ? key : key.slice(separator + 1); const s = stats.get(key) ?? { wins: 0, losses: 0, ties: 0 }; const sampleCount = s.wins + s.losses + s.ties;
    return { competitorId, category: categories.get(key) ?? null, rating: Math.round(rating * 100) / 100, sampleCount, uncertainty: sampleCount === 0 ? 400 : 400 / Math.sqrt(sampleCount), ...s };
  }).sort((a, b) => b.rating - a.rating || (a.category ?? "").localeCompare(b.category ?? "") || a.competitorId.localeCompare(b.competitorId));
  return { schemaVersion: 1, kind: "model_ratings", ruleVersion: "elo-v1", ratings: result, createdAt: options.createdAt ?? new Date().toISOString() };
}

function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function integer(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }

export function ratingOutcomesFromArenaSummaries(summaries: readonly ArenaSummaryRecord[]): RatingOutcome[] {
  const outcomes: RatingOutcome[] = [];
  for (const summary of summaries) {
    const competitors = summary.competitors.map((value) => ({ id: typeof value.competitorId === "string" ? value.competitorId : null, passed: finite(value.objectivePassed), checked: integer(value.objectiveChecked) })).filter((value): value is { id: string; passed: number | null; checked: number | null } => value.id !== null);
    for (let leftIndex = 0; leftIndex < competitors.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < competitors.length; rightIndex += 1) {
      const left = competitors[leftIndex]; const right = competitors[rightIndex];
      const leftRate = left.checked && left.checked > 0 && left.passed !== null ? left.passed / left.checked : null; const rightRate = right.checked && right.checked > 0 && right.passed !== null ? right.passed / right.checked : null;
      outcomes.push({ matchId: `${summary.arenaId}:${summary.taskId}:${summary.caseId}:${left.id}:${right.id}`, competitorAId: left.id, competitorBId: right.id, winnerId: leftRate === null || rightRate === null || leftRate === rightRate ? null : leftRate > rightRate ? left.id : right.id, category: summary.taskId, valid: leftRate !== null && rightRate !== null });
    }
  }
  return outcomes.sort((a, b) => a.matchId.localeCompare(b.matchId));
}
