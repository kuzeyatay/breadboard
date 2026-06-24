---
title: "Mixer-Based Upconversion and Downconversion"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 111", "Page 112"]
related: ["baseband-bandpass-and-frequency-translation", "product-detector-for-coherent-am-demodulation", "double-sideband-suppressed-carrier-modulation"]
tags: ["mixer", "local-oscillator", "upconversion", "downconversion", "coherent-detection"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-111-2.png", "/communication-1/assets/communications-1-coursereader-page-112-2.png"]
---

## Mixer-Based Upconversion and Downconversion

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 111, Page 112

Frequency translation between baseband and bandpass is implemented with a mixer, local oscillator, and filter. The mixer multiplies the input signal by a sinusoid from the local oscillator. By the identity $\cos(\alpha)\cos(\beta) = \tfrac{1}{2}\cos(\alpha+\beta) + \tfrac{1}{2}\cos(\alpha-\beta)$, the multiplication produces sum and difference frequency components. A filter then selects the desired term: the sum component for upconversion to a higher carrier-centered band, or the difference component for downconversion toward baseband. The local oscillator provides a stable sinusoid at the carrier frequency and is a central element in practical modulators and demodulators. Figure 79 gives the typical topology with input, mixer, LO, and filter blocks. This circuit idea reappears later in product detection for AM and in general coherent demodulation, making it a foundational procedure for analog communication systems.

### Source snapshots

![Communications_1_CourseReader Page 111](/communication-1/assets/communications-1-coursereader-page-111-2.png)

![Communications_1_CourseReader Page 112](/communication-1/assets/communications-1-coursereader-page-112-2.png)

### Page-grounded details

#### Page 111

transmission is shielded from the outside world, it does not matter in fact how much of the
available spectrum we use. In the case of open-air transmission, this is very different, since
there are strict regulations on what part of the frequency spectrum one can transmit on
(See table 1, for common frequency band regulations) .
Source Allocated Frequency band (MHz)
Longwave BCB (EU) 0.150-0.285
AM BCB (EU) 0.153-0.279
AM BCB (US) 0.530-1.710
Amateur 1.8-1.9
Citizens band 26-28
Amateur 28-30
Land mobile 30-50
Amateur 50-54
TV low VHF 54-88
Land mobile (EU) 66-88
FM BCB (EU) 87.5-108
FM BCB (US) 88-108
Aircraft 108-136
Land mobile (J) 142-174
Table 1: Common frequency allocations
To solve this, we upconvert the signal, thus re-centering from 0Hz to a carrier frequency.
This means starting from a spectrum such as depicted here (Baseband):
Figure 77: Spectrum of a baseband signal (centered around 0 Hz)
into one that is re-centered, with representations for both positive and negative frequency
components (Bandpass).
Figure 78: Spectrum of a bandpass signal (centered around a carrier frequency fc)
10.3.1 Up and down conversion
To shift a signal between baseband and bandpass, a circuit co

[Truncated for analysis]

#### Page 112

cos(α) cos(β) = 1
2 cos(α + β) + 1
2 cos(α - β). (129)
This relation shows that the multiplication results in two frequency components: one at
the sum (α + β) and one at the difference (α - β) of the original frequencies. A filter is
then used to select the desired component, thus achieving either upconversion (shifting to
a higher frequency band) or downconversion (shifting to baseband). The typical topology
to achieve up and down conversion is shown in Fig. 79.
vin(t) 	v1(t)
vLO (t)= A 0 cos ( 	0 t)
Local
oscillator
v2(t)
Filter
Mixer
Figure 79: Up and down conversion circuit topology [2, ch.4-11, p.291]
The local oscillator (LO) generates a stable, sinusoidal waveform at a fixed frequency, which
is the carrier frequency fc.
108

### Key points

- A mixer translates frequency by multiplying two signals.
- The local oscillator provides a stable sinusoid at the carrier frequency.
- Mixing creates sum-frequency and difference-frequency components.
- A filter selects the desired component after mixing.
- Choosing the sum term enables upconversion.
- Choosing the difference term enables downconversion.
- The same principle underlies coherent demodulation.

### Related topics

- [[baseband-bandpass-and-frequency-translation|Baseband, Bandpass, and Frequency Translation]]
- [[product-detector-for-coherent-am-demodulation|Product Detector for Coherent AM Demodulation]]
- [[double-sideband-suppressed-carrier-modulation|Double-Sideband Suppressed Carrier Modulation]]

### Relationships

- applies-to: [[product-detector-for-coherent-am-demodulation|Product Detector for Coherent AM Demodulation]]
