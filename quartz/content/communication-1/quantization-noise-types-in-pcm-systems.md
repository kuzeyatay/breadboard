---
title: "Quantization Noise Types in PCM Systems"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 49"]
related: ["pulse-code-modulation-and-quantization-process", "receiver-output-signal-to-noise-ratio-in-pcm", "quantization-levels-minilab-procedure"]
tags: ["quantization-noise", "overload-noise", "granular-noise", "hunting-noise", "adc", "pcm"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-049-2.png"]
---

## Quantization Noise Types in PCM Systems

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 49

The extra material on quantization noise distinguishes several physically meaningful error types at the output of a PCM receiver. Overload noise occurs when the analog input exceeds the ADC range, causing saturation and flat-topped distortion in the recovered signal. Random quantization noise is the ordinary round-off error that arises when valid input samples are approximated by the nearest quantization level. Granular noise appears when the signal is relatively small compared with the quantization step size, producing a coarse and visibly stair-stepped representation; the text notes that this can be reduced by increasing the number of quantization levels or using nonlinear quantization. Hunting noise is associated with nearly constant input signals and can cause the quantizer to oscillate between neighboring levels. These categories are useful because they explain that not all PCM noise has the same cause: some is due to range limits, some due to finite step size, and some due to dynamic behavior around nearly static levels. The topic therefore refines the general notion of quantization error into practical diagnostic classes.

### Source snapshots

![Communications_1_CourseReader Page 49](/communication-1/assets/communications-1-coursereader-page-049-2.png)

### Page-grounded details

#### Page 49

Overview of quantization noise types (extra material ).
The quantizing noise at the output of the PCM receiver can be categorized into four types:
1) Overload noise - If an input analog signal, exceeds the ADC range, then flat tops
start occurring in the recovered signal because the ADC saturates.
2) Random noise quantization causing round-off errors, for normal input signals within
the ADC range (see Fig. 28c).
3) Granular noise - for signals relatively small in comparison to the quantization levels
(decreases with more quantizing levels, or nonlinear quantization). See Fig. 31, for
illustration
4) Hunting noise - for nearly-constant input signals, may cause oscillating quantizer.
Granular noise
Figure 31: Granular noise in quantization [2, ch.3, p.200]
45

### Key points

- Overload noise occurs when the input exceeds the ADC range and the converter saturates.
- Random quantization noise comes from normal round-off errors.
- Granular noise appears when the signal is small relative to quantization levels.
- Granular noise decreases with more quantization levels or nonlinear quantization.
- Hunting noise can occur for nearly constant input signals and may cause oscillation.

### Related topics

- [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation and Quantization Process]]
- [[receiver-output-signal-to-noise-ratio-in-pcm|Receiver Output Signal-to-Noise Ratio in PCM]]
- [[quantization-levels-minilab-procedure|Quantization Levels Minilab Procedure]]

