---
title: "Envelope Detector for AM Demodulation"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 118", "Page 119"]
related: ["amplitude-modulation-fundamentals", "am-modulation-percentage-efficiency-and-peak-envelope-power", "product-detector-for-coherent-am-demodulation"]
tags: ["envelope-detector", "am-demodulation", "diode", "rc-filter"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-118-2.png", "/communication-1/assets/communications-1-coursereader-page-119-2.png"]
---

## Envelope Detector for AM Demodulation

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 118, Page 119

The envelope detector is presented as a simple noncoherent circuit for recovering the message from a conventional AM waveform. Its operation relies on the fact that the message is encoded in the envelope of the received signal. The circuit consists of a diode followed by an RC filter. The diode rectifies the input, allowing one polarity of the carrier to pass, while the capacitor-resistor network smooths out the rapid carrier oscillations and follows the slower envelope variations. Under suitable modulation conditions, the output reproduces the baseband message. However, the chapter emphasizes a major limitation: envelope detection works well only when the modulation index remains within acceptable limits, typically below 100%, and when the carrier is not suppressed. If the AM signal is overmodulated, especially when the negative modulation percentage exceeds 100%, the envelope folds and no longer matches the original message. Figures 86 and 87 illustrate this by showing that an overmodulated AM signal carrying $m(t)=1.5\sin(2\pi f t)$ is badly recovered by an envelope detector.

### Source snapshots

![Communications_1_CourseReader Page 118](/communication-1/assets/communications-1-coursereader-page-118-2.png)

![Communications_1_CourseReader Page 119](/communication-1/assets/communications-1-coursereader-page-119-2.png)

### Page-grounded details

#### Page 118

10.6 AM Detector circuits
In any communication system, once the AM modulated signal reaches the receiver, the first
task is to extract (demodulate) the original message from the high-frequency carrier. This
extraction is achieved by a detection circuit, and in this section we discuss two common
methods for demodulation: the envelope detector and the product detector. Both
approaches have distinct advantages and limitations, making them suitable for different
signal conditions.
10.6.1 Envelope Detector
The envelope detector is one of the simplest circuits used in analog communication. Its
operation is based on the observation that the amplitude variations (or "envelope") of
a modulated signal represent the original message signal. The circuit generally consists
of:
- A diode: This component rectifies the incoming signal by allowing only one polarity
(typically the positive half-cycle) to pass through.
- An RC (resistor-capacitor) filter: Following the diode, the capacitor charges
and then discharges slowly through the resistor. This action smooths out the rapid
fluctuations of the carrier and follows the slowly varying envelope of the signal.
Figure 84 illustrates a typical envelope

[Truncated for analysis]

#### Page 119

This method is very effective when the modulation index is within acceptable limits (typi-
cally less than 100%). However, if the signal is overmodulated (i.e., the negative modulation
percentage exceeds 100%) or if the carrier is suppressed, the envelope detector may produce
distorted outputs or fail entirely.
To illustrate this limitation, suppose we transmit a sine wave message using overmodu-
lated AM (i.e., the negative modulation percentage exceeds 100%). Figure 86 shows the
overmodulated AM signal.
Figure 86: Illustration of overmodulated AM signal, carrying a sine-wave as a message m(t) =
1.5 sin(2πf t)
Upon receiving the overmodulated AM signal, we use a envelope detector to recover the
original message signal, and the result of the original message can be seen in Fig. 87.
(a) Original message signal
(b) Recovered overmodulated message signal using envelope detector at receiver
Figure 87: Figure illustrating the original message signal (a), and (b) the recovered message signal
using envelope detector after being transmitted with an overmodulated AM. It can be seen that
the recovered message does not anymore represent the original transmitted message; this shows the
limitat

[Truncated for analysis]

### Key points

- An envelope detector recovers the message from amplitude variations.
- It uses a diode for rectification and an RC filter for smoothing.
- The output follows the slowly varying envelope rather than the carrier oscillation.
- It works well for standard AM with acceptable modulation depth.
- It fails or distorts when the signal is overmodulated.
- It also fails when the carrier is suppressed.

### Related topics

- [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
- [[am-modulation-percentage-efficiency-and-peak-envelope-power|AM Modulation Percentage, Efficiency, and Peak Envelope Power]]
- [[product-detector-for-coherent-am-demodulation|Product Detector for Coherent AM Demodulation]]

### Relationships

- applies-to: [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
- limits: [[am-modulation-percentage-efficiency-and-peak-envelope-power|AM Modulation Percentage, Efficiency, and Peak Envelope Power]]
