---
title: "Week 1 material coverage and whats not covered in the reader"
date: "2026-04-26T14:28:44.526Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_note_type: "chat-node"
generated_by: "chatmock"
related: ["worked-example-for-required-transmit-power", "bit-error-probability-on-awgn-channels", "single-reflection-ground-model-and-the-1-over-d-4-rule", "free-space-wireless-propagation-and-friis-equation", "receiver-output-signal-to-noise-ratio-in-pcm", "relating-input-and-output-snr-in-digital-communication"]
tags: ["awgn-noise-model", "bit-error-probability", "q-function", "hamming-coding", "raised-cosine-filtering", "inter-symbol-interference", "shannon-hartley-theorem", "friis-equation"]
---

## Mostly no. The items I said were not covered are generally not in the Week 1 lecture transcripts, except as brief motiva

Mostly **no**. The items I said were *not* covered are generally **not in the Week 1 lecture transcripts**, except as brief motivation or course-map mentions. They are mainly covered later in the **Communications 1 Course Reader - Sampling, PAM, PCM, and Noise** and the **Communications 1 Topic Map**.

Here is the breakdown:

| Topic not covered in the chapter | Does the Week 1 transcript cover it? | Where it appears in your material |
|---|---:|---|
| **AWGN / noise model** | Only very generally mentions noise/errors, not the AWGN model | **Additive White Gaussian Noise Model** — `Communications_1_CourseReader.pdf`, **Page 54, Page 55** |
| **Bit-error probability / Q-function** | No detailed treatment | **Bit Error Probability on AWGN Channels** — `Communications_1_CourseReader.pdf`, **Page 57, Page 58, Page 59**; **Q-Function as Gaussian Tail Probability** in Course Reader |
| **Hamming coding / syndrome decoding** | No, only general error correction motivation | **Hamming(7,4) Coding and Parity-Bit Placement**; **Hamming Syndrome-Based Error Localization** — Course Reader |
| **Parity-bit checking** | No detailed treatment | **Parity Bit Error Detection**; **Limitations of Parity Bit Checking** — Course Reader |
| **Multilevel signaling** | No detailed treatment | **Baud rate and bit rate relationships** — Course Reader, **Page 72**; **Bits per sample versus bits per level** — **Page 71**; **Multilevel signaling concept and efficiency**; **Noise sensitivity tradeoff in multilevel signaling** |
| **Raised-cosine filtering / zero-ISI** | No | **Raised-cosine Nyquist filtering**; **Nyquist zero-ISI criterion and ideal sinc pulses**; **Mini-lab 8.2 raised-cosine filtering procedure** — Course Reader |
| **Inter-symbol interference, ISI** | No detailed treatment | **Inter-symbol interference from bandwidth-limited channels**; **Modelling ISI in a baseband pulse transmission system** — Course Reader; also appears in **Communications 1 Topic Map** |
| **Line-code spectral properties** | No detailed treatment | **Unipolar and polar NRZ spectral properties**; **RZ and Manchester line-code spectral properties**; **Power spectral density as a line-code analysis tool** — Course Reader |
| **PCM bandwidth / SNR / quantization noise** | Transcript introduces sampling and quantization conceptually, but not the full PCM analysis | **Pulse Code Modulation and Quantization Process**; **Bit Rate and Spectral Efficiency in PCM** — **Page 43, Page 45**; **Quantization Noise Types in PCM Systems**; **Receiver Output Signal-to-Noise Ratio in PCM** |
| **AM modulation** | No | **Amplitude Modulation Fundamentals** — Course Reader, **Page 113**; **AM Modulation Percentage, Efficiency, and Peak Envelope Power** — **Page 114** |
| **DSB-SC / envelope detector / product detector** | No | **Double-Sideband Suppressed Carrier Modulation** — **Page 116, Page 117**; **Envelope Detector for AM Demodulation** — **Page 118, Page 119**; **Product Detector for Coherent AM Demodulation** |
| **FM / PM modulation** | No | **Frequency and Phase Modulation Fundamentals** — **Page 121, Page 122, Page 123**; **FM and PM Modulation Indices and Carson's Rule** — **Page 123, Page 124**; **FM and PM Frequency Spectrum via Bessel Functions** — **Page 125–127** |
| **Wireless propagation / Friis equation** | No | **Free-Space Wireless Propagation and Friis Equation** — Course Reader, **Page 134, Page 135** |
| **Ground reflection / diffraction** | No | **Single-Reflection Ground Model and the $1/d^4$ Rule**; **Knife-Edge Diffraction Loss Calculation** — Course Reader |
| **Optical fiber propagation** | Only optical fiber is briefly mentioned as a possible transmission medium | **Optical Fiber Losses and the Motivation for Fiber Channels**; **Mode Propagation Condition in Multi-Mode Fiber**; **Multi-Mode and Single-Mode Fiber Exploration Procedure** — Course Reader |
| **Shannon capacity** | No | **Shannon-Hartley Channel Capacity Theorem** — Course Reader |
| **Autocorrelation / PSD relation** | No | **Autocorrelation and Power Spectral Density Relation** — Course Reader, **Page 148, Page 149** |

