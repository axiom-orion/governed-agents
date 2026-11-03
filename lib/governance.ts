// lib/governance.ts
// Pre-action governance gate for a multi-agent flow.
// This is the differentiator: agents propose actions; the gate ALLOWS or BLOCKS
// each one against an explicit policy, and every decision is auditable.
// Strict TypeScript, no `any`. Pure + synchronous so it is trivially testable.

export type AgentRole = "researcher" | "reasoner" | "executor";

export interface Provenance {
  readonly sourceId: string;
  readonly snippet: string;
  readonly score: number; // retrieval confidence in [0, 1]
}

export interface AgentStep {
  readonly id: string;
  readonly role: AgentRole;
  readonly summary: string;
  readonly provenance: readonly Provenance[];
  readonly at: string; // ISO-8601
}

export interface ProposedAction {
  readonly kind: string; // e.g. "send_email" | "write_record"
  readonly payload: Readonly<Record<string, unknown>>;
  readonly justification: string;
  readonly provenance: readonly Provenance[];
  /** Present when the action was decided by a multi-model vote (the triad). */
  readonly consensus?: Consensus;
  /** Attested identity of the model instance whose draft was chosen (the generator). */
  readonly proposedBy?: VoiceIdentity;
  /** Present when an independent adversarial reviewer (the Red Cell) examined the action. */
  readonly redCell?: RedCellReview;
}

/**
 * The attested identity of one model instance — the unit "independence" is counted in.
 * For API-backed voices this is the configured (provider, model id) pair: it attests what
 * we *configured and called*, and deliberately claims no more — it cannot see through a
 * provider's internal routing (that residual trust is named in the docs, not papered over).
 */
export interface VoiceIdentity {
  readonly provider: string; // proposer label, e.g. "anthropic" | "gemini" | "grok" | "offline-stub"
  readonly model: string; // the model id the call was made with
}

/** Two voices are the same instance when provider and model id both match. */
export function sameVoice(a: VoiceIdentity, b: VoiceIdentity): boolean {
  return a.provider === b.provider && a.model === b.model;
}

/** One model's vote in a multi-model action proposal. */
export interface ModelVote {
  readonly model: string; // provider label, e.g. "claude" | "gemini" | "grok"
  readonly kind: string; // the action kind this model proposed
  readonly justification: string;
  /** True when the provider was unavailable (no key) or its call failed. */
  readonly abstained?: boolean;
  /** Attested identity of the instance that cast this vote (absent on legacy traces). */
  readonly voice?: VoiceIdentity;
}

/** Outcome of aggregating the triad's votes for one action. */
export interface Consensus {
  readonly votes: readonly ModelVote[];
  /** Share of participating (non-abstaining) models that backed the chosen kind, [0,1]. */
  readonly agreementRatio: number;
  /** The action kind the participating models most agreed on. */
  readonly chosenKind: string;
  /** Distinct attested voices among the votes that backed the chosen kind (absent on legacy traces). */
  readonly distinctVoices?: number;
}

/** The Red Cell's adversarial verdict on a proposed action. */
export interface RedCellReview {
  /** "object" = the strongest case against the action stands; route to a human. */
  readonly verdict: "concur" | "object";
  readonly critique: string;
  /** Attested identity of the reviewing instance — compared against `proposedBy`. */
  readonly voice: VoiceIdentity;
}

// Three-tier outcome: a clean action is allowed; a hard violation blocks; a
// "review" violation routes to a human (needs_approval) when nothing hard-blocks.
export type Decision = "allow" | "block" | "needs_approval";

export interface PolicyViolation {
  readonly rule: string;
  readonly detail: string;
  /** "block" (default) fails the action; "review" routes it for human approval. */
  readonly severity?: "block" | "review";
}

export interface PolicyDecision {
  readonly decision: Decision;
  readonly violations: readonly PolicyViolation[];
  readonly evaluatedAt: string;
}

export interface PolicyRule {
  readonly name: string;
  // Return a violation if the action fails this rule, else null.
  evaluate(action: ProposedAction): PolicyViolation | null;
}

const severityOf = (v: PolicyViolation): "block" | "review" => v.severity ?? "block";

