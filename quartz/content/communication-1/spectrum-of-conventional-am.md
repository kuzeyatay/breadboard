---
title: "Spectrum of Conventional AM"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 115"]
related: ["amplitude-modulation-fundamentals", "double-sideband-suppressed-carrier-modulation", "envelope-detector-for-am-demodulation"]
tags: ["am-spectrum", "carrier", "sidebands", "fourier-transform", "upper-sideband"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-115-2.png"]
---

## Spectrum of Conventional AM

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 115

The frequency-domain representation of conventional AM separates naturally into a carrier component and two shifted copies of the message spectrum. Starting from $s(t)=A_c[1+m(t)]\cos(2\pi f_c t)$, the signal is expanded into a pure carrier term and a modulated term. The Fourier transform of the carrier produces impulses at $\pm f_c$, while the modulated term generates shifted versions of the message spectrum $M(f)$ around those same carrier frequencies. The resulting spectrum is $S(f)=\tfrac{A_c}{2}\delta(f-f_c)+\tfrac{A_c}{2}\delta(f+f_c)+\tfrac{A_c}{2}M(f-f_c)+\tfrac{A_c}{2}M(f+f_c)$. If the baseband message has bandwidth $B$, the transmitted AM signal therefore occupies upper and lower sidebands around the carrier. The chapter uses this derivation to emphasize that the sidebands contain the information, while the carrier itself mainly aids simpler demodulation. Figure 81 depicts this structure for a square-bandwidth message spectrum.

### Source snapshots

![Communications_1_CourseReader Page 115](/communication-1/assets/communications-1-coursereader-page-115-2.png)

### Page-grounded details

#### Page 115

10.4.4 Spectrum of AM signals
Recalling the general equation for AM signals
s(t) = Ac [1 + m(t)] cos(2πfct), (136)
We can take its Fourier transform to observe how the spectrum of such signals will look
like. By expanding eq. 136, we have
s(t) = Ac cos(2πfct) + Acm(t) cos(2πfct) (137)
We note that the first term is the carrier component and the second term is the sideband
(where the message is contained).
1. Carrier Component: The carrier signal Ac cos(2πfct) has the Fourier transform:
F{Ac cos(2πfct)} = Ac
2 δ(f - fc) + Ac
2 δ(f + fc). (138)
2. Sidebands: The term Ac m(t) cos(2πfct) modulates the carrier, resulting in shifted
spectra (Using the property that a multiplication in time domain is a convolution in
frequency domain):
F{Ac m(t) cos(2πfct)} = Ac
2 M (f - fc) + Ac
2 M (f + fc), (139)
where M (f ) is the Fourier transform of m(t).
The overall spectrum S(f ) is the sum of the carrier and sideband components:
S(f ) = Ac
2 δ(f - fc) + Ac
2 δ(f + fc) + Ac
2 M (f - fc) + Ac
2 M (f + fc). (140)
If the baseband message m(t) has a bandwidth B (i.e., M (f ) = 0 for |f | > B), then:
- The upper sideband extends from fc - B to fc + B,
- The lower sideband extends from -fc - B to -fc +

[Truncated for analysis]

### Key points

- The AM spectrum consists of a carrier plus upper and lower sidebands.
- The carrier appears as impulses at $\pm f_c$.
- The message spectrum is shifted to $f_c$ and $-f_c$.
- Sidebands carry the message information.
- If the baseband bandwidth is $B$, the passband occupies regions around the carrier extending by $B$.
- The spectrum follows directly from expanding the time-domain AM expression.

### Related topics

- [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
- [[double-sideband-suppressed-carrier-modulation|Double-Sideband Suppressed Carrier Modulation]]
- [[envelope-detector-for-am-demodulation|Envelope Detector for AM Demodulation]]

### Relationships

- depends-on: [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
