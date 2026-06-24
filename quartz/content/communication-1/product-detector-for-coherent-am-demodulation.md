---
title: "Product Detector for Coherent AM Demodulation"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 120"]
related: ["envelope-detector-for-am-demodulation", "mixer-based-upconversion-and-downconversion", "double-sideband-suppressed-carrier-modulation"]
tags: ["product-detector", "coherent-detection", "low-pass-filter", "local-oscillator", "dsb-sc"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-120-2.png"]
---

## Product Detector for Coherent AM Demodulation

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 120

The product detector is introduced as a coherent demodulator that overcomes the limitations of envelope detection. Instead of inferring the message from the envelope, it actively multiplies the received modulated signal by a locally generated carrier synchronized in frequency and phase with the transmitter's carrier. This multiplication creates a low-frequency difference term containing the desired message and a high-frequency sum term. A low-pass filter removes the high-frequency component, leaving the recovered baseband. Because it does not rely on a visible envelope, the product detector can demodulate overmodulated AM and can also recover DSB-SC signals where the carrier is absent. The chapter explicitly connects this operation to downconversion. Its main tradeoff is the need for accurate local oscillator synchronization, which makes it more complex than an envelope detector but much more versatile for suppressed-carrier and coherent systems.

### Source snapshots

![Communications_1_CourseReader Page 120](/communication-1/assets/communications-1-coursereader-page-120-2.png)

### Page-grounded details

#### Page 120

tector, the product detector actively multiplies the received modulated signal with a locally
generated carrier that is synchronized in frequency and phase with the original transmitter's
carrier. This process, known as coherent detection, "downconverts" the modulated signal
back to baseband.
The product detector works as follows:
- Mixing: The incoming modulated signal is multiplied by a locally generated car-
rier signal. This multiplication produces two components: one at the sum of the
frequencies and one at the difference.
- Low-Pass Filtering: A low-pass filter then removes the high-frequency (sum) com-
ponent, leaving only the baseband (difference) component which contains the original
message.
Figure 88 shows a typical product detector circuit. The key advantage of this method is
its ability to recover the message accurately even when the modulation depth is extreme or
when the carrier is suppressed.
Low-pass
filter
Oscillator
or
Figure 88: Product detector circuit: A coherent demodulator using a local oscillator to downconvert
the modulated signal.
116

### Key points

- A product detector multiplies the received signal by a synchronized local carrier.
- The method is a form of coherent detection.
- Mixing produces sum and difference frequency components.
- A low-pass filter extracts the baseband difference term.
- The detector works for overmodulated AM.
- It also works when the carrier is suppressed, such as in DSB-SC.
- Accurate frequency and phase synchronization are required.

### Related topics

- [[envelope-detector-for-am-demodulation|Envelope Detector for AM Demodulation]]
- [[mixer-based-upconversion-and-downconversion|Mixer-Based Upconversion and Downconversion]]
- [[double-sideband-suppressed-carrier-modulation|Double-Sideband Suppressed Carrier Modulation]]

### Relationships

- contrasts-with: [[envelope-detector-for-am-demodulation|Envelope Detector for AM Demodulation]]
- applies-to: [[double-sideband-suppressed-carrier-modulation|Double-Sideband Suppressed Carrier Modulation]]