// --- the gate -------------------------------------------------------------
// A hard block beats a review request; a review request beats allow. So an action
// that both leaks PII (block) and is destructive (review) is BLOCKED, not queued.
export function evaluatePolicy(
  action: ProposedAction,
  rules: readonly PolicyRule[],
): PolicyDecision {
  const violations = rules
    .map((r) => r.evaluate(action))
    .filter((v): v is PolicyViolation => v !== null);
  const hasBlock = violations.some((v) => severityOf(v) === "block");
  const hasReview = violations.some((v) => severityOf(v) === "review");
  const decision: Decision = hasBlock ? "block" : hasReview ? "needs_approval" : "allow";
  return { decision, violations, evaluatedAt: new Date().toISOString() };
}

// --- example policy set (pre-action gating) -------------------------------

/** Default confidence an outbound send needs from at least one source. */
export const DEFAULT_SEND_THRESHOLD = 0.7;

/** Default share of the triad that must agree on the action (1.0 = unanimous). */
export const DEFAULT_CONSENSUS_THRESHOLD = 1.0;

/** Tunable knobs for {@link buildPolicy}; everything has a safe default. */
export interface PolicyConfig {
  /** Min provenance score (in [0,1]) an external send needs; default 0.7. */
  readonly externalSendThreshold?: number;
  /** Min agreement among the triad (in [0,1]) before acting; default 1.0 (unanimous). */
  readonly consensusThreshold?: number;
  /** Min distinct attested model instances behind a consensus; default 2. */
  readonly minDistinctVoices?: number;
}

/** Longest caller-supplied string (a kind, a token, a recipient) echoed into a violation. */
const MAX_ECHO_LENGTH = 64;

/** Bound a caller-supplied string before it is echoed into a violation's detail and trace. */
function clip(s: string): string {
  return s.length > MAX_ECHO_LENGTH ? `${s.slice(0, MAX_ECHO_LENGTH)}…` : s;
}

/**
 * A retrieval score counts as evidence only when it is a finite number in [0, 1] — the
 * range `Provenance.score` promises. NaN, ±Infinity or an out-of-range value (5.0) is
 * malformed, and malformed evidence never clears a threshold: unverifiable is not verified.
 */
export function isValidScore(score: unknown): score is number {
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1;
}

export const requireProvenance: PolicyRule = {
  name: "require-provenance",
  evaluate: (a) => {
    if (a.provenance.length === 0) {
      return { rule: "require-provenance", detail: "action has no supporting sources" };
    }
    return a.provenance.some((p) => isValidScore(p.score))
      ? null
      : {
          rule: "require-provenance",
          detail: "no supporting source carries a valid retrieval score in [0, 1]",
        };
  },
};

/**
 * Factory for the outbound-send rule with a configurable confidence threshold.
 * The threshold is the single knob the UI exposes: lower it below a source's
 * score and a previously-blocked send flips to allow — a real change in the gate,
 * not a cosmetic one.
 */
/**
 * Exactly one address: one "@", and no list separators or line breaks. "a@x, b@y" would send
 * to a second, unverified recipient, and a line break in a header value is header injection
 * ("a@x\nBcc: b@y") once a real mailer sits behind the executor.
 */
function isSingleAddress(to: string): boolean {
  return to.length > 0 && !/[,;\r\n]/u.test(to) && to.split("@").length === 2;
}

export function makeNoUnverifiedExternalSend(
  threshold: number = DEFAULT_SEND_THRESHOLD,
): PolicyRule {
  return {
    name: "no-unverified-external-send",
    evaluate: (a) => {
      if (a.kind !== "send_email") return null;
      // An outbound send must name exactly one recipient the gate can see. A missing,
      // blank or non-string `to` (an array, a recipient under another key) used to skip
      // the threshold entirely — fail closed instead of judging a send we can't read.
      const to = typeof a.payload.to === "string" ? a.payload.to.trim() : "";
      if (!isSingleAddress(to)) {
        return {
          rule: "no-unverified-external-send",
          detail: "outbound send has no single recipient address (payload.to) the gate can verify",
        };
      }
      const hasHighConfidenceSource = a.provenance.some(
        (p) => isValidScore(p.score) && p.score >= threshold,
      );
      return hasHighConfidenceSource
        ? null
        : {
            rule: "no-unverified-external-send",
            detail: `outbound to ${clip(to)} lacks a source scoring ≥ ${threshold.toFixed(2)}`,
          };
    },
  };
}

