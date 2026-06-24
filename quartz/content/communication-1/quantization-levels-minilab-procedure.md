---
title: "Quantization Levels Minilab Procedure"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 50"]
related: ["pulse-code-modulation-and-quantization-process", "receiver-output-signal-to-noise-ratio-in-pcm", "quantization-noise-types-in-pcm-systems"]
tags: ["quantization", "bits-per-sample", "matlab", "audio", "pcm", "mini-lab-2", "lab-1"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-050-2.png"]
---

## Quantization Levels Minilab Procedure

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 50

The quantization minilab is a simple controlled listening experiment designed to make the perceptual effect of bit depth concrete. Using the same MATLAB Mini-lab 2 environment, students vary only the number of bits per sample while recording comparable voice signals. The procedure starts at 24 bits per sample, then repeats with 16 bits and finally 8 bits. At each step, the student records the same kind of sound and compares both the audio playback and the displayed sample waveform. The durable lesson is procedural: hold the source content as constant as possible, vary the bit depth, and compare the resulting audio quality and sample representation. This makes quantization noise a directly observable consequence of reducing the number of levels $M = 2^n$. It also complements the theoretical 6-dB rule by giving a qualitative sense of why low-resolution PCM sounds worse and why higher-resolution quantization better preserves the original waveform.

### Source snapshots

![Communications_1_CourseReader Page 50](/communication-1/assets/communications-1-coursereader-page-050-2.png)

### Page-grounded details

#### Page 50

Minilab exercise 5.1 - Quantization levels and noise
This mini-lab exercise requires you to use Mini-lab 2 (Sampling and Quantization)
on MATLAB.
When you open Minilab 2 you will be confronted with the following view:
In the settings section, you may change the microphone recording duration and also
which microphone to use from your computer. Furthermore, on the audio sampling
settings you may change the sampling frequency, and for this exercise, that is of
interest. In this minilab, we are interested in the settings of the number of bits
per sample. We may note, that you can only choose bits per sample to be 8, 16 or 24
- 1) The task in this minilab is to simply experience the effect of having a low
number of bits per sample, and a high number of bits per sample, and what
happens to the audio. Start by setting the number of bits per sample to 24,
record your audio and play it.
- 2) Now, try to make the same sound when you recorded the first step, but
change the number of bits per sample to 16 and record your voice again. Do
you see or hear any difference?
- 3) Record the same sounds but with 8 bits per sample. Notice any differences
in the audio? And in the audio samples plot? [ov

[Truncated for analysis]

### Key points

- The exercise uses Mini-lab 2 in MATLAB.
- The variable of interest is the number of bits per sample.
- Available choices are 8, 16, and 24 bits per sample.
- Students first record audio at 24 bits.
- They then repeat with 16 bits and again with 8 bits.
- The exercise asks students to compare both audio quality and waveform plots.

### Related topics

- [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation and Quantization Process]]
- [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]
- [[quantization-noise-types-in-pcm-systems|Quantization Noise Types in PCM Systems]]

### Relationships

- applies-to: [[quantization-noise-types-in-pcm-systems|Quantization Noise Types in PCM Systems]]
- applies-to: [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]
