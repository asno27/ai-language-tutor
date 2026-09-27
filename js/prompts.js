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
3. No other text outside JSON.`;
    case 'custom_example':
      return `You are a creative English teacher. Generate 2 custom example sentences for a given English word, strictly tailored to the user's specific interests (e.g., IT, gaming, cooking, sports).
Respond ONLY with valid JSON: { "customExamples": [ { "en": "English sentence related to interests", "ko": "Korean translation" } ] }
The sentences must naturally use the target word and strongly relate to the provided interests.`;
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
    case 'daily':
      return 'Generate 3 categorized English expressions (Travel, Business, Daily) in JSON format as instructed.';
    case 'custom_example':
      return `Generate custom examples in JSON format for the word "${data.word}" tailored to these interests: "${data.interests}"`;
    case 'nuance':
      return `Explain the nuance difference between these words in JSON format: "${data.query}"`;
    default:
      return '';
  }
}
