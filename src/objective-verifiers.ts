export type ObjectiveVerifierPolicy =
  | { kind: "exact_text"; expected: string }
  | { kind: "numeric_tolerance"; expected: number; tolerance: number }
  | { kind: "json_schema"; expected: unknown; required?: string[] }
  | { kind: "classification"; expected: string }
  | { kind: "safe_pattern"; pattern: string; mode?: "literal" | "regex" }
  | { kind: "required_fields"; fields: string[] };

export type ObjectiveCheck = {
  passed: boolean;
  verifierKind: ObjectiveVerifierPolicy["kind"];
  reason: string;
};

const MAX_POLICY_BYTES = 64 * 1024;
const MAX_PATTERN_BYTES = 4096;
const MAX_REQUIRED_FIELDS = 32;
const MAX_SCHEMA_DEPTH = 16;
const MAX_PATTERN_TOKENS = 256;
const MAX_SCHEMA_KEYS = 128;

export function verifyObjective(policy: ObjectiveVerifierPolicy, actual: string): ObjectiveCheck {
  assertPolicy(policy);
  if (byteLength(actual) > MAX_POLICY_BYTES) throw new Error("Objective response exceeds the local verification bound.");
  switch (policy.kind) {
    case "exact_text":
      return result(policy.kind, normalize(actual) === normalize(policy.expected), "normalized text comparison");
    case "numeric_tolerance": {
      const value = Number(normalize(actual));
      const difference = Math.abs(value - policy.expected);
      return result(policy.kind, Number.isFinite(value) && difference <= policy.tolerance, `absolute difference ${difference}`);
    }
    case "classification":
      return result(policy.kind, normalize(actual).toLowerCase() === normalize(policy.expected).toLowerCase(), "case-insensitive label comparison");
    case "safe_pattern":
      return result(policy.kind, safePatternMatch(policy.pattern, actual, policy.mode), "bounded pattern match");
    case "required_fields": {
      let parsed: unknown;
      try { parsed = JSON.parse(actual) as unknown; } catch { return result(policy.kind, false, "response is not valid JSON"); }
      const missing = policy.fields.filter((field) => !hasPath(parsed, field));
      return result(policy.kind, missing.length === 0, missing.length === 0 ? "all required fields are present" : `missing: ${missing.join(", ")}`);
    }
    case "json_schema": {
      let parsed: unknown;
      try { parsed = JSON.parse(actual) as unknown; } catch { return result(policy.kind, false, "response is not valid JSON"); }
      const required = policy.required ?? (isRecord(policy.expected) && Array.isArray(policy.expected.required) ? policy.expected.required.filter((field): field is string => typeof field === "string") : []);
      const missing = required.filter((field) => !hasPath(parsed, field));
      const shapeAccepted = missing.length === 0 && matchesJsonSchema(parsed, policy.expected, 0);
      return result(policy.kind, shapeAccepted, missing.length > 0 ? `missing: ${missing.join(", ")}` : shapeAccepted ? "bounded JSON shape accepted" : "JSON shape does not match the declared schema");
    }
  }
}

export function normalizeObjectivePolicy(value: unknown): ObjectiveVerifierPolicy | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (byteLength(JSON.stringify(value)) > MAX_POLICY_BYTES) throw new Error("Objective verifier policy is too large.");
  switch (value.kind) {
    case "exact_text": return typeof value.expected === "string" ? { kind: "exact_text", expected: value.expected } : null;
    case "numeric_tolerance": return typeof value.expected === "number" && typeof value.tolerance === "number" && Number.isFinite(value.expected) && Number.isFinite(value.tolerance) && value.tolerance >= 0 && value.tolerance <= 1_000_000 ? { kind: "numeric_tolerance", expected: value.expected, tolerance: value.tolerance } : null;
    case "classification": return typeof value.expected === "string" ? { kind: "classification", expected: value.expected } : null;
    case "safe_pattern": return typeof value.pattern === "string" && byteLength(value.pattern) <= MAX_PATTERN_BYTES && (value.mode === undefined || value.mode === "literal" || value.mode === "regex") ? { kind: "safe_pattern", pattern: value.pattern, ...(value.mode === undefined ? {} : { mode: value.mode }) } : null;
    case "required_fields": return Array.isArray(value.fields) && value.fields.length <= MAX_REQUIRED_FIELDS && value.fields.every((field) => typeof field === "string" && field.length > 0) ? { kind: "required_fields", fields: value.fields } : null;
    case "json_schema": {
      assertJsonValue(value.expected, "JSON schema", 0);
      const required = Array.isArray(value.required) ? value.required.filter((field): field is string => typeof field === "string").slice(0, MAX_REQUIRED_FIELDS) : undefined;
      return { kind: "json_schema", expected: value.expected, ...(required === undefined ? {} : { required }) };
    }
    default: return null;
  }
}

