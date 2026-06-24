---
title: "Sampling Methods Minilab for Practical Reconstruction"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 39", "Page 40"]
related: ["aliasing-and-nyquist-sampling-criterion", "natural-sampling-in-pulse-amplitude-modulation", "flat-top-sampling-and-aperture-effect"]
tags: ["matlab", "ideal-sampling", "flat-top-sampling", "natural-sampling", "chirp-signal", "low-pass-filter", "lab-1"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-039-2.png", "/communication-1/assets/communications-1-coursereader-page-040-2.png"]
---

## Sampling Methods Minilab for Practical Reconstruction

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 39, Page 40

The minilab on sampling methods guides students through audible and spectral comparisons between ideal sampling, flat-top PAM, and natural sampling using a MATLAB simulation chain with low-pass reconstruction. The lab explicitly focuses on the analog-domain output of sampling and reconstruction, leaving later digital stages such as DAC outside the exercise. Students first use a 500 Hz sinusoid, ideal sampling at 500 Hz, and a 1000 Hz low-pass filter, then compare input and output to identify the audible effect and connect it to the frequency-domain behavior from sampling theory. They then switch to a chirp from 0 to 500 Hz and configure PAM flat-top sampling, choosing a suitable sampling frequency and low-pass filter passband so that the reconstructed chirp sounds similar to the original. Next, they reduce the sampling frequency below 1200 Hz while setting the low-pass filter to 1500 Hz, then inspect the output spectrum and explain distortions intuitively. Finally, they repeat the procedure with PAM natural sampling and compare its behavior to flat-top sampling. The exercise teaches a repeatable method: choose source signal, choose sampling method and frequency, reconstruct with a low-pass filter, compare input/output in both hearing and spectrum, and explain errors through aliasing and practical sampling distortions.

### Source snapshots

![Communications_1_CourseReader Page 39](/communication-1/assets/communications-1-coursereader-page-039-2.png)

![Communications_1_CourseReader Page 40](/communication-1/assets/communications-1-coursereader-page-040-2.png)

### Page-grounded details

#### Page 39

Minilab exercise 4.1 - Gating and flat-top sampling demonstration
This mini-lab exercise requires you to use Mini-lab 2 (Sampling and Quantization)
on MATLAB. (See section 1.3 of the reader in case you dont know how to install
and start)
When you open Minilab 2, please click on the 'sampling specifics' and you will be
confronted with the following view:
The figure below explains the signal chain being considered in this Minilab exercise.
The main purpose is to test different sampling methods, and try to reconstruct
them at the output using a low-pass filter. We don't consider any other part of the
digital communication chain, and the DAC (Digital to analog converter) is removed
from the signal reconstruction block, since we are analyzing only the output of
sampling, which is on the analog domain.
35

#### Page 40

.
Change the input signal to a frequency sweep from 0 to 500 hz. This type of signal,
known as a chirp signal, it has a rectangular spectrum and is widely used in radar
systems. Press on the button upload input to upload the signal, and select input
and play audio, if you wish to hear how such a chirp signal sounds. You may choose
the sampling type and the sampling frequency fs on the sampling type section. And
finally, you may change the passband of the lowpass filter using the knob in the
output low-pass filter section.
- 1) For the first demonstration, make sure the input is 500 Hz sinusoid, use
ideal sampling, keep the sampling frequency at 500 Hz, and the output low-
pass filter knob at 1000 Hz. Upload the input, sample it, and filter it. Play
the input of the 500 Hz, and then play the output of the 500 Hz. Do they
sound different? If so, what is happening with them? (What is this effect
called?). Can you show on the frequency domain of the sampled signal the
issue (hint: see sampling theory section) ?
- 2) Now let's move on to more practical sampling methodologies, switch the
input type to a chirp signal (frequency sweep from 0 to 500 Hz), and make
the sampling type PAM flat-

[Truncated for analysis]

### Key points

- The minilab studies different sampling methods with reconstruction by a low-pass filter.
- The first task uses a 500 Hz sinusoid with ideal sampling at 500 Hz.
- The low-pass reconstruction filter is initially set to 1000 Hz.
- A chirp from 0 to 500 Hz is then used to test flat-top sampling.
- Students must tune sampling frequency and filter passband to recover the chirp well.
- Sampling frequency below 1200 Hz with a 1500 Hz filter is used to reveal distortion effects.
- The same procedure is repeated with natural sampling for comparison.

### Related topics

- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
- [[natural-sampling-in-pulse-amplitude-modulation|Natural Sampling in Pulse Amplitude Modulation]]
- [[flat-top-sampling-and-aperture-effect|Flat-Top Sampling and Aperture Effect]]

### Relationships

- applies-to: [[natural-sampling-in-pulse-amplitude-modulation|Natural Sampling in Pulse Amplitude Modulation]]
- applies-to: [[flat-top-sampling-and-aperture-effect|Flat-Top Sampling and Aperture Effect]]
- applies-to: [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
