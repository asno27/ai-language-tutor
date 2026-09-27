// js/shadowing.js - 발음(쉐도잉) 단어 단위 비교 (Phase 2.3)
// 원문과 음성 인식 결과를 단어 단위 Levenshtein 정렬로 맞춰서
// 각 원문 단어가 정확 / 비슷함 / 틀림 / 빠짐 중 무엇인지 판정합니다. 외부 API 없이 브라우저에서만 동작합니다.

const NUMBER_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
};

/** 비교용 정규화: 소문자, 둥근 따옴표 통일, 앞뒤 문장부호 제거, 숫자 단어 → 숫자 */
function stripWord(word) {
  return word.toLowerCase().replace(/[’‘]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function normalizeWord(word) {
  const w = stripWord(word);
  return NUMBER_WORDS[w] || w;
}

function charDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 철자가 거의 같은 단어 (예: team/teams, color/colour) — 끝소리 등을 약하게 발음했을 가능성 */
function isClose(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) < 3) return false;
  return 1 - charDistance(a, b) / maxLen >= 0.75;
}

/**
 * @returns {{ words: {text, status: 'correct'|'close'|'wrong'|'missed', heard?: string}[], extra: string[], score: number }}
 */
export function compareWords(target, recognized) {
  // 원문은 화면 표시용 토큰을 유지하고, 비교는 정규화한 값으로
  const display = target.trim().split(/\s+/).filter(Boolean).map(text => ({ text, norm: normalizeWord(text) }));
  const tokens = display.filter(t => t.norm);
  const heard = recognized.trim().split(/\s+/).filter(Boolean).map(text => ({ text, norm: normalizeWord(text) })).filter(t => t.norm);

  // 음성 인식이 한 단어를 둘로 쪼갠 경우 합치기 (예: "to day" → "today", "some one" → "someone")
  const targetNorms = new Set(tokens.map(t => t.norm));
  for (let k = 0; k < heard.length - 1; k++) {
    const joined = stripWord(heard[k].text) + stripWord(heard[k + 1].text); // 숫자 변환 전 글자로 합침 (some + one)
    if (targetNorms.has(joined) && !(targetNorms.has(heard[k].norm) && targetNorms.has(heard[k + 1].norm))) {
      heard.splice(k, 2, { text: `${heard[k].text} ${heard[k + 1].text}`, norm: joined });
    }
  }

  const n = tokens.length;
  const m = heard.length;
  const subCost = (i, j) => tokens[i].norm === heard[j].norm ? 0 : isClose(tokens[i].norm, heard[j].norm) ? 0.5 : 1;

  // dp[i][j] = 원문 앞 i단어와 인식 결과 앞 j단어를 맞추는 최소 비용
  const dp = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + subCost(i - 1, j - 1));
    }
  }

  // 역추적
  const extra = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + subCost(i - 1, j - 1)) {
      const cost = subCost(i - 1, j - 1);
      tokens[i - 1].status = cost === 0 ? 'correct' : cost === 0.5 ? 'close' : 'wrong';
      if (cost > 0) tokens[i - 1].heard = heard[j - 1].text;
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      tokens[i - 1].status = 'missed';
      i--;
    } else {
      extra.unshift(heard[j - 1].text);
      j--;
    }
  }

  const correct = tokens.filter(t => t.status === 'correct').length;
  const close = tokens.filter(t => t.status === 'close').length;
  // 원문에 없는 말을 많이 덧붙인 경우도 조금 감점
  const raw = n ? (correct + close * 0.5) / (n + extra.length * 0.5) : 0;

  return {
    words: display.map(t => ({ text: t.text, status: t.norm ? t.status : 'correct', heard: t.heard })),
    extra,
    score: Math.round(raw * 100),
  };
}