/** The outbound-send rule at the default threshold (kept for the frozen contract). */
export const noUnverifiedExternalSend: PolicyRule = makeNoUnverifiedExternalSend();

// PII detection. Still patterns and checksums, not a vetted detector (production should
// put a DLP / PII service behind this rule), but it covers the formats a financial-services
// email actually leaks: US and UK identifiers, international phones, and bank details.
// Ambiguous shapes are context-gated so routine numbers don't trip the gate: a bare
// 9-digit run is an SSN only when labelled, and a dd-dd-dd run is a sort code only when
// labelled or sitting next to an 8-digit account number (otherwise it is likely a date).

/** A pure test of one payload's text for one kind of personal data. */
type Detector = (text: string) => boolean;

interface PiiSignature {
  readonly label: string;
  readonly found: Detector;
}

/** True when any of the detectors fires. */
const anyOf =
  (...detectors: readonly Detector[]): Detector =>
  (text) =>
    detectors.some((d) => d(text));

/**
 * A regex detector, optionally confirmed per match (a digit-count or checksum test).
 * `matchAll` needs a global regex, so a pattern without `g` fails at module load (and in
 * `npm test`) rather than throwing on the first email that reaches the gate.
 */
function byPattern(re: RegExp, isGenuine?: (match: string) => boolean): Detector {
  if (!re.global) throw new Error(`PII pattern ${re} must carry the g flag`);
  return (text) => {
    for (const m of text.matchAll(re)) {
      if (isGenuine === undefined || isGenuine(m[0])) return true;
    }
    return false;
  };
}

/** ISO 13616: an IBAN is 15–34 characters — country (2) + check digits (2) + BBAN (11–30). */
const IBAN_MIN_LENGTH = 15;
const IBAN_MAX_LENGTH = 34;
/** Written grouped, an IBAN is 4-character groups with a 1–4 character tail. */
const IBAN_GROUP_LENGTH = 4;
/** A grouped IBAN spans at most ⌈34 / 4⌉ = 9 tokens. */
const IBAN_MAX_TOKENS = Math.ceil(IBAN_MAX_LENGTH / IBAN_GROUP_LENGTH);
/**
 * Every national BBAN carries a numeric account part (the shortest, Norway's, is 11 digits).
 * Requiring 8 BBAN digits keeps words that happen to follow a token like "FY26" or "EU27"
 * from ever forming a checksum candidate — mod-97 alone would pass 1 in 97 of them.
 */
const IBAN_MIN_BBAN_DIGITS = 8;
/** E.164 numbers carry at least 8 digits with country code; fewer is a short code or a score. */
const PHONE_MIN_DIGITS = 8;

/** ISO 7064 mod-97-10: a valid IBAN leaves remainder 1. */
const IBAN_MODULUS = 97;
const IBAN_VALID_REMAINDER = 1;
/** IBAN letters expand to two digits, A = 10 … Z = 35. */
const IBAN_LETTER_OFFSET = "A".charCodeAt(0) - 10;
/** Luhn: the digit sum, with every second digit from the right doubled, is a multiple of 10. */
const LUHN_MODULUS = 10;

const digitCount = (s: string): number => s.replace(/\D/gu, "").length;
const hasPhoneDigits = (match: string): boolean => digitCount(match) >= PHONE_MIN_DIGITS;

/** ISO 7064 mod-97-10: BBAN + country + check digits, letters as A = 10 … Z = 35, ≡ 1 (mod 97). */
function isValidIban(compact: string): boolean {
  const iban = compact.toUpperCase();
  if (iban.length < IBAN_MIN_LENGTH || iban.length > IBAN_MAX_LENGTH) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/u.test(iban)) return false;
  if (digitCount(iban.slice(4)) < IBAN_MIN_BBAN_DIGITS) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const expanded = /[A-Z]/u.test(ch) ? String(ch.charCodeAt(0) - IBAN_LETTER_OFFSET) : ch;
    // Fold digit by digit so the running value never exceeds safe-integer range.
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % IBAN_MODULUS;
  }
  return remainder === IBAN_VALID_REMAINDER;
}

