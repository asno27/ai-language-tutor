export function getSystemPrompt(mode) {
  switch (mode) {
    case 'writing':
      return `You are a friendly, expert English language tutor helping Korean speakers improve their English writing. Analyze the user's English sentence and provide corrections.\nRespond ONLY with valid JSON: { "corrected": "...", "feedback": "...(Korean)", "suggestion": "...", "isCorrect": boolean }\nAlways explain in Korean (존댓말). Be encouraging.`;
    case 'translation':
      return `You are a professional translator. Detect language and translate ko↔en.\nRespond ONLY with valid JSON: { "translated": "...", "sourceLanguage": "ko"|"en", "note": "...(반드시 한국어로 작성)" }\nIMPORTANT: The "note" field MUST be written entirely in Korean (한국어). Explain nuances, cultural context, or key vocabulary in Korean using 존댓말. Never write the note in English or any other language.`;
    case 'dictionary':
      return `You are an English-Korean (영한) dictionary for Korean speakers. Provide comprehensive word info.\nRespond ONLY with valid JSON: { "word": "...", "phonetic": "IPA notation", "meanings": [{"partOfSpeech": "명사", "definitions": ["한국어 뜻 1", "한국어 뜻 2"]}], "examples": [{"en": "English example", "ko": "한국어 해석"}] }\nCRITICAL RULES:\n1. ALL definitions MUST be in Korean (한국어). Example: "우연한 행운", "뜻밖의 발견"\n2. partOfSpeech MUST be in Korean: 명사, 동사, 형용사, 부사, 전치사, 접속사, 감탄사\n3. Example sentences: "en" in English, "ko" in Korean\n4. NEVER use Chinese (中文) or Japanese (日本語). Use ONLY Korean (한국어).\n5. Provide at least 2 example sentences.`;
    case 'pronunciation':
      return `You are a pronunciation coach for Korean English learners. Compare target vs STT result.\nRespond ONLY with valid JSON: { "recognized": "...", "problematicWords": [...], "tips": "...(Korean)", "overallComment": "...(Korean)", "score": number }`;
    case 'daily':
      return `You generate 3 distinct English expressions for Korean learners.
Categories MUST be: 1) "여행/식당" (Travel/Restaurant), 2) "비즈니스" (Business), 3) "일상" (Daily Life).
Respond ONLY with valid JSON exactly matching this structure:
{
  "themes": [
    {
      "name": "여행/식당",
      "sentence": "English sentence...",
      "translation": "Korean translation...",
      "words": [{"word": "vocab", "meaning": "meaning in korean"}]
    },
    ...
  ]
}
Rules:
1. Sentences should be highly practical and natural.
2. Words array should contain 2-3 key vocabulary or idioms used in the sentence.
3. No other text outside JSON.
4. Each sentence MUST fit the specific scene given for its category in the user message.
5. Avoid overused textbook idioms and clichés (e.g. "under the weather", "touch base", "piece of cake", "break the ice", "call it a day", "on the same page", "circle back", "hit the sack"). Prefer expressions native speakers actually use in that concrete situation that intermediate learners probably don't know yet.
6. NEVER repeat or closely paraphrase any sentence in the "previously shown" list.`;
    case 'custom_example':
      return `You are a creative English teacher. Generate 2 custom example sentences for a given English word, strictly tailored to the user's specific interests (e.g., IT, gaming, cooking, sports).
Respond ONLY with valid JSON: { "customExamples": [ { "en": "English sentence related to interests", "ko": "Korean translation" } ] }
The sentences must naturally use the target word and strongly relate to the provided interests.`;
    case 'roleplay':
      return `You are a role-play conversation partner for a Korean learner practicing spoken English.
Stay in character for the scenario and role given in the user message. Keep each reply to 1-3 short, natural spoken sentences that match the learner level, and end with something the learner can respond to (a question or a clear prompt) unless the scene has naturally concluded.
Evaluate ONLY the learner's latest message, never your own lines.
Respond ONLY with valid JSON:
{
  "reply": "your next line in character, in English",
  "replyKo": "Korean translation of reply",
  "feedback": null or { "corrected": "the most natural way a native speaker would say the learner's message in this situation", "isNatural": boolean, "comment": "short explanation in Korean (존댓말) of what to fix and why; empty string if already natural", "score": number 0-100 },
  "suggestions": ["2 short example responses the learner could say next, in English, matching the level"],
  "ended": boolean
}
Rules:
1. feedback is null when there is no learner message yet (you are opening the scene).
2. If the learner writes in Korean, treat it as "how do I say this in English": put the natural English in feedback.corrected, explain in comment, set score 0, and reply in character as if they had said it.
3. Judge naturalness for spoken conversation, not formal writing. Minor punctuation or capitalization issues do not lower the score.
4. Set ended to true only when the scene is clearly finished (e.g. order complete and goodbye said).
5. No other text outside JSON.`;
    case 'nuance':
      return `You are an expert English linguist. Explain the nuanced differences between confusing English words or expressions for Korean learners.
Respond ONLY with valid JSON: 
{
  "explanation": "Clear, concise explanation of the core difference in Korean (존댓말).",
  "words": [
    {
      "word": "The specific word/phrase",
      "nuance": "Specific nuance of this word in Korean",
      "examples": [
        { "en": "Example sentence 1", "ko": "Korean translation" },
        { "en": "Example sentence 2", "ko": "Korean translation" }
      ]
    }
  ]
}`;
    default:
      return '';
  }
}

