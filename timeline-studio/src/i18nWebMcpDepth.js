import { RELIGHTING_COPY } from "./lib/relightingCopy.js";
// Task labels and actionable errors are direct translations in all 13 locales.
const rows = {
  en: ["Analyze relighting", "Convert depth video", "Analyzing depth frames", "Encoding depth video", "Analyze this clip at the selected quality before enabling relighting."],
  zh: ["分析视频打光", "转换深度视频", "正在分析深度帧", "正在编码深度视频", "请先以所选质量分析此片段，再启用打光。"],
  ja: ["照明を解析", "深度動画に変換", "深度フレームを解析中", "深度動画をエンコード中", "照明を有効にする前に、選択した品質でこのクリップを解析してください。"],
  ko: ["조명 분석", "깊이 영상 변환", "깊이 프레임 분석 중", "깊이 영상 인코딩 중", "조명을 켜기 전에 선택한 품질로 이 클립을 분석하세요."],
  es: ["Analizar iluminación", "Convertir vídeo de profundidad", "Analizando fotogramas de profundidad", "Codificando vídeo de profundidad", "Analiza este clip con la calidad seleccionada antes de activar la iluminación."],
  fr: ["Analyser l’éclairage", "Convertir la vidéo de profondeur", "Analyse des images de profondeur", "Encodage de la vidéo de profondeur", "Analysez ce clip avec la qualité choisie avant d’activer l’éclairage."],
  de: ["Beleuchtung analysieren", "Tiefenvideo konvertieren", "Tiefenbilder werden analysiert", "Tiefenvideo wird kodiert", "Analysiere diesen Clip mit der gewählten Qualität, bevor du die Beleuchtung aktivierst."],
  pt: ["Analisar iluminação", "Converter vídeo de profundidade", "Analisando quadros de profundidade", "Codificando vídeo de profundidade", "Analise este clipe na qualidade selecionada antes de ativar a iluminação."],
  th: ["วิเคราะห์การจัดแสง", "แปลงวิดีโอความลึก", "กำลังวิเคราะห์เฟรมความลึก", "กำลังเข้ารหัสวิดีโอความลึก", "วิเคราะห์คลิปนี้ด้วยคุณภาพที่เลือกก่อนเปิดใช้การจัดแสง"],
  vi: ["Phân tích ánh sáng", "Chuyển đổi video độ sâu", "Đang phân tích khung hình độ sâu", "Đang mã hóa video độ sâu", "Hãy phân tích đoạn này ở chất lượng đã chọn trước khi bật ánh sáng."],
  ru: ["Анализ освещения", "Преобразовать видео глубины", "Анализ кадров глубины", "Кодирование видео глубины", "Перед включением освещения проанализируйте клип с выбранным качеством."],
  it: ["Analizza illuminazione", "Converti video di profondità", "Analisi dei fotogrammi di profondità", "Codifica del video di profondità", "Analizza questa clip con la qualità selezionata prima di attivare l’illuminazione."],
  id: ["Analisis pencahayaan", "Konversi video kedalaman", "Menganalisis bingkai kedalaman", "Mengodekan video kedalaman", "Analisis klip ini dengan kualitas yang dipilih sebelum mengaktifkan pencahayaan."],
};
export const WEBMCP_DEPTH_COPY = Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale,
  Object.fromEntries(["aiRelightAnalysis", "aiDepthMap", "aiDepthAnalyzing", "aiDepthEncoding", "aiDepthAnalysisRequired"].map((key, index) => [key, values[index]])),
]));