/**
 * IBANs appear compact (`GB82WEST1234…`), grouped (`GB82 WEST 1234 …`, `GB82-WEST-…`) or
 * behind a label (`IBAN:GB82…`). Split on every non-alphanumeric run, then from each token
 * shaped like a country + check digits, extend through following group-sized tokens only
 * (a longer token ends the candidate) and checksum each prefix.
 */
function containsIban(text: string): boolean {
  const tokens = text.split(/[^A-Za-z0-9]+/u).filter((t) => t.length > 0);
  for (let i = 0; i < tokens.length; i++) {
    if (!/^[A-Za-z]{2}\d{2}/u.test(tokens[i] ?? "")) continue;
    let candidate = "";
    for (let j = i; j < tokens.length && j < i + IBAN_MAX_TOKENS; j++) {
      const token = tokens[j] ?? "";
      if (j > i && token.length > IBAN_GROUP_LENGTH) break;
      candidate += token;
      if (candidate.length > IBAN_MAX_LENGTH) break;
      if (isValidIban(candidate)) return true;
      // Only the final group of a grouped IBAN may be short; "XI11 6811 173 4802" is not one.
      if (j > i && token.length < IBAN_GROUP_LENGTH) break;
    }
  }
  return false;
}

/** Luhn check over the digits of a card-number candidate. */
function passesLuhn(match: string): boolean {
  const digits = match.replace(/\D/gu, "");
  let sum = 0;
  for (let k = 0; k < digits.length; k++) {
    let d = Number(digits[digits.length - 1 - k]);
    const doubled = k % 2 === 1; // every second digit, counting from the rightmost
    if (doubled) {
      d *= 2;
      if (d > 9) d -= 9; // the sum of the doubled digit's two digits
    }
    sum += d;
  }
  return sum % LUHN_MODULUS === 0;
}

