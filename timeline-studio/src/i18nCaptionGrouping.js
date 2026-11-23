const rows = {
  zh: ["字幕分段", "短句", "逐词", "按语音时间生成短句或逐词字幕", "未能获取词级时间，请重试自动字幕。现有字幕未更改。"],
  en: ["Caption grouping", "Short phrases", "Word by word", "Create short phrases or word-by-word captions timed to speech", "Word timing is unavailable. Retry automatic captions. Existing captions are unchanged."],
  ja: ["字幕の区切り", "短いフレーズ", "単語ごと", "音声に合わせて短いフレーズまたは単語ごとの字幕を作成", "単語の時刻を取得できません。自動字幕を再試行してください。既存の字幕は変更されていません。"],
  ko: ["자막 분할", "짧은 구절", "단어별", "음성에 맞춰 짧은 구절 또는 단어별 자막 생성", "단어별 시간을 가져올 수 없습니다. 자동 자막을 다시 시도하세요. 기존 자막은 변경되지 않았습니다."],
  es: ["División de subtítulos", "Frases cortas", "Palabra por palabra", "Crea frases cortas o subtítulos por palabra sincronizados con la voz", "No se pudo obtener el tiempo de cada palabra. Reintenta los subtítulos automáticos. Los existentes no han cambiado."],
  fr: ["Découpage des sous-titres", "Phrases courtes", "Mot par mot", "Créez des phrases courtes ou des sous-titres mot par mot synchronisés avec la voix", "Le minutage des mots est indisponible. Réessayez les sous-titres automatiques. Les sous-titres existants sont inchangés."],
  de: ["Untertitelaufteilung", "Kurze Phrasen", "Wort für Wort", "Kurze Phrasen oder einzelne Wörter passend zur Sprache erstellen", "Wortzeitpunkte sind nicht verfügbar. Automatische Untertitel erneut versuchen. Bestehende Untertitel bleiben unverändert."],
  pt: ["Divisão de legendas", "Frases curtas", "Palavra por palavra", "Crie frases curtas ou legendas por palavra sincronizadas com a fala", "Os tempos das palavras não estão disponíveis. Tente as legendas automáticas novamente. As existentes não foram alteradas."],
  th: ["การแบ่งคำบรรยาย", "วลีสั้น", "ทีละคำ", "สร้างคำบรรยายเป็นวลีสั้นหรือทีละคำให้ตรงกับเสียงพูด", "ไม่สามารถรับเวลารายคำได้ โปรดลองสร้างคำบรรยายอัตโนมัติอีกครั้ง คำบรรยายเดิมไม่เปลี่ยนแปลง"],
  vi: ["Chia phụ đề", "Cụm từ ngắn", "Từng từ", "Tạo phụ đề theo cụm từ ngắn hoặc từng từ khớp với lời nói", "Không lấy được thời gian từng từ. Hãy thử lại phụ đề tự động. Phụ đề hiện có không thay đổi."],
  ru: ["Разбиение субтитров", "Короткие фразы", "По словам", "Короткие фразы или отдельные слова в такт речи", "Не удалось получить время слов. Повторите создание автоматических субтитров. Существующие субтитры не изменены."],
  it: ["Suddivisione sottotitoli", "Frasi brevi", "Parola per parola", "Crea frasi brevi o sottotitoli parola per parola sincronizzati con la voce", "I tempi delle parole non sono disponibili. Riprova i sottotitoli automatici. Quelli esistenti non sono stati modificati."],
  id: ["Pembagian takarir", "Frasa pendek", "Kata per kata", "Buat takarir frasa pendek atau kata per kata sesuai ucapan", "Waktu tiap kata tidak tersedia. Coba lagi takarir otomatis. Takarir yang ada tidak berubah."],
};
export const CAPTION_GROUPING_COPY = Object.fromEntries(Object.entries(rows).map(([language, values]) => [language,
  Object.fromEntries(["captionGrouping", "captionGroupingPhrases", "captionGroupingWords", "autoCaptionsDesc", "captionTimingUnavailable"].map((key, index) => [key, values[index]])),
]));

const voiceHints = {
  zh: "将当前字幕分成短句配音，并按每段实际音长生成字幕。",
  en: "Generate speech for this caption in short phrases, each timed to its actual audio duration.",
  ja: "現在の字幕を短いフレーズで音声化し、各音声の実際の長さに字幕を合わせます。",
  ko: "현재 자막을 짧은 구절로 음성 생성하고 각 오디오의 실제 길이에 맞춰 자막을 배치합니다.",
  es: "Genera voz para este subtítulo en frases cortas, sincronizadas con la duración real de cada audio.",
  fr: "Générez la voix de ce sous-titre en phrases courtes, calées sur la durée réelle de chaque audio.",
  de: "Diesen Untertitel in kurzen Phrasen vertonen und an die tatsächliche Audiolänge anpassen.",
  pt: "Gere a voz desta legenda em frases curtas, sincronizadas com a duração real de cada áudio.",
  th: "สร้างเสียงจากคำบรรยายนี้เป็นวลีสั้น แล้วจัดเวลาคำบรรยายตามความยาวเสียงจริงของแต่ละวลี",
  vi: "Tạo giọng nói cho phụ đề này theo cụm ngắn, rồi căn phụ đề theo thời lượng âm thanh thực tế.",
  ru: "Озвучить этот субтитр короткими фразами, синхронизированными с реальной длительностью аудио.",
  it: "Genera la voce di questo sottotitolo in frasi brevi, sincronizzate con la durata effettiva di ogni audio.",
  id: "Buat suara takarir ini dalam frasa pendek, sesuai durasi audio sebenarnya untuk tiap frasa.",
};
for (const [language, hint] of Object.entries(voiceHints)) CAPTION_GROUPING_COPY[language].captionVoiceHint = hint;