const descriptions = {
  "en": [
    "Read voices, transcription, relighting analysis and depth-video capabilities without running models.",
    "Prepare voiceover, transcription, relight-analysis or depth-map for review using the current stateToken. Does not run or download models.",
    "Start the reviewed aiId with a unique requestId and explicit allowModelDownload. Depth videos go to My assets; relighting analysis requires a separate reviewed parameter edit.",
    "Choose a ready source of the type required by this task."
  ],
  "zh": [
    "读取声音、转录、打光分析和深度视频能力，不运行模型。",
    "使用当前 stateToken 准备配音、转录、打光分析或深度视频任务供审阅，不运行或下载模型。",
    "使用唯一 requestId 并明确允许 allowModelDownload，启动已审阅的 aiId。深度视频进入我的资产；打光分析后需单独审阅参数修改。",
    "请选择符合此任务类型的已就绪源素材。"
  ],
  "ja": [
    "モデルを実行せず、音声・文字起こし・照明解析・深度動画の機能を確認します。",
    "現在の stateToken で音声、文字起こし、照明解析、深度動画のタスクを準備します。モデルの実行やダウンロードは行いません。",
    "一意の requestId と明示的な allowModelDownload で確認済み aiId を開始します。深度動画はマイ素材に保存され、照明の変更は別途確認します。",
    "このタスクに合った準備済みの素材を選んでください。"
  ],
  "ko": [
    "모델 실행 없이 음성, 전사, 조명 분석 및 깊이 영상 기능을 확인합니다.",
    "현재 stateToken으로 음성, 전사, 조명 분석 또는 깊이 영상 작업을 검토용으로 준비합니다. 모델을 실행하거나 다운로드하지 않습니다.",
    "고유 requestId와 명시적 allowModelDownload로 검토한 aiId를 시작합니다. 깊이 영상은 내 자산에 저장되며 조명 매개변수는 별도 검토합니다.",
    "이 작업에 맞는 준비된 소스를 선택하세요."
  ],
  "es": [
    "Consulta voces, transcripción, análisis de iluminación y vídeo de profundidad sin ejecutar modelos.",
    "Prepara voz, transcripción, iluminación o profundidad para revisión con el stateToken actual, sin ejecutar ni descargar modelos.",
    "Inicia el aiId revisado con requestId único y allowModelDownload explícito. Los vídeos de profundidad van a Mis recursos; la iluminación requiere una edición revisada por separado.",
    "Elige una fuente lista del tipo requerido por esta tarea."
  ],
  "fr": [
    "Consulte les voix, la transcription, l’analyse d’éclairage et la vidéo de profondeur sans exécuter de modèles.",
    "Préparez une tâche vocale, de transcription, d’éclairage ou de profondeur avec le stateToken actuel, sans lancer ni télécharger de modèles.",
    "Lancez l’aiId vérifié avec un requestId unique et allowModelDownload explicite. Les vidéos de profondeur vont dans Mes ressources ; l’éclairage nécessite une modification vérifiée séparément.",
    "Choisissez une source prête du type requis pour cette tâche."
  ],
  "de": [
    "Stimmen, Transkription, Beleuchtungsanalyse und Tiefenvideo prüfen, ohne Modelle auszuführen.",
    "Sprach-, Transkriptions-, Beleuchtungs- oder Tiefenaufgaben mit aktuellem stateToken zur Prüfung vorbereiten, ohne Modelle zu starten oder herunterzuladen.",
    "Geprüfte aiId mit eindeutiger requestId und explizitem allowModelDownload starten. Tiefenvideos landen in Meine Medien; Beleuchtungsparameter werden separat geprüft.",
    "Wähle eine bereite Quelle des für diese Aufgabe erforderlichen Typs."
  ],
  "pt": [
    "Consulte vozes, transcrição, análise de iluminação e vídeo de profundidade sem executar modelos.",
    "Prepare voz, transcrição, iluminação ou profundidade para revisão com o stateToken atual, sem executar nem baixar modelos.",
    "Inicie o aiId revisado com requestId exclusivo e allowModelDownload explícito. Vídeos de profundidade vão para Meus recursos; a iluminação exige uma edição revisada separadamente.",
    "Escolha uma fonte pronta do tipo exigido por esta tarefa."
  ],
  "it": [
    "Consulta voci, trascrizione, analisi della luce e video di profondità senza eseguire modelli.",
    "Prepara voce, trascrizione, illuminazione o profondità per la revisione con lo stateToken attuale, senza eseguire o scaricare modelli.",
    "Avvia l’aiId verificato con requestId univoco e allowModelDownload esplicito. I video di profondità vanno in Le mie risorse; i parametri di luce richiedono una revisione separata.",
    "Scegli una sorgente pronta del tipo richiesto da questa attività."
  ],
  "id": [
    "Baca kemampuan suara, transkripsi, analisis pencahayaan, dan video kedalaman tanpa menjalankan model.",
    "Siapkan tugas suara, transkripsi, pencahayaan, atau kedalaman untuk ditinjau dengan stateToken saat ini, tanpa menjalankan atau mengunduh model.",
    "Mulai aiId yang ditinjau dengan requestId unik dan allowModelDownload eksplisit. Video kedalaman disimpan ke Aset saya; parameter cahaya memerlukan tinjauan terpisah.",
    "Pilih sumber siap pakai dengan jenis yang sesuai untuk tugas ini."
  ],
  "ru": [
    "Просмотр голосов, транскрипции, анализа освещения и видео глубины без запуска моделей.",
    "Подготовьте озвучку, транскрипцию, освещение или глубину для проверки с текущим stateToken без запуска и загрузки моделей.",
    "Запустите проверенный aiId с уникальным requestId и явным allowModelDownload. Видео глубины сохраняются в Мои ресурсы; параметры освещения проверяются отдельно.",
    "Выберите готовый источник подходящего для задачи типа."
  ],
  "vi": [
    "Đọc khả năng giọng nói, phiên âm, phân tích ánh sáng và video độ sâu mà không chạy mô hình.",
    "Chuẩn bị tác vụ giọng nói, phiên âm, ánh sáng hoặc độ sâu để xem xét bằng stateToken hiện tại, không chạy hay tải mô hình.",
    "Bắt đầu aiId đã xem xét với requestId duy nhất và allowModelDownload rõ ràng. Video độ sâu vào Tài sản của tôi; thông số ánh sáng cần được xem xét riêng.",
    "Chọn nguồn đã sẵn sàng và đúng loại cho tác vụ này."
  ],
  "th": [
    "อ่านความสามารถด้านเสียง การถอดเสียง การวิเคราะห์แสง และวิดีโอความลึกโดยไม่เรียกใช้โมเดล",
    "เตรียมงานเสียง ถอดเสียง แสง หรือความลึกเพื่อตรวจสอบด้วย stateToken ปัจจุบัน โดยไม่เรียกใช้หรือดาวน์โหลดโมเดล",
    "เริ่ม aiId ที่ตรวจสอบแล้วด้วย requestId ที่ไม่ซ้ำและ allowModelDownload ที่อนุญาตชัดเจน วิดีโอความลึกจะอยู่ในสินทรัพย์ของฉัน ส่วนค่าแสงต้องตรวจสอบแยก",
    "เลือกแหล่งข้อมูลที่พร้อมและตรงกับประเภทของงานนี้"
  ]
};
for (const [locale, values] of Object.entries(descriptions)) Object.assign(WEBMCP_DEPTH_COPY[locale], Object.fromEntries(["toolAiCapabilitiesDescription", "toolAiPrepareDescription", "toolAiStartDescription", "aiInvalidSource"].map((key, index) => [key, values[index]])));

