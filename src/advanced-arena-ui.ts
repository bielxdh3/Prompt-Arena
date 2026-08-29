import type { AiJudgeScoreInput } from "./advanced-arena";
import { formatLocaleNumber, translate } from "./i18n";

const MAX_SCORE_INPUT_BYTES = 256 * 1024;
const MAX_SCORE_INPUT_LINES = 4096;
const MAX_BLIND_RANKING_BYTES = 8 * 1024;

export function parseAdvancedScoreEntries(input: string, judgeId?: string): AiJudgeScoreInput[] {
  if (typeof input !== "string" || byteLength(input) > MAX_SCORE_INPUT_BYTES) {
    throw new Error("Score entries exceed the local input bound.");
  }
  const normalizedJudgeId = judgeId?.trim();
  const lines = input.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_SCORE_INPUT_LINES) throw new Error("Score entries exceed the local line bound.");
  return lines.map((line, index) => {
    const separator = line.indexOf("=");
    if (separator <= 0 || separator === line.length - 1) {
      throw new Error(`Score entry ${index + 1} must use executionKey=score.`);
    }
    const executionKey = line.slice(0, separator).trim();
    const scoreText = line.slice(separator + 1).trim();
    const score = Number(scoreText);
    if (!executionKey || !scoreText || !Number.isFinite(score) || score < 1 || score > 5) {
      throw new Error(`Score entry ${index + 1} must contain a finite score from 1 to 5.`);
    }
    return {
      executionKey,
      score,
      ...(normalizedJudgeId ? { judgeId: normalizedJudgeId } : {}),
    };
  });
}

export function parseBlindRankingText(
  input: string,
  competitorIds: readonly string[],
): string[][] {
  if (typeof input !== "string" || byteLength(input) > MAX_BLIND_RANKING_BYTES) {
    throw new Error("Blind ranking input exceeds the local bound.");
  }
  const allowed = new Set(competitorIds);
  if (allowed.size < 2 || allowed.size !== competitorIds.length) {
    throw new Error("Blind ranking requires two or more unique competitors.");
  }
  const lines = input.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("Enter one rank group per line before building the blind ranking.");
  const seen = new Set<string>();
  const ranking = lines.map((line, lineIndex) => {
    const group = line.split(",").map((value) => value.trim());
    if (group.some((value) => !value)) throw new Error(`Blind rank ${lineIndex + 1} contains an empty competitor.`);
    return group.map((competitorId) => {
      if (!allowed.has(competitorId)) throw new Error(`Blind ranking competitor is not selected: ${competitorId}.`);
      if (seen.has(competitorId)) throw new Error(`Blind ranking competitor is repeated: ${competitorId}.`);
      seen.add(competitorId);
      return competitorId;
    });
  });
  if (seen.size !== allowed.size) {
    const missing = [...allowed].filter((competitorId) => !seen.has(competitorId));
    throw new Error(`Blind ranking must include every selected competitor: ${missing.join(", ")}.`);
  }
  return ranking;
}

export function scoreLookupFromEntries(entries: readonly AiJudgeScoreInput[]): Map<string, number> {
  return new Map(entries.map((entry) => [entry.executionKey, entry.score]));
}

export function formatAdvancedValue(value: number | null, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) return translate("Insufficient data");
  return `${formatLocaleNumber(value, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