function assertPolicy(policy: ObjectiveVerifierPolicy): void {
  if (byteLength(JSON.stringify(policy)) > MAX_POLICY_BYTES) throw new Error("Objective verifier policy is too large.");
  if (policy.kind === "numeric_tolerance" && (!Number.isFinite(policy.tolerance) || policy.tolerance < 0)) throw new Error("Numeric tolerance is invalid.");
  if (policy.kind === "safe_pattern" && (byteLength(policy.pattern) > MAX_PATTERN_BYTES || (policy.mode !== undefined && policy.mode !== "literal" && policy.mode !== "regex"))) throw new Error("Pattern policy is invalid.");
  if (policy.kind === "required_fields" && (policy.fields.length > MAX_REQUIRED_FIELDS || policy.fields.some((field) => !field || byteLength(field) > 512))) throw new Error("Required fields are invalid.");
  if (policy.kind === "json_schema") assertJsonValue(policy.expected, "JSON schema", 0);
}

function safePatternMatch(pattern: string, actual: string, mode?: "literal" | "regex"): boolean {
  if (byteLength(pattern) > MAX_PATTERN_BYTES || pattern.includes("\0")) return false;

  if (mode === "regex") return safeRegexMatch(pattern, actual);

  if (mode === "literal") {
    const anchoredStart = pattern.startsWith("^");
    const anchoredEnd = pattern.endsWith("$");
    const literal = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);
    if (!literal || literal.includes("\0") || literal.includes("^") || literal.includes("$")) return false;
    const normalizedActual = normalize(actual);
    const normalizedLiteral = normalize(literal);
    if (anchoredStart && anchoredEnd) return normalizedActual === normalizedLiteral;
    if (anchoredStart) return normalizedActual.startsWith(normalizedLiteral);
    if (anchoredEnd) return normalizedActual.endsWith(normalizedLiteral);
    return normalizedActual.includes(normalizedLiteral);
  }

  // Keep this verifier deliberately literal. Regex evaluation is not bounded by
  // the response size and can turn a user-supplied pattern into a ReDoS sink.
  const anchoredStart = pattern.startsWith("^");
  const anchoredEnd = pattern.endsWith("$");
  const literal = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);
  if (
    !literal
    || literal.includes("^")
    || literal.includes("$")
    || /[\\.*+?()[\]{}|]/u.test(literal)
  ) return false;

  const normalizedActual = normalize(actual);
  const normalizedLiteral = normalize(literal);
  if (anchoredStart && anchoredEnd) return normalizedActual === normalizedLiteral;
  if (anchoredStart) return normalizedActual.startsWith(normalizedLiteral);
  if (anchoredEnd) return normalizedActual.endsWith(normalizedLiteral);
  return normalizedActual.includes(normalizedLiteral);
}

type PatternAtom =
  | { kind: "literal"; value: string }
  | { kind: "any" }
  | { kind: "digit" | "space" | "word" }
  | { kind: "class"; negated: boolean; values: string[]; ranges: Array<[number, number]> };

type PatternToken = { atom: PatternAtom; quantifier: "one" | "optional" | "zero_or_more" | "one_or_more" };

function safeRegexMatch(pattern: string, actual: string): boolean {
  const anchoredStart = pattern.startsWith("^");
  const anchoredEnd = pattern.endsWith("$");
  const body = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);
  const tokens = parseSafeRegex(body);
  if (!tokens || tokens.length === 0) return false;
  const characters = [...normalize(actual)];
  const starts = anchoredStart ? [0] : characters.map((_value, index) => index).concat(characters.length);
  for (const start of starts) {
    let positions = new Set<number>([start]);
    for (const token of tokens) {
      const next = new Set<number>();
      for (const position of positions) {
        if (token.quantifier === "optional" || token.quantifier === "zero_or_more") next.add(position);
        let cursor = position;
        let consumed = 0;
        while (cursor < characters.length && atomMatches(token.atom, characters[cursor])) {
          cursor += 1;
          consumed += 1;
          if (token.quantifier !== "zero_or_more" && token.quantifier !== "one_or_more") {
            next.add(cursor);
            break;
          }
          next.add(cursor);
        }
        if (token.quantifier === "one" && consumed === 0) continue;
        if (token.quantifier === "one_or_more" && consumed === 0) continue;
      }
      positions = next;
      if (positions.size === 0) break;
    }
    if ([...positions].some((position) => anchoredEnd ? position === characters.length : position >= start)) return true;
  }
  return false;
}

