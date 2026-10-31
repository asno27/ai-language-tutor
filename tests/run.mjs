// tests/run.mjs - 브라우저·네트워크 없이 돌리는 빠른 점검 (실행: node tests/run.mjs)
// 데이터 파일(학습지·코스·단어 레벨)의 형식과, 순수 계산 코드(발음 비교 · 단어 레벨)를 확인합니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, '');
const json = (p) => JSON.parse(read(p));

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) passed++; else failures.push(`${name}${detail ? ' — ' + detail : ''}`);
}

// --- 학습지 데이터
const worksheets = json('data/worksheet.json');
const LICENSES = new Set(['public-domain', 'cc0', 'cc-by', 'original', 'unverified']);
const wsIds = new Set();
worksheets.forEach((w, i) => {
  const name = `학습지[${i}] ${w.title}`;
  check(`${name}: 제목`, typeof w.title === 'string' && w.title);
  check(`${name}: 영상 또는 음성`, !!(w.youtubeUrl || w.audioUrl));
  if (w.audioUrl) check(`${name}: audioUrl은 https`, /^https:\/\//.test(w.audioUrl));
  check(`${name}: 라이선스 값`, LICENSES.has(w.license), String(w.license));
  check(`${name}: 출처`, !!w.source);
  check(`${name}: 쉐도잉 문단`, typeof w.shadowing?.text === 'string' && w.shadowing.text.split(' ').length >= 8);
  check(`${name}: 받아쓰기 3개 이상`, Array.isArray(w.dictation) && w.dictation.length >= 3);
  for (const d of w.dictation || []) {
    const blanks = (d.sentence.match(/\{[^{}]+\}/g) || []).length;
    check(`${name}: 빈칸 수=힌트 수 (${d.sentence.slice(0, 30)})`, blanks > 0 && blanks === (d.hints || []).length);
  }
  const id = w.id || `week-${w.week}`;
  check(`${name}: 중복 없음`, !wsIds.has(id), id);
  wsIds.add(id);
});

// --- 코스 데이터: 단계 id 유일, 연결 주제가 실제로 있는지
const prompts = read('js/prompts.js');
const idsIn = (name) => {
  const a = prompts.indexOf(`export const ${name}`);
  const b = prompts.indexOf('];', a);
  return new Set([...prompts.slice(a, b).matchAll(/\{ id: '([a-z]+)'/g)].map(m => m[1]));
};
const valid = { grammar: idsIn('GRAMMAR_TOPICS'), roleplay: idsIn('ROLEPLAY_SCENARIOS'), examples: idsIn('EXAMPLE_TOPICS') };
const STEP_TYPES = new Set(['grammar', 'roleplay', 'examples', 'daily', 'review', 'writing', 'mistakes']);
const course = json('data/course.json');
const stepIds = new Set();
for (const [level, units] of Object.entries(course)) {
  check(`코스 ${level}: 단원 있음`, units.length > 0);
  for (const u of units) {
    check(`코스 ${u.id}: 단계 있음`, u.steps?.length > 0);
    for (const s of u.steps) {
      check(`코스 단계 ${s.id}: 중복 없음`, !stepIds.has(s.id));
      stepIds.add(s.id);
      check(`코스 단계 ${s.id}: 종류`, STEP_TYPES.has(s.type), s.type);
      if (valid[s.type]) check(`코스 단계 ${s.id}: 연결 주제 ${s.ref}`, valid[s.type].has(s.ref));
    }
  }
}

// --- 동음이의어 발음 비교
const { compareWords } = await import(pathToFileURL(path.join(root, 'js/shadowing.js')).href);
const status = (target, heard) => compareWords(target, heard).words.map(w => w.status).join(',');
check('발음: 같은 문장은 100점', compareWords('It is a nice day', 'it is a nice day').score === 100);
check('발음: weather/whether 인정', compareWords('The weather is nice', 'the whether is nice').score === 100);
check('발음: to/two 인정(숫자 변환 포함)', compareWords('I want to go', 'I want two go').score === 100);
check('발음: ship/sheep은 틀림', status('The ship is big', 'The sheep is big').includes('wrong'));
check('발음: cat/cut은 틀림', status('I have a cat', 'I have a cut').includes('wrong'));
check('발음: 빠진 단어', status('I like green tea', 'I like tea').includes('missed'));

// --- 단어 레벨
const cefrData = json('data/cefr.json');
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class {};
globalThis.fetch = async () => ({ json: async () => cefrData });
const cefr = await import(pathToFileURL(path.join(root, 'js/cefr.js')).href);
await cefr.loadCefr();
check('레벨: 목록 크기', Object.keys(cefrData.levels).length > 8000);
check('레벨: abandon = B1', cefr.cefrLevel('abandon')?.level === 'B1');
check('레벨: 변화형 studies → 원형', cefr.cefrLevel('studies')?.exact === false);
check('레벨: 없는 단어는 null', cefr.cefrLevel('xyzzy') === null);
check('레벨: 배지 HTML', /cefr-badge/.test(cefr.cefrBadgeHtml('abandon')) && cefr.cefrBadgeHtml('xyzzy') === '');

// --- 앱 설치 파일
const manifest = json('manifest.webmanifest');
check('manifest: 아이콘 파일 존재', manifest.icons.every(i => fs.existsSync(path.join(root, i.src))));

console.log(`통과 ${passed}개, 실패 ${failures.length}개`);
if (failures.length) { console.log('\n실패:\n- ' + failures.join('\n- ')); process.exit(1); }
