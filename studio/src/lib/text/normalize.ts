// =============================================================================
// Text normalisation helpers (pure functions, safe for client and server)
// =============================================================================

/**
 * Pictographic emoji, dingbats, arrows, variation selectors, joiners, keycaps
 * and regional indicators. Accented Latin letters and currency signs are kept.
 */
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]/gu;
/** Invisible emoji glue: variation selectors, zero width joiner, keycap, skin tones. */
const EMOJI_GLUE_RE = /\u{FE0F}|\u{FE0E}|\u{200D}|\u{20E3}|[\u{1F3FB}-\u{1F3FF}]/gu;

export function stripEmoji(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(EMOJI_GLUE_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

export function countEmoji(text: string): number {
  return (text.match(EMOJI_RE) ?? []).length;
}

/** Lowercase, strip accents and typographic quotes. */
export function fold(text: string): string {
  return text
    .replace(/[\u2018\u2019\u00b4`]/g, "'")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function slugify(text: string, maxLength = 70): string {
  const slug = fold(text)
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  return cut.slice(0, cut.lastIndexOf("-") > 20 ? cut.lastIndexOf("-") : maxLength).replace(/-+$/g, "");
}

export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// =============================================================================
// Titles
// =============================================================================

const SMALL_WORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "com",
  "sem",
  "para",
  "em",
  "a",
  "o",
  "ao",
  "na",
  "no",
]);

/** Title-case in Portuguese, keeping units (360ml, 30g), acronyms and brand casing. */
export function titleCasePt(text: string): string {
  return text
    .split(" ")
    .map((word, i) => {
      if (!word) return word;
      if (/\d/.test(word))
        return word
          .toLowerCase()
          .replace(/^(\d+(?:[.,]\d+)?)(ml|l|g|kg|cm|mm|un)$/i, (_, n, u) => `${n}${u.toLowerCase()}`);
      if (word.length > 1 && word.length <= 4 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word; // USB, LED
      if (/[a-z][A-Z]/.test(word)) return word; // ChocoPie, O'Star already mixed case
      if (/[-'\u2019]/.test(word.slice(1))) {
        // chum-churum -> Chum-Churum, o'star -> O'Star
        return word
          .split(/([-'\u2019])/)
          .map((part, j) => (j % 2 === 1 ? part : capitalize(part)))
          .join("");
      }
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return capitalize(lower);
    })
    .join(" ");
}

function capitalize(word: string): string {
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export type TitleRules = { storeName: string; maxChars: number };

/**
 * Enforce catalogue title rules. Returns the fixed title and a list of
 * human-readable adjustments (shown to the operator for transparency).
 */
export function enforceTitleRules(raw: string, rules: TitleRules): { title: string; adjustments: string[] } {
  const adjustments: string[] = [];
  let title = raw;

  const noEmoji = stripEmoji(title);
  if (noEmoji !== title.trim()) adjustments.push("Emojis removidos do título");
  title = noEmoji;

  if (/[|•·]/.test(title)) {
    title = title.split(/\s*[|•·]\s*/)[0] ?? title;
    adjustments.push("Separadores '|' e listas de palavras-chave removidos");
  }

  const storeRe = new RegExp(`\\b(${escapeRegExp(rules.storeName)}|mimos korea|mimos|mkd)\\b`, "gi");
  if (storeRe.test(title)) {
    title = title.replace(storeRe, " ");
    adjustments.push("Nome da loja removido do título");
  }

  const stuffing = /,\s*(koreia|korea|coreia|kpop|k-pop|importado|original|promo[cç][aã]o|oferta)\b.*$/i;
  if (stuffing.test(title)) {
    title = title.replace(stuffing, "");
    adjustments.push("Palavras-chave repetidas no fim do título removidas");
  }

  title = collapseSpaces(title.replace(/\s+([,.;:])/g, "$1").replace(/[,;:\-\u2013]+$/g, ""));
  const cased = titleCasePt(title);
  if (cased !== title) title = cased;

  if (title.length > rules.maxChars) {
    const words = title.split(" ");
    while (words.length > 3 && words.join(" ").length > rules.maxChars) words.pop();
    title = words.join(" ");
    adjustments.push(`Título encurtado para até ${rules.maxChars} caracteres`);
  }
  return { title, adjustments };
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// Barcodes
// =============================================================================

/** Validate EAN-8, UPC-A (12), EAN-13 and GTIN-14 check digits. */
export function isValidGtin(code: string | null | undefined): boolean {
  if (!code) return false;
  const digits = code.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length) || digits.length !== code.trim().length) return false;
  const body = digits.slice(0, -1).split("").map(Number);
  const check = Number(digits.at(-1));
  const sum = body.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// =============================================================================
// Numbers in Brazilian format
// =============================================================================

export function formatBrl(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}