export function getUserPrompt(mode, data) {
  switch (mode) {
    case 'writing':
      return `Please process this text and return the result in JSON format: ${data.text}`;
    case 'translation':
      return `Translate the following text and return the result in JSON format: ${data.text}`;
    case 'dictionary':
      return `Look up the following word and return the result in JSON format: ${data.word}`;
    case 'pronunciation':
      return `Evaluate this pronunciation and return the result in JSON format. Target: ${data.target}\nRecognized: ${data.recognized}`;
    case 'daily': {
      const scenes = data.scenes || {};
      let prompt = 'Generate 3 categorized English expressions (Travel, Business, Daily) in JSON format as instructed.';
      if (scenes.travel) prompt += `\nScenes (one sentence per category):\n- 여행/식당: ${scenes.travel}\n- 비즈니스: ${scenes.business}\n- 일상: ${scenes.daily}`;
      if (data.avoid?.length) prompt += `\nPreviously shown (do NOT repeat or closely paraphrase):\n${data.avoid.map(s => `- ${s}`).join('\n')}`;
      return prompt;
    }
    case 'custom_example':
      return `Generate custom examples in JSON format for the word "${data.word}" tailored to these interests: "${data.interests}"`;
    case 'roleplay': {
      const lines = (data.history || []).map(m => `${m.role === 'ai' ? 'You' : 'Learner'}: ${m.text}`).join('\n');
      let prompt = `Scenario: ${data.scenario}\nYour role: ${data.aiRole}\nLearner's role: ${data.userRole}\nLearner level: ${ROLEPLAY_LEVELS[data.level] || ROLEPLAY_LEVELS.intermediate}`;
      prompt += lines ? `\n\nConversation so far:\n${lines}` : '';
      prompt += data.message
        ? `\n\nLearner's latest message: "${data.message}"\nRespond in JSON as instructed.`
        : '\n\nThe conversation has not started. Open the scene with your first line in character. Respond in JSON as instructed.';
      return prompt;
    }
    case 'nuance':
      return `Explain the nuance difference between these words in JSON format: "${data.query}"`;
    default:
      return '';
  }
}