// Ordered most-specific first: the first signature that fires names the violation, so a
// checksum-verified IBAN, a +-prefixed phone, or a labelled sort code / account is reported
// as itself, not as the card or SSN shape a run of its digits also happens to fit
// ("+353 86 1234" holds an SSN shape; "12-34-56 12345678" holds a 14-digit run). Every
// signature blocks, so the order decides only the label, never the decision.
const PII_SIGNATURES: readonly PiiSignature[] = [
  { label: "IBAN", found: containsIban },
  {
    label: "phone number",
    found: anyOf(
      // International with a leading +: +44 20 7946 0958 · +33 1 23 45 67 89 · +44 (0)20 …
      // No digit maximum: a greedy match that runs on into a following number still blocks.
      byPattern(/\+\d{1,3}(?:[ .-]?(?:\(0\)[ .-]?)?\d{1,4}){1,6}/gu, hasPhoneDigits),
      // The same with a 00 international prefix (0044 20 … · 00 44 20 …). The country code
      // cannot start with 0 and must be followed by a separator, so zero-padded ids
      // ("00123456", "0001-2345-6789") don't read as phones.
      byPattern(/\b00 ?[1-9]\d{0,2}(?:[ .-](?:\(0\)[ .-]?)?\d{1,4}){2,6}/gu, hasPhoneDigits),
      // UK mobile, national format: 07700 900123 · 07700 900 123 · 07700-900123 · 07700900123
      byPattern(/\b07\d{3}[ -]?\d{3}[ -]?\d{3}\b/gu),
      // UK geographic, national format: 020 7946 0958 · 0161 496 0000 · 01632 960123
      byPattern(/\b0[1-9]\d{1,3}[ -]\d{3,4}[ -]\d{4}\b/gu),
      byPattern(/\b0[1-9]\d{3}[ -]\d{6}\b/gu),
      // North American: 555-123-4567 · 555.123.4567 · 555 123 4567 · (555) 123-4567. A
      // spaced 3-3-4 run is ambiguous ("120 450 1000 units"); the gate fails closed on it.
      byPattern(/(?:\(\d{3}\)\s?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/gu),
    ),
  },
  {
    label: "UK sort code",
    found: anyOf(
      byPattern(/\bsort[\s-]*code\b[^\d]{0,12}\d{2}[- ]?\d{2}[- ]?\d{2}\b/giu), // labelled
      // Unlabelled dd-dd-dd only directly beside an 8-digit account number (punctuation
      // between them, no words) — "On 12-03-26 order 12345678" is a date and an order id.
      // "12345678 (12-03-26)" is indistinguishable from a real sort code + account and
      // blocks: a fail-closed trade-off, pinned in scripts/verify-policy.ts.
      byPattern(/\b\d{2}-\d{2}-\d{2}[^\dA-Za-z]{1,4}\d{8}\b/gu),
      byPattern(/\b\d{8}[^\dA-Za-z]{1,4}\d{2}-\d{2}-\d{2}\b/gu),
    ),
  },
  {
    label: "bank account number",
    // Labelled only ("account number is …", "Account ID: …", "acct #…", "A/C …",
    // "Account number - 1234 5678"); 6–17 digits spans UK (8) through the longest US numbers.
    found: byPattern(
      /\b(?:account|acct|a\/c)\b(?:\s*(?:number|num|no|id|is|#|:|\.|-)){0,4}\s*\d(?:[ -]?\d){5,16}\b/giu,
    ),
  },
  {
    label: "credit-card number",
    found: anyOf(
      // 15–16 digits (Amex, Visa/Mastercard) block on shape alone, as before.
      byPattern(/\b(?:\d[ -]?){15,16}\b/gu),
      // 13–14 and 17–19 digits (older Visa, Diners, Maestro) only written compact and passing
      // Luhn: with separators allowed they would join neighbouring numbers into a "card"
      // ("Ref 123454 2026-03-12").
      byPattern(/\b(?:\d{13,14}|\d{17,19})\b/gu, passesLuhn),
    ),
  },
  {
    label: "US Social Security number",
    found: anyOf(
      // 123-45-6789 · 123 45 6789. A spaced 3-2-4 run is ambiguous ("Room 123 45 6789");
      // the gate fails closed and treats the exact SSN shape as an SSN.
      byPattern(/\b\d{3}[- ]\d{2}[- ]\d{4}\b/gu),
      // A bare 9-digit run only when labelled — otherwise it is as likely an order id.
      byPattern(/\b(?:ssn|social\s+security(?:\s+(?:number|no))?)\b[^\d]{0,20}\d{9}\b/giu),
    ),
  },
];

/** Nested payload values are scanned down to this depth; anything deeper fails closed. */
const MAX_PAYLOAD_DEPTH = 6;
/** The most values (strings, numbers, keys, containers) one scan visits; more fails closed. */
const MAX_PAYLOAD_NODES = 10_000;
/**
 * The most text the PII scan reads from one payload. The live loop's bodies are bounded by
 * the model's output budget (well under this); anything larger fails closed rather than
 * stalling the synchronous gate or leaving a tail unscanned.
 */
export const MAX_SCANNED_CHARS = 100_000;
/** Joins the scanned values, so no two values can fuse into one number. */
export const SCAN_SEPARATOR = " \n ";

/** The payload's text for scanning, or why it can't be read in full (the rule then blocks). */
type PayloadScan =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Every string, number and object key in the payload, at any depth up to the limit. The
 * executor receives the whole payload (`JSON.stringify` in the loop), so the scan must see
 * all of it: a payload it can't read in full — nested too deep (a cycle ends here too), too
 * many values, too much text, or a getter that throws — is refused rather than half-scanned.
 */
function payloadText(payload: Readonly<Record<string, unknown>>): PayloadScan {
  const parts: string[] = [];
  let nodes = 0;
  let chars = 0;
  const add = (piece: string): string | undefined => {
    chars += piece.length + (parts.length > 0 ? SCAN_SEPARATOR.length : 0);
    parts.push(piece);
    return chars > MAX_SCANNED_CHARS ? `too large to scan (over ${MAX_SCANNED_CHARS} characters)` : undefined;
  };
  const visit = (value: unknown, depth: number): string | undefined => {
    if (++nodes > MAX_PAYLOAD_NODES) return `more than ${MAX_PAYLOAD_NODES} values`;
    if (typeof value === "string") return add(value);
    if (typeof value === "number" || typeof value === "bigint") return add(String(value));
    if (value === null || typeof value !== "object") return undefined;
    if (depth >= MAX_PAYLOAD_DEPTH) return `nested deeper than ${MAX_PAYLOAD_DEPTH} levels`;
    const entries = Array.isArray(value)
      ? value.map((v): readonly [string | undefined, unknown] => [undefined, v])
      : Object.entries(value);
    for (const [key, v] of entries) {
      const problem = (key !== undefined ? add(key) : undefined) ?? visit(v, depth + 1);
      if (problem !== undefined) return problem;
    }
    return undefined;
  };
  try {
    const problem = visit(payload, 0);
    return problem === undefined
      ? { ok: true, text: parts.join(SCAN_SEPARATOR) }
      : { ok: false, reason: problem };
  } catch {
    return { ok: false, reason: "a value could not be read" };
  }
}

/**
 * Characters that render as nothing: every format control (zero-width space and joiners,
 * bidi marks and embeddings, invisible operators, soft hyphen, BOM, tag characters),
 * variation selectors, the combining grapheme joiner, and the Hangul fillers.
 */
const INVISIBLE = /[\p{Cf}\p{Variation_Selector}\u034F\u115F\u1160\u3164\uFFA0]/gu;
/** Every dash punctuation mark, the minus sign and the hyphen bullet scan as "-". */
const DASH_LIKE = /[\p{Pd}\u2212\u2043]/gu;
/** Decimal digits outside ASCII (Arabic-Indic, Devanagari, …), which NFKC leaves alone. */
const NON_ASCII_DIGIT = /[^\P{Nd}0-9]/gu;
const DECIMAL_DIGIT = /^\p{Nd}$/u;
const asciiDigitCache = new Map<string, string>();

/** A decimal digit's value: Unicode lays digits out in runs of ten starting at zero. */
function toAsciiDigit(ch: string): string {
  const cached = asciiDigitCache.get(ch);
  if (cached !== undefined) return cached;
  const cp = ch.codePointAt(0) ?? 0;
  let below = 0;
  while (cp - below - 1 >= 0 && DECIMAL_DIGIT.test(String.fromCodePoint(cp - below - 1))) below++;
  const digit = String(below % 10);
  asciiDigitCache.set(ch, digit);
  return digit;
}

/**
 * Fold the look-alikes an obfuscated leak hides behind: NFKC maps full-width digits and
 * no-break spaces to ASCII, invisible characters are dropped, dashes become "-", and other
 * scripts' digits become ASCII — so "１２３–４５–６７８９", "123\u200E-45-6789" and
 * "१२३-४५-६७८९" all scan like "123-45-6789".
 */
function normalizeForScan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(DASH_LIKE, "-")
    .replace(NON_ASCII_DIGIT, toAsciiDigit);
}


/** Block outbound sends whose contents contain personal data. */
export const noPiiInExternalOutput: PolicyRule = {
  name: "no-pii-in-external-output",
  evaluate: (a) => {
    if (a.kind !== "send_email") return null;
    const scan = payloadText(a.payload);
    if (!scan.ok) {
      return {
        rule: "no-pii-in-external-output",
        detail: `outbound message can't be scanned in full for personal data: ${scan.reason}`,
        severity: "block",
      };
    }
    const text = normalizeForScan(scan.text);
    const hit = PII_SIGNATURES.find((s) => s.found(text));
    return hit
      ? {
          rule: "no-pii-in-external-output",
          detail: `outbound message appears to contain a ${hit.label}`,
          severity: "block",
        }
      : null;
  },
};

/** Action kinds that are irreversible and therefore gated behind human approval. */
export const DESTRUCTIVE_KINDS: ReadonlySet<string> = new Set([
  "delete_record",
  "purge",
  "overwrite",
]);

/**
 * Actions consequential enough to warrant adversarial (Red Cell) review: outbound
 * sends and irreversible/destructive kinds. Internal records are still gated by the
 * hard rules — provenance, PII, consensus, distinct voices — but running a
 * "never rubber-stamp" generative red team on every internal note manufactures
 * objections without protecting anything. Scrutiny escalates with the stakes.
 */
export function isConsequentialKind(kind: string): boolean {
  return kind === "send_email" || DESTRUCTIVE_KINDS.has(kind);
}

/**
 * Every action kind the gate knows how to judge. The kind-specific rules above are written
 * against these; a kind outside the set would slip past all of them, so it is blocked
 * instead of trusted (see {@link knownActionKind}).
 */
export const KNOWN_ACTION_KINDS: ReadonlySet<string> = new Set([
  "send_email",
  "write_record",
  ...DESTRUCTIVE_KINDS,
]);

/** Fail closed on action kinds the policy was never written for. */
export const knownActionKind: PolicyRule = {
  name: "known-action-kind",
  evaluate: (a) =>
    KNOWN_ACTION_KINDS.has(a.kind)
      ? null
      : {
          rule: "known-action-kind",
          detail: `"${clip(a.kind)}" is not a kind this policy knows how to judge — unknown kinds are blocked, not trusted`,
        },
};

/** Provenance `sourceId` prefix under which a retrieved approval record is filed. */
export const APPROVAL_SOURCE_PREFIX = "ticket:";

/** The payload's approval token, trimmed; undefined when absent, not a string, or blank. */
function approvalTokenOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  const token = payload.approvalToken;
  if (typeof token !== "string") return undefined;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The provenance `sourceId` an approval token's record is retrieved under. */
const approvalRecordId = (token: string): string => `${APPROVAL_SOURCE_PREFIX}${token}`;

/**
 * The retrieval score an approval record must reach to count. A ticket retrieved at score 0
 * is an irrelevant hit, not grounding. Set to the same 0.70 as the default send threshold,
 * but deliberately its own constant: moving the editable send knob must not move this bar.
 */
export const APPROVAL_MIN_SCORE = 0.7;

/**
 * An approval is honored only when it is grounded in retrieval: the action's token must
 * match an approval record (`ticket:<token>`) that the Researcher retrieved with a score of
 * at least {@link APPROVAL_MIN_SCORE}. Provenance comes from retrieval, never from the
 * model, so the proposer cannot approve its own action — a bare `approved: true`, an empty
 * token, or a token with no matching record all route to a human.
 *
 * What this does NOT check, by design (it is grounding, not a signature): the record's
 * wording (the ticket store is trusted to file only granted approvals under `ticket:`) and
 * which target the approval covers (one ticket could be cited by two deletions). A
 * production approval should be verified against the approvals system itself — the cosign
 * queue. In the live loop no retrieved source carries a `ticket:` id, so every destructive
 * action there routes to a human.
 */
function hasRetrievedApproval(a: ProposedAction, token: string): boolean {
  const record = approvalRecordId(token);
  return a.provenance.some(
    (p) => p.sourceId === record && isValidScore(p.score) && p.score >= APPROVAL_MIN_SCORE,
  );
}

/** Route destructive/irreversible actions to a human unless a retrieved approval backs them. */
export const destructiveNeedsApproval: PolicyRule = {
  name: "destructive-action-needs-approval",
  evaluate: (a) => {
    if (!DESTRUCTIVE_KINDS.has(a.kind)) return null;
    const token = approvalTokenOf(a.payload);
    if (token !== undefined && hasRetrievedApproval(a, token)) return null;
    return {
      rule: "destructive-action-needs-approval",
      detail:
        token === undefined
          ? `${a.kind} is irreversible and requires human approval before it runs`
          : `${a.kind} is irreversible; approval token "${clip(token)}" matches no retrieved approval record (${clip(approvalRecordId(token))}), so a human must approve it`,
      severity: "review",
    };
  },
};

function describeSplit(consensus: Consensus): string {
  const tally = consensus.votes
    .map((v) => `${v.model}: ${v.abstained ? "abstained" : v.kind}`)
    .join(", ");
  return tally;
}

/**
 * Require the triad of models to agree before acting. Only meaningful once at
 * least two models actually voted; below `threshold` agreement, the action is
 * routed to a human (needs_approval) rather than executed on a split decision.
 */
export function makeRequireModelConsensus(
  threshold: number = DEFAULT_CONSENSUS_THRESHOLD,
): PolicyRule {
  return {
    name: "require-model-consensus",
    evaluate: (a) => {
      const consensus = a.consensus;
      if (consensus === undefined) return null;
      const participating = consensus.votes.filter((v) => v.abstained !== true).length;
      if (participating < 2) return null; // need ≥2 models for a disagreement to mean anything
      return consensus.agreementRatio < threshold
        ? {
            rule: "require-model-consensus",
            detail: `models disagreed (${describeSplit(consensus)}) — ${Math.round(
              consensus.agreementRatio * 100,
            )}% agreement is below the ${Math.round(threshold * 100)}% required`,
            severity: "review",
          }
        : null;
    },
  };
}

// --- attested independence (§7-2): voices are counted, not assumed ----------

/** Default minimum number of distinct model instances that must back a consensus. */
export const DEFAULT_MIN_DISTINCT_VOICES = 2;

/** Stable identity key for a vote — attested voice when present, else the legacy label. */
function voiceKey(v: ModelVote): string {
  return v.voice ? `${v.voice.provider}::${v.voice.model}` : `label::${v.model}`;
}

/** Distinct voices among participating votes that backed `kind` (pure; legacy-tolerant). */
export function distinctVoicesFor(votes: readonly ModelVote[], kind: string): number {
  const keys = new Set<string>();
  for (const v of votes) {
    if (v.abstained !== true && v.kind === kind) keys.add(voiceKey(v));
  }
  return keys.size;
}

/**
 * The bloodhound law applied at the model layer: corroboration counts independent
 * VOICES, not the votes that echo them. A unanimous "consensus" whose agreeing votes
 * resolve to one attested instance is one voice echoed N times — it is routed to a
 * human, not honored. Within the default triad (anthropic/gemini/grok) this is an
 * invariant check; it bites when voter sets are user-configured or when a recorded
 * consensus is replayed through the policy.
 */
export function makeRequireDistinctVoices(
  minDistinctVoices: number = DEFAULT_MIN_DISTINCT_VOICES,
): PolicyRule {
  return {
    name: "require-distinct-voices",
    evaluate: (a) => {
      const consensus = a.consensus;
      if (consensus === undefined) return null;
      const participating = consensus.votes.filter((v) => v.abstained !== true).length;
      if (participating < 2) return null; // a single voter is not claiming corroboration
      const distinct =
        consensus.distinctVoices ?? distinctVoicesFor(consensus.votes, consensus.chosenKind);
      const agreeing = consensus.votes.filter(
        (v) => v.abstained !== true && v.kind === consensus.chosenKind,
      ).length;
      return distinct < minDistinctVoices
        ? {
            rule: "require-distinct-voices",
            detail: `${agreeing} agreeing vote(s) resolve to ${distinct} distinct model instance(s) — corroboration counts voices, not echoes (need ≥ ${minDistinctVoices})`,
            severity: "review",
          }
        : null;
    },
  };
}

/**
 * Oversight is theater unless the reviewer is provably not the generator. A Red Cell
 * verdict is honored only when the reviewing instance's attested voice differs from the
 * proposing instance's; an unattested generator can't prove independence, so it routes
 * to a human too — unverifiable is not verified.
 */
export const redCellMustBeIndependent: PolicyRule = {
  name: "red-cell-independence",
  evaluate: (a) => {
    if (a.redCell === undefined) return null;
    if (a.proposedBy === undefined) {
      return {
        rule: "red-cell-independence",
        detail:
          "red-cell verdict cannot be honored: the proposing model's identity is not attested",
        severity: "review",
      };
    }
    return sameVoice(a.redCell.voice, a.proposedBy)
      ? {
          rule: "red-cell-independence",
          detail: `oversight is theater — the red cell resolved to the proposing instance (${a.proposedBy.provider}/${a.proposedBy.model}); its verdict is not honored`,
          severity: "review",
        }
      : null;
  },
};

/** An adversarial objection routes the action to a human with the critique attached. */
export const redCellObjection: PolicyRule = {
  name: "red-cell-objection",
  evaluate: (a) => {
    if (a.redCell === undefined || a.redCell.verdict !== "object") return null;
    const critique =
      a.redCell.critique.length > 220 ? `${a.redCell.critique.slice(0, 220)}…` : a.redCell.critique;
    return {
      rule: "red-cell-objection",
      detail: `the red cell (${a.redCell.voice.provider}/${a.redCell.voice.model}) objects: ${critique}`,
      severity: "review",
    };
  },
};

/** Assemble the active policy from a config; rule order is stable. */
export function buildPolicy(config: PolicyConfig = {}): readonly PolicyRule[] {
  return [
    knownActionKind,
    requireProvenance,
    makeNoUnverifiedExternalSend(config.externalSendThreshold),
    noPiiInExternalOutput,
    destructiveNeedsApproval,
    makeRequireModelConsensus(config.consensusThreshold),
    makeRequireDistinctVoices(config.minDistinctVoices),
    redCellMustBeIndependent,
    redCellObjection,
  ];
}

export const defaultPolicy: readonly PolicyRule[] = buildPolicy();