So the Week 1 transcripts mainly cover:

- communication-chain motivation,
- sampling and quantization at a first conceptual level,
- Fourier thinking,
- square waves/harmonics/bandwidth intuition,
- decibels, $\mathrm{dB}$, $\mathrm{dBm}$, $\mathrm{dBW}$,
- Nyquist/sampling in Week 1 Lecture 2,
- learning structure, quizzes, mini-labs, and course logistics.

The more advanced communication-system topics are mostly in the **Course Reader**, not the Week 1 transcript.

The clearest Course Reader pages covered by Week 1 are:

| Course Reader topic | Locations in reader | How Week 1 connects |
|---|---:|---|
| **Aliasing and Nyquist Sampling Criterion** | **Page 30** | Week 1 Lecture 2 covers Nyquist sampling, under-sampling, spectral overlap, and why $f_s \ge 2B$ is required. |
| **Aliasing Demonstration Minilab Procedure** | **Page 31** | Week 1 points students toward mini-labs and sampling practice; this reader page gives the practical MATLAB/audio aliasing exercise connected to the Week 1 sampling discussion. |
| **Dimensionality Theorem for Band-Limited Signals** | **Page 32** | This is a natural continuation of the Week 1 bandwidth/sampling discussion: band-limited signals, symbols, and how bandwidth limits information representation. |
| **Dimensionality Theorem Worked Example** | **Page 32** | Closely tied to the same Week 1 idea that bandwidth limits how quickly signals can vary and how much information can be represented. |
| **Digital robustness versus analog under noisy transmission** | **Page 65** | Week 1 Lecture 2 explicitly discusses why digital communication can be more robust than analog under noise. |

A few other reader pages are **related to Week 1 themes** but are probably not fully “covered” in Week 1:

| Related reader topic | Locations in reader | Relation to Week 1 |
|---|---:|---|
| **Pulse Code Modulation and Quantization Process** | Reader topic, locations not shown in current context | Week 1 Lecture 1 introduces sampling, quantization, and binary representation conceptually, but not the full PCM treatment. |
| **Bit Rate and Spectral Efficiency in PCM** | **Page 43, Page 45** | Week 1 introduces bandwidth and faster time variation, but the detailed PCM bit-rate/spectral-efficiency formulas are reader material. |
| **Bits per sample versus bits per level** | **Page 71** | Week 1 introduces quantization and binary sample representation, but this page belongs to the later multilevel/PCM detail. |
| **Baud rate and bit rate relationships** | **Page 72** | Week 1 mentions symbols/transmission conceptually, but detailed baud-rate versus bit-rate relations are later. |

So, if you want the **Course Reader pages that most directly correspond to Week 1**, start with:

**Course Reader Page 30, Page 31, Page 32, and Page 65.**

If you also want supporting follow-up reading for the Week 1 sampling/quantization/digital-chain ideas, add:

**Page 43, Page 45, Page 71, and Page 72.**

## Related notes

- [[worked-example-for-required-transmit-power|Worked Example for Required Transmit Power]]
- [[bit-error-probability-on-awgn-channels|Bit Error Probability on AWGN Channels]]
- [[single-reflection-ground-model-and-the-1-over-d-4-rule|Single-Reflection Ground Model and the $1/d^4$ Rule]]
- [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]
- [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]
- [[relating-input-and-output-snr-in-digital-communication|Relating Input and Output SNR in Digital Communication]]
