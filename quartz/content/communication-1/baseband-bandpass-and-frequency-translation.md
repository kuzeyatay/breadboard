---
title: "Baseband, Bandpass, and Frequency Translation"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 110", "Page 111"]
related: ["mixer-based-upconversion-and-downconversion", "amplitude-modulation-fundamentals", "double-sideband-suppressed-carrier-modulation"]
tags: ["baseband", "bandpass", "carrier-frequency", "upconversion", "frequency-allocations"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-110-2.png", "/communication-1/assets/communications-1-coursereader-page-111-2.png"]
---

## Baseband, Bandpass, and Frequency Translation

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 110, Page 111

The modulation chapter begins by distinguishing baseband transmission from bandpass or passband transmission. A baseband signal has a spectrum centered at 0 Hz, which can be acceptable in shielded media such as optical fiber or dedicated wired links where external spectrum use is less constrained. In open-air transmission, however, users cannot all occupy the same low-frequency region because interference and spectrum regulation require transmission in allocated frequency bands. The text therefore motivates upconversion: shifting a baseband signal spectrum from 0 Hz to a carrier frequency $f_c$. Figures 77 and 78 illustrate this change from a spectrum centered at 0 Hz to one centered around $\pm f_c$. The chapter also includes a table of common frequency allocations, such as FM broadcast, AM broadcast, aircraft, and amateur bands, reinforcing that radio systems operate within assigned spectral windows. This topic provides the systems-level reason for modulation before introducing the underlying circuits and specific modulation schemes.

### Source snapshots

![Communications_1_CourseReader Page 110](/communication-1/assets/communications-1-coursereader-page-110-2.png)

![Communications_1_CourseReader Page 111](/communication-1/assets/communications-1-coursereader-page-111-2.png)

### Page-grounded details

#### Page 110

10 Amplitude, Frequency and Phase Modulation
10.1 Learning objectives
Students completing this chapter should have learned:
1. Understand the difference between baseband and passband modulation.
2. Understand the concept of up and down conversion using a mixer.
3. Can illustrate a simple circuit for up/down conversion to/from passband to base band
and calculate the right freqeuncy for the local oscilator.
4. Can draw the time evolution of amplitude modulated signals with and without a
carrier (AM and DSB-SC AM).
5. Can draw the Frequency spectrum of an AM modulated signal (both AM and DSB-SC
AM).
6. Can calculate the modulation percentage and efficiency as well as the PEP for AM
modulated signals.
7. Can sketch and explain the operation principle of envelope and product detectors for
AM modulated signals and their limitations.
8. Can sketch the time evolution and spectrum for FM/PM modulated signals.
9. Can calculate modulation index βf for FM modulated signal.
10. Can apply Carson's rule to deduce bandwidth needs for an FM modulated signal.
10.2 Motivation
So far we have discussed the communication of information assuming it is all done at the
same frequency range in which it is s

[Truncated for analysis]

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

### Key points

- Baseband signals are centered around 0 Hz in frequency.
- Bandpass signals are centered around a carrier frequency $f_c$.
- Baseband transmission may be practical in shielded channels such as optical fiber.
- Open-air transmission requires spectrum sharing and regulation.
- Upconversion shifts a signal from baseband to an allocated band.
- Radio services operate in assigned frequency ranges.

### Related topics

- [[mixer-based-upconversion-and-downconversion|Mixer-Based Upconversion and Downconversion]]
- [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
- [[double-sideband-suppressed-carrier-modulation|Double-Sideband Suppressed Carrier Modulation]]

### Relationships

- depends-on: [[mixer-based-upconversion-and-downconversion|Mixer-Based Upconversion and Downconversion]]
