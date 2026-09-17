export const progressNotes = [
  "I’ll read the three pages first, then continue in the same voice and sequence.",
  "The workspace index failed, so I’m switching to the attachment/document tools.",
  "I found no mounted file in the conversation folder. I’m locating the uploaded PDF in Breadboard’s local attachment storage so I can OCR the actual notes rather than guess.",
  "The upload is located. Next I’m checking whether it contains text or needs handwriting OCR, then I’ll transcribe all three pages.",
];

export const thinkingHeadings = [
  "Planning attachment inspection and PDF tools",
  "Searching for file and PDF extraction tools",
  "Planning attachment reading using workspace_list",
  "Planning PDF attachment extraction",
  "Planning terminal attachment search",
  "Listing workspace files using PowerShell",
  "Planning attachment access and OCR",
  "Investigating attachment handling outside workspace",
  "Searching attachment extraction tools",
  "Searching for document ingestion tools",
  "Searching tools for PDF extraction",
  "Investigating attachment import method",
  "Evaluating PDF attachment access options",
  "Planning PDF attachment retrieval",
  "Inspecting PDF metadata and extraction tools",
];

export const spinnerFrames = [
  "(¬_¬) processing...", "( ˘⌣˘)♡ deliberating...", "(´･_･`) synthesizing...",
  "( •_•)>⌐■-■ computing...", "ಠ_ಠ cogitating...", "٩(๑❛ᴗ❛๑)۶ reflecting...",
  "(⊙_⊙) pondering...", "ヽ(>∀<☆)☆ mulling...", "◉_◉ reasoning...",
  "(｡•́︿•̀｡) analyzing...", "(◔_◔) ruminating...", "(¬‿¬) formulating...",
  "(⌐■_■) brainstorming...", "(°ロ°) contemplating…", "( ͡° ͜ʖ ͡°) musing...",
];

// No whitespace between frames and Markdown, as in the reported live stream.
export const noisyThinking = thinkingHeadings.map((heading, index) =>
  `${spinnerFrames[index]}**${heading}**`,
).join("");
