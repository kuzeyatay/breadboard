---
title: "Unipolar and polar NRZ spectral properties"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 76", "Page 77", "Page 78"]
related: ["power-spectral-density-as-a-line-code-analysis-tool", "rz-and-manchester-line-code-spectral-properties", "psd-conversion-for-multilevel-signaling-and-spectral-efficiency"]
tags: ["unipolar-nrz", "polar-nrz", "psd", "dc-component", "sinc"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-076-2.png", "/communication-1/assets/communications-1-coursereader-page-077-2.png"]
---

## Unipolar and polar NRZ spectral properties

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 76, Page 77, Page 78

The text compares Unipolar NRZ and Polar NRZ as two foundational non-return-to-zero line codes with different hardware and spectral properties. Unipolar NRZ uses a single supply because symbols are represented by either the supply voltage or zero. Its PSD includes a sinc-squared envelope and a DC term, reflecting a nonzero average level. Polar NRZ uses positive and negative rails, so it requires two power supplies. Its PSD is given as a sinc-squared spectrum scaled by $A^2T_b$, and the text notes a large DC component in the associated discussion. These line codes are fundamental reference cases for bandwidth and spectral efficiency calculations. Unipolar NRZ is simple but suffers from a DC component and baseline issues in some channels, while Polar NRZ uses symmetric levels and serves as the basis for later multilevel polar signaling. Their spectra are important because first-null bandwidth and spectral shape directly affect how efficiently each code uses a physical channel.

### Source snapshots

![Communications_1_CourseReader Page 76](/communication-1/assets/communications-1-coursereader-page-076-2.png)

![Communications_1_CourseReader Page 77](/communication-1/assets/communications-1-coursereader-page-077-2.png)

### Page-grounded details

#### Page 76

7.4 Unipolar NRZ
Below you may see a visualization of a Unipolar NRZ transmission. Since it is a unipolar
signaling waveform, only one power supply is needed. This is because either we use the
supply voltage, or we use 0 (ground reference). Furthermore, following the analysis of the
PSD, a DC component is present.
Its PSD is given as:

PunipolarN RZ (f ) = A2Tb
4 sinc2(f Tb)[1 + 1
Tb δ(f )] 	(93)
Figure 53: PSD of Unipolar NRZ
72

#### Page 77

In order to calculate the eventual PSD we must first calculate the autocorrelation. The
autocorrelation can be found for Unipolar NRZ in the following manner. We distinguish
between two cases:
- The correlation with no displacement (k=0 ).
- The correlation with a displacement of integer value (k̸ =0 ).
For k=0 there are only two possibilities (with equal probability) for the symbols (both are
zero of both are one). For the case k̸ = 0 case we are looking at 4 possible permutations
(with equal probability) for the case of two symbols with a distance k. For Unipolar NRZ
we assume the an can either have an amplitude A or 0 Volts.
73

#### Page 78

7.5 Polar NRZ
Below you may see a visualization of a Polar NRZ transmission. Since it is a polar signaling
waveform, two power supplies is needed (positive and negative rails). Furthermore, following
the analysis of the PSD, there is a large DC component.




PpolarN RZ (f ) = A2Tbsinc2(f Tb) 	(94)
Figure 54: PSD of Polar NRZ
74

### Key points

- Unipolar NRZ uses one power supply and levels at supply voltage or 0.
- Unipolar NRZ has a DC component in its PSD.
- Polar NRZ uses positive and negative voltage rails.
- Polar NRZ requires two power supplies.
- Both codes have sinc-shaped spectral envelopes.
- These line codes are reference cases for bandwidth and spectral efficiency discussions.

### Related topics

- [[power-spectral-density-as-a-line-code-analysis-tool|Power spectral density as a line-code analysis tool]]
- [[rz-and-manchester-line-code-spectral-properties|RZ and Manchester line-code spectral properties]]
- [[psd-conversion-for-multilevel-signaling-and-spectral-efficiency|PSD conversion for multilevel signaling and spectral efficiency]]

### Relationships

- contrasts-with: [[rz-and-manchester-line-code-spectral-properties|RZ and Manchester line-code spectral properties]]
