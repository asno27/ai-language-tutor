export class SpeechManager {
  constructor() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.isSupported = !!SpeechRecognition;
    this.isListening = false;
    this.recognition = null;
    this.onResult = null;
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;
    
    if (this.isSupported) {
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'en-US';
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
      this.recognition.continuous = true;
      this.accumulatedText = '';
      
      this.recognition.onresult = (event) => {
        let interimText = '';
        let finalText = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalText += event.results[i][0].transcript;
          } else {
            interimText += event.results[i][0].transcript;
          }
        }
        
        if (finalText) {
          this.accumulatedText += finalText + ' ';
        }
        
        // UI 업데이트를 위해 onInterim 콜백 호출
        this.onInterim?.(this.accumulatedText + interimText);
      };
      
      this.recognition.onstart = () => {
        this.isListening = true;
        this.accumulatedText = ''; // 녹음 시작 시 초기화
        this.onStart?.();
      };
      
      this.recognition.onend = () => {
        this.isListening = false;
        // 녹음이 완전히 끝났을 때 최종 결과 전송
        if (this.accumulatedText.trim()) {
          this.onResult?.(this.accumulatedText.trim());
        } else {
          this.onError?.('no-speech');
        }
        this.onEnd?.();
      };
      
      this.recognition.onerror = (event) => {
        this.isListening = false;
        // no-speech 에러는 continuous 모드에서 종종 발생하므로 무시하거나 별도 처리 가능
        if (event.error === 'no-speech' && this.accumulatedText.trim()) {
          // 이미 누적된 텍스트가 있다면 에러를 무시하고 onend로 넘김
          return;
        }
        this.onError?.(event.error);
      };
    }
  }
  
  start() {
    if (!this.isSupported) { this.onError?.('not-supported'); return; }
    if (this.isListening) { this.stop(); return; }
    try { this.recognition.start(); } catch (e) { this.onError?.(e.message); }
  }
  
  stop() {
    if (this.recognition && this.isListening) this.recognition.stop();
  }
}

/**
 * TTS(텍스트 음성 변환) - 브라우저 내장 SpeechSynthesis API 사용
 * @param {string} text - 읽을 텍스트
 * @param {string} lang - 언어 코드 ('en-US' 또는 'ko-KR')
 */
export function speak(text, lang = 'en-US') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.85; // 학습용으로 약간 느리게
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}
