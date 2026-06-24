---
title: "Analog Modulation Exercises on AM, FM, Envelope Detection, and VSB"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 130", "Page 131"]
related: ["working-with-decibels-for-power-gain-and-snr", "free-space-wireless-propagation-and-friis-equation"]
tags: ["dsb-with-carrier", "envelope-detector", "modulation-index", "quadrature-multiplexing", "vestigial-side-band", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-130-2.png", "/communication-1/assets/communications-1-coursereader-page-131-2.png"]
---

## Analog Modulation Exercises on AM, FM, Envelope Detection, and VSB

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 130, Page 131

The opening pages of this chunk contain exercise prompts that target core reusable ideas in analog modulation. They cover AM with carrier, percent modulation, modulation efficiency, overmodulation effects on envelope detection, FM spectra and deviation, and sideband-based schemes such as quadrature multiplexing and vestigial sideband. Even though these pages do not provide worked solutions, they identify the concepts students are expected to compute or explain, making them durable study items. The AM tasks connect the message amplitude to modulation depth and power efficiency, including the standard result that AM efficiency is bounded when modulation depth is limited to 100%. The exercises also highlight that if AM is overmodulated to 150%, an envelope detector produces distortion, motivating coherent or other distortion-free demodulation methods with additional requirements. The FM exercise centers on using carrier amplitude, carrier frequency, message frequency, modulation index, and filter bandwidth to determine spectral lines, frequency deviation, and transmitted power after filtering. The final exercise links AM efficiency, carrier power in a load, spectrum sketching, phase rotation of a sideband, and generation and advantages of vestigial sideband transmission.

### Source snapshots

![Communications_1_CourseReader Page 130](/communication-1/assets/communications-1-coursereader-page-130-2.png)

![Communications_1_CourseReader Page 131](/communication-1/assets/communications-1-coursereader-page-131-2.png)

### Page-grounded details

#### Page 130

with respect to the carrier signal. The phase deviation of the oscillator signal with respect
to the carrier signal is ϕ.
c)Derive an expression for the demodulated signal, and thus proof that the
strength of the signal depends on the phase deviation.
d)What has to be done with the signal s(t) in order to ensure that demodulation
by means of an envelope detector is possible, and indicate the condition which
has to be ensured.
e)Explain how quadrature multiplexing works.
Exercise 28) (Video solution available)
An information signal 0.4 sin(ωmt), is modulated on a carrier wave with an AM modulator
(DSB with carrier).
a)Give an expression for the AM signal and calculate the % modulation.
b)Calculate the modulation or power efficiency of the AM signal.
c)Show that the maximum achievable power efficiency in case of AM is equal to
50% if the % modulation may not be larger than 100%.
The % modulation is increased to 150%. Subsequently, the AM signal is detected by an
envelope detector with an ideal diode.
d)Draw as accurately as possible, the output signal of the envelope detector.
e)How can the AM signal be demodulated free of distortion and discuss the
requirements to be met.
Exercise 2

[Truncated for analysis]

#### Page 131

the advantages of this modulation method?
127

### Key points

- AM with carrier is analyzed using signal expression, percent modulation, and power efficiency.
- Maximum AM power efficiency is constrained when percent modulation must not exceed 100%.
- Overmodulation at 150% causes envelope detector distortion.
- Distortion-free AM demodulation requires a different method than simple envelope detection when overmodulated.
- FM analysis uses modulation index, frequency deviation constant, and peak frequency deviation.
- Band-pass filtering of an FM signal is evaluated by percentage of transmitted signal power.
- Sideband phase manipulation can change the effective modulation form.
- Vestigial Side Band generation and its advantages are treated as conceptual outcomes.

### Related topics

- [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]
- [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]

### Relationships

- depends-on: [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]