function parseSafeRegex(pattern: string): PatternToken[] | null {
  const tokens: PatternToken[] = [];
  const characters = [...pattern];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    let atom: PatternAtom | null;
    if (character === "\\") {
      const escaped = characters[++index];
      if (escaped === undefined) return null;
      atom = escaped === "d" ? { kind: "digit" } : escaped === "s" ? { kind: "space" } : escaped === "w" ? { kind: "word" } : { kind: "literal", value: escaped };
    } else if (character === ".") {
      atom = { kind: "any" };
    } else if (character === "[") {
      const parsed = parseCharacterClass(characters, index);
      if (!parsed) return null;
      atom = parsed.atom;
      index = parsed.end;
    } else if ("()|{}".includes(character) || character === "^" || character === "$") {
      return null;
    } else if (character === "*" || character === "+" || character === "?") {
      return null;
    } else {
      atom = { kind: "literal", value: character };
    }
    const next = characters[index + 1];
    const quantifier = next === "?" || next === "*" || next === "+" ? next : undefined;
    if (quantifier) index += 1;
    tokens.push({ atom, quantifier: quantifier === "?" ? "optional" : quantifier === "*" ? "zero_or_more" : quantifier === "+" ? "one_or_more" : "one" });
    if (tokens.length > MAX_PATTERN_TOKENS) return null;
  }
  return tokens;
}

function parseCharacterClass(characters: string[], start: number): { atom: PatternAtom; end: number } | null {
  let index = start + 1;
  const negated = characters[index] === "^";
  if (negated) index += 1;
  const values: string[] = [];
  const ranges: Array<[number, number]> = [];
  while (index < characters.length && characters[index] !== "]") {
    const first = characters[index] === "\\" ? characters[++index] : characters[index];
    if (first === undefined) return null;
    index += 1;
    if (characters[index] === "-" && characters[index + 1] !== "]") {
      index += 1;
      const last = characters[index] === "\\" ? characters[++index] : characters[index];
      if (last === undefined || first.codePointAt(0)! > last.codePointAt(0)!) return null;
      ranges.push([first.codePointAt(0)!, last.codePointAt(0)!]);
      index += 1;
    } else {
      values.push(first);
    }
    if (values.length + ranges.length > MAX_PATTERN_TOKENS) return null;
  }
  if (index >= characters.length || (values.length === 0 && ranges.length === 0)) return null;
  return { atom: { kind: "class", negated, values, ranges }, end: index };
}

function atomMatches(atom: PatternAtom, character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  switch (atom.kind) {
    case "literal": return character === atom.value;
    case "any": return character !== "\n";
    case "digit": return codePoint >= 48 && codePoint <= 57;
    case "space": return /\s/u.test(character);
    case "word": return /[A-Za-z0-9_]/u.test(character);
    case "class": {
      const matches = atom.values.includes(character) || atom.ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
      return atom.negated ? !matches : matches;
    }
  }
}

function hasPath(value: unknown, path: string): boolean {
  return path.split(".").every((part) => {
    if (!isRecord(value) || !Object.hasOwn(value, part)) return false;
    value = value[part];
    return true;
  });
}

function matchesJsonSchema(value: unknown, schema: unknown, depth: number): boolean {
  if (schema === null || schema === undefined) return true;
  if (depth > MAX_SCHEMA_DEPTH || !isRecord(schema)) return false;
  if (Object.keys(schema).length > MAX_SCHEMA_KEYS) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) return false;
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((candidate) => matchesJsonSchema(value, candidate, depth + 1))) return false;
  if (typeof schema.type === "string" && !matchesJsonType(value, schema.type)) return false;

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
  }
  if (typeof value === "number") {
    if (schema.type === "integer" && !Number.isInteger(value)) return false;
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.items !== undefined && !value.every((item) => matchesJsonSchema(item, schema.items, depth + 1))) return false;
  }
  if (isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((field): field is string => typeof field === "string") : [];
    if (required.some((field) => !Object.hasOwn(value, field))) return false;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key) && !matchesJsonSchema(value[key], childSchema, depth + 1)) return false;
    }
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) return false;
  }
  return true;
}

function assertJsonValue(value: unknown, label: string, depth: number): void {
  if (depth > MAX_SCHEMA_DEPTH) throw new Error(`${label} is too deeply nested.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_SCHEMA_KEYS) throw new Error(`${label} contains too many array entries.`);
    value.forEach((child, index) => assertJsonValue(child, `${label}[${index}]`, depth + 1));
    return;
  }
  if (isRecord(value)) {
    if (Object.keys(value).length > MAX_SCHEMA_KEYS) throw new Error(`${label} contains too many keys.`);
    Object.entries(value).forEach(([key, child]) => {
      if (!key || byteLength(key) > 512 || key.includes("\0")) throw new Error(`${label} contains an unsafe key.`);
      assertJsonValue(child, `${label}.${key}`, depth + 1);
    });
    return;
  }
  throw new Error(`${label} contains a non-JSON value.`);
}

function matchesJsonType(value: unknown, type: string): boolean {
  switch (type) {
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return false;
  }
}

function result(verifierKind: ObjectiveCheck["verifierKind"], passed: boolean, reason: string): ObjectiveCheck {
  return { passed, verifierKind, reason };
}

function normalize(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
