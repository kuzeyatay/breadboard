---
title: "Aliasing Demonstration Minilab Procedure"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 31"]
related: ["aliasing-and-nyquist-sampling-criterion", "natural-sampling-in-pulse-amplitude-modulation", "flat-top-sampling-and-aperture-effect"]
tags: ["aliasing", "matlab", "sampling-frequency", "microphone", "audio", "mini-lab-2", "lab-1"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-031-2.png"]
---

## Aliasing Demonstration Minilab Procedure

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 31

The minilab on aliasing is structured as a listening-based experiment in which the student changes sampling frequency and observes audible distortion. It uses a MATLAB tool from an earlier sampling and quantization minilab, with the number of bits fixed at 16 because quantization is not yet the variable of interest. The procedure begins by recording speech at the default configuration to verify microphone functionality and baseline playback. Then the student lowers the sampling frequency to 20 kHz and listens for changes, followed by a more systematic sweep starting at 10 kHz and decreasing in 2.5 kHz steps down to 2.5 kHz. The exercise asks the learner to connect the increasingly distorted audio to aliasing theory, using the fact that lower sampling rates violate the Nyquist condition for microphone-recorded audio. It then asks what sampling frequency should be selected to avoid aliasing and whether pushing the rate much higher, up to around 70 kHz, produces meaningful audible improvement. The durable value of the exercise is the procedure itself: verify system function, reduce $f_s$, compare outputs, explain distortion via spectral overlap, then test whether oversampling yields practical gains.

### Source snapshots

![Communications_1_CourseReader Page 31](/communication-1/assets/communications-1-coursereader-page-031-2.png)

### Page-grounded details

#### Page 31

Minilab exercise 3.1 - Aliasing demonstration in time domain
To get started with the minilab, please see section 1.3 of the reader for a starting
point.
This mini-lab exercise requires you to use Mini-lab 2 (Sampling and Quantization)
on MATLAB.
When you open Minilab 2 you will be confronted with the following view:
In the settings section, you may change the microphone recording duration and also
which microphone to use from your computer. Furthermore, on the audio sampling
settings you may change the sampling frequency, and for this exercise, that is of
interest. Leave the number of bits per sample to the default configuration of 16
(bits per sample will be introduced later in the course)
- 1) Start by recording your voice with the default configuration by pressing the
'record audio button'. After you see the audio waveform on the screen, click
on play audio to make sure that the minilab is working on your computer
- 2) Now, supposing that you completed the first step and the microphone
is functioning with the minilab, change the sampling frequency to 20000 Hz,
record and play the audio again, what changes in the audio do you now notice?
- 3) Now, to observe the aliasing effect b

[Truncated for analysis]

### Key points

- The exercise uses Mini-lab 2 in MATLAB.
- Bits per sample stay at the default value of 16.
- Students first record and replay speech with the default setup.
- The sampling frequency is then changed to 20000 Hz to observe changes.
- A sweep from 10000 Hz down to 2500 Hz in 2500 Hz steps is used to expose aliasing clearly.
- Students must explain increasing distortion using the concept of aliasing.
- The task also asks for a suitable anti-aliasing sampling frequency.
- Increasing the sampling frequency up to about 70000 Hz tests whether audible improvement continues.

### Related topics

- [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
- [[natural-sampling-in-pulse-amplitude-modulation|Natural Sampling in Pulse Amplitude Modulation]]
- [[flat-top-sampling-and-aperture-effect|Flat-Top Sampling and Aperture Effect]]

### Relationships

- applies-to: [[aliasing-and-nyquist-sampling-criterion|Aliasing and Nyquist Sampling Criterion]]