// 오늘의 영어 추천: 매번 구체적인 상황을 무작위로 골라 같은 문장이 반복되지 않게 함
const DAILY_SCENES = {
  travel: [
    'checking in at a hotel and the room is not ready yet', 'asking a waiter to recommend a local dish',
    'customizing a coffee order', 'splitting the bill with friends at a restaurant', 'lost luggage at the airport',
    'missing a connecting flight', 'asking about ingredients because of an allergy', 'complaining politely about a noisy hotel room',
    'buying train tickets at a station', 'renting a car and asking about insurance', 'asking a stranger to take a photo',
    'getting a table without a reservation', 'asking for the check and paying separately', 'going through airport security',
    'asking for directions to a hidden local spot', 'sending food back because it is undercooked', 'requesting a late check-out',
    'ordering takeaway at a food truck', 'asking about the Wi-Fi and breakfast hours', 'bargaining at a street market',
  ],
  business: [
    'asking to push back a deadline', "giving feedback on a colleague's draft", 'politely declining an extra task',
    'following up on an unanswered email', 'kicking off a video call when someone is late', 'handling a client complaint',
    'asking for clarification in a meeting', 'onboarding a new team member', 'presenting a chart with bad numbers',
    'negotiating the scope of a project', 'writing a polite Slack message to a manager', 'wrapping up a meeting with action items',
    'disagreeing respectfully with a senior colleague', 'asking for a day off', 'reporting a bug to another team',
    'thanking a coworker for covering for you', 'rescheduling a call across time zones', 'asking about next steps after an interview',
    'explaining a delay to a client', 'summarizing a long email thread',
  ],
  daily: [
    'texting a friend that you are running late', 'asking a neighbor to keep the noise down', 'returning an item at a store',
    'recommending a TV series to a friend', "making a doctor's appointment by phone", 'telling a barber how you want your hair cut',
    'asking a landlord to fix something', 'chatting with someone at the gym', 'borrowing something from a roommate',
    'canceling plans at the last minute', "complimenting someone's cooking", 'talking about weekend plans with a coworker',
    'asking for help carrying groceries', 'venting about a stressful day', 'calling customer service about an internet outage',
    'walking a dog and meeting another dog owner', 'inviting a friend to a birthday dinner', 'apologizing for forgetting something',
    'asking a pharmacist for advice', 'talking about a new hobby',
  ],
};

export function pickDailyScenes() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return { travel: pick(DAILY_SCENES.travel), business: pick(DAILY_SCENES.business), daily: pick(DAILY_SCENES.daily) };
}

// 역할극: 상황 프리셋과 난이도별 규칙
export const ROLEPLAY_SCENARIOS = [
  { id: 'cafe', label: '☕ 카페 주문', scenario: 'Ordering drinks at a busy coffee shop', aiRole: 'a friendly barista', userRole: 'a customer' },
  { id: 'immigration', label: '🛂 공항 입국심사', scenario: 'Immigration check at a US airport', aiRole: 'an immigration officer', userRole: 'a traveler arriving for a short trip' },
  { id: 'hotel', label: '🏨 호텔 체크인', scenario: 'Checking in at a hotel; there is a small problem with the reservation', aiRole: 'a hotel front desk clerk', userRole: 'a guest' },
  { id: 'restaurant', label: '🍽️ 식당 주문', scenario: 'Dinner at a casual American restaurant', aiRole: 'a server', userRole: 'a diner' },
  { id: 'clinic', label: '🏥 병원 진료', scenario: 'Visiting a walk-in clinic with a bad cold', aiRole: 'a clinic receptionist, then the doctor', userRole: 'a patient' },
  { id: 'interview', label: '💼 영어 면접', scenario: 'Job interview for a position at a software company', aiRole: 'a hiring manager', userRole: 'a job candidate' },
  { id: 'refund', label: '🛍️ 환불 요청', scenario: 'Returning a defective item at an electronics store', aiRole: 'a store clerk', userRole: 'a customer' },
  { id: 'custom', label: '✏️ 직접 입력', scenario: '', aiRole: 'the most natural conversation partner for this situation', userRole: 'the learner' },
];

const ROLEPLAY_LEVELS = {
  basic: 'Beginner (CEFR A1-A2): very short simple sentences (under 8 words), present and simple past tense, common words only. Speak slowly and clearly.',
  intermediate: 'Intermediate (CEFR B1-B2): everyday conversational English with some linking words and common phrasal verbs, 10-18 words per sentence.',
  advanced: 'Advanced (CEFR C1-C2): natural native-speed English with idioms, nuance and realistic small talk.',
};
