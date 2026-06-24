---
title: "Digital robustness versus analog under noisy transmission"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 65"]
related: ["mini-lab-5-2-communication-chain-and-robustness-comparison", "bits-per-sample-versus-bits-per-level", "instruction-exercises-on-pcm-digitization"]
tags: ["digital-transmission", "analog-transmission", "snrout", "polar-rz", "noise-spectral-density", "bits-per-sample"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-065-2.png"]
---

## Digital robustness versus analog under noisy transmission

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 65

The mini-lab uses matched channel conditions to compare digital and analog transmission quality. Students first set up a digital transmission using a fixed line code and power, then vary the number of bits per sample and finally compare the resulting digital audio to analog transmission at the same power and noise spectral density. One intended observation is that poor digital audio is not always due to channel noise; it can also come from quantization effects or from the fact that higher-resolution digitization produces more bits that must be transmitted through the same communication resources. The exercise then increases the channel noise spectral density and repeats the analog-versus-digital comparison, encouraging the student to decide which scheme is preferable under harsher noise conditions. The durable lesson is that digital systems can outperform analog systems because symbol decisions and regeneration can suppress accumulated channel distortion, but digital performance is constrained by bitrate, bandwidth, and detection errors. The comparison connects subjective listening results to objective output SNR and reinforces that robustness depends on the entire chain, not just on the sampling resolution.

### Source snapshots

![Communications_1_CourseReader Page 65](/communication-1/assets/communications-1-coursereader-page-065-2.png)

### Page-grounded details

#### Page 65

- 2) Once you have recorded, open the 'Digital transmitter' tab. In this tab,
change the line coding to 'Polar RZ' and set the transmitter power to 10
Watt. Then go to the 'Channel' tab and set the noise spectral density to
3e - 07. Then go again back to the 'Digital transmitter' tab and click the
transmit button.
- 3) After you do this click on the button 'Transmit data' to transmit the data.
You will have to wait about 20 seconds (depending on your computer) until
the waveform shows up.
- 4) After the waveform shows up, go to the 'Digital receiver' tab, and play the
audio. Take a note of the SN Rout. What do you hear? Is the audio quality
poor? If so, from where does this noise come from? (hint: Its not because of
channel noise)
- 5) Now, go back to the 'Sampling and Quantization' tab, and change the
number of bits per sample to 16. Then, move to the 'Digital transmitter' tab
and click the transmit button. After the new waveform shows up, go to the
'Digital receiver' tab and play the sound. Take note on the SN Rout. Do you
hear a better-quality audio? Did the SN Rout value improve? Can you explain
why increasing bits per sample increases audio quality (hence SN Rout)?
- 6) Now re

[Truncated for analysis]

### Key points

- The exercise first uses 8 bits per sample, then 16, then 24 bits per sample.
- Students are asked whether audio quality and $SNR_{out}$ improve when bits per sample increase.
- The lab explicitly asks whether poor audio at low settings comes from channel noise or another source.
- A direct analog-versus-digital comparison is performed at the same transmitter power of 10 W.
- The channel noise spectral density is later increased to $1 \times 10^{-6}$ for a second comparison.
- Students are asked to justify whether analog or digital transmission should be chosen under the noisier condition.

### Related topics

- [[mini-lab-5-2-communication-chain-and-robustness-comparison|Mini-lab 5.2 communication chain and robustness comparison]]
- [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]
- [[instruction-exercises-on-pcm-digitization|Instruction exercises on PCM digitization]]

### Relationships

- related: [[instruction-exercises-on-pcm-digitization|Instruction exercises on PCM digitization]]
- depends-on: [[bits-per-sample-versus-bits-per-level|Bits per sample versus bits per level]]

## Added from [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Source label: upload

Locations: Page 6

The lecture contrasts analog and digital signals under noise. In an analog signal, if noise is added, the receiver detects the noisy waveform and cannot inherently know what part is signal and what part is noise. In digital communication, the receiver expects a limited set of symbols, such as binary zeros and ones, possibly with a defined coding method. This expectation allows a decision rule: for example, if the received waveform is above a threshold it is interpreted as one value, and if it is below the threshold it is interpreted as another. This makes digital communication robust against moderate noise. If noise becomes large enough to flip a bit, a bit error occurs, but digital systems can use error detection and error correction algorithms to recover original data. The lecture identifies this as a fundamental strength of digital communication.

### Source snapshots

![997203_English Page 6](/communication-1/assets/997203-english-page-006.png)

### New key points

- Analog receivers detect the noisy waveform and may not know what portion is signal versus noise.
- Digital receivers expect discrete values such as bits.
- A threshold can classify a noisy digital waveform as one of two intended values.
- Moderate noise can be tolerated if it does not cross the decision threshold.
- Large noise can cause a bit error.
- Error detection and error correction can help recover original data after digital bit errors.