for (const [locale, copy] of Object.entries(RELIGHTING_COPY)) Object.assign(WEBMCP_DEPTH_COPY[locale], copy);

const qualityLabels = {
  en: ["Analysis quality", "Fast", "Standard", "Fine"], zh: ["分析质量", "快速", "标准", "精细"],
  ja: ["解析品質", "高速", "標準", "精細"], ko: ["분석 품질", "빠르게", "표준", "정밀"],
  es: ["Calidad del análisis", "Rápida", "Estándar", "Fina"], fr: ["Qualité d’analyse", "Rapide", "Standard", "Fine"],
  de: ["Analysequalität", "Schnell", "Standard", "Fein"], pt: ["Qualidade da análise", "Rápida", "Padrão", "Fina"],
  th: ["คุณภาพการวิเคราะห์", "เร็ว", "มาตรฐาน", "ละเอียด"], vi: ["Chất lượng phân tích", "Nhanh", "Tiêu chuẩn", "Chi tiết"],
  ru: ["Качество анализа", "Быстрое", "Стандартное", "Точное"], it: ["Qualità dell’analisi", "Rapida", "Standard", "Fine"],
  id: ["Kualitas analisis", "Cepat", "Standar", "Rinci"],
};
for (const [locale, values] of Object.entries(qualityLabels)) Object.assign(WEBMCP_DEPTH_COPY[locale], Object.fromEntries(["fieldDepthQuality", "depthQualityFast", "depthQualityBalanced", "depthQualityFine"].map((key, index) => [key, values[index]])));
