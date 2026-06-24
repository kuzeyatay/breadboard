---
title: "Instruction Exercises on AM, FM, and PM"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 128", "Page 129"]
related: ["amplitude-modulation-fundamentals", "double-sideband-suppressed-carrier-modulation", "fm-and-pm-modulation-indices-and-carsons-rule", "fm-and-pm-frequency-spectrum-via-bessel-functions"]
tags: ["iq-detector", "dsb-sc", "peak-envelope-power", "modulation-efficiency", "complex-envelope", "week-8", "final-topic"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-128-2.png", "/communication-1/assets/communications-1-coursereader-page-129-2.png"]
---

## Instruction Exercises on AM, FM, and PM

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 128, Page 129

The final exercise section consolidates the analog modulation material through derivations, spectra, power calculations, and detector analysis. One problem asks students to show equivalent representations of a bandpass signal using the complex envelope $g(t)=x(t)+jy(t)=R(t)e^{j\theta(t)}$, linking geometric and in-phase/quadrature descriptions. Other exercises address DSB-SC spectra for a 1 kHz tone on a 3.8 MHz carrier, average power and PEP across a 50 $\Omega$ load, and standard AM problems such as proving a waveform is AM, drawing its amplitude spectrum, computing modulation efficiency, and discussing pros, cons, and demodulation methods. Additional tasks cover DSB-SC signal expression, IQ detection, identification of modulation type from given waveforms, calculation of modulation indices or percentage modulation, average power, and required bandwidth. The final problem considers coherent demodulation when the local oscillator has the correct carrier frequency but is not perfectly synchronous. Collectively, these exercises test the procedural use of modulation formulas rather than merely recalling definitions.

### Source snapshots

![Communications_1_CourseReader Page 128](/communication-1/assets/communications-1-coursereader-page-128-2.png)

![Communications_1_CourseReader Page 129](/communication-1/assets/communications-1-coursereader-page-129-2.png)

### Page-grounded details

#### Page 128

10.9 Instruction Exercises - AM/FM/PM
The solutions to these exercises may be found under the page 5ETC0 Canvas Page Mod-
ules -> Week 5 -> I. Amplitude and Phase/Frequency modulation
Problem 19
Show that if v(t) = Re{g(t) exp jωct}, the equations below are correct, where g(t)=x(t) +
jy(t)=R(t)ejθ(t)
v(t) = R(t) cos(ωct + θ(t))
v(t) = x(t) cos(ωct) - y(t) sin(ωct)
Problem 20
A double-sideband suppressed carrier (DSB-SC) signal s(t) with a carrier frequency of 3.8
MHz has a complex envelope g(t) = Acm(t),Ac = 50 V , and the modulation is a 1-kHz
sinusoidal test tone described by m(t) = 2 sin(2π1000t). Evaluate the voltage spectrum for
this DSB-SC signal.
Exercise 21) (Video solution available)
Assume the DSC-SC voltage signal,
s(t) = 100 sin(2π1000t) cos(2π3.810 * 106t)
appears accross a 50 Ohm resistive load
a) Compute the actual average power dissipated the load.
b) Compute the actual PEP.
Exercise 22) (Video solution available)
A sine-shaped base-band signal m(t) is modulated by an amplitude modulator. The per-
centage of modulation of the AM signal s(t) at the output of the modulator is 50%.
a)Give an expression for the signal s(t) at the output of the modulator and
discuss the

[Truncated for analysis]

#### Page 129

Exercise 24) (Video solution available)
A sinusoidal signal with a frequency of 1 kHz, is with a DSB-SC modulator modulated on a
carrier with a frequency of 300 kHz, and loaded with a resistor of 50 Ohm. The amplitude
of the DSB signal across the load resistance is 20 V.
a)Give an expression for the DSB signal.
b)Sketch the two-sided amplitude spectrum of the DSB signal (indicate axes,
units and scales).
c)Calculate the "Peak Envelope Power" that is dissipated in the load resistor.
d)Calculate the percentage of modulation of the modulated signal.
e)Draw the block diagram of an IQ (in-phase and quadrature-phase) detector.
f)Derive expressions for the two outputs of the detector.
Exercise 25) (Video solution available)
The following two voltages across a load resistor of 50 ohms are given:
s1(t) = 5cos(2π105t)sin(2π109t)
and
s2(t) = 10 sin(2π109t - 4 cos(2π105t))
a)From what type of modulation is each of those signals?
b)What are the modulation indices or % modulation of these signals?
c)Calculate the average power which is dissipated in the load resistor for each
of the signals separately.
d)What is, the bandwidth required for virtually distortion-free transfer of each
of these sign

[Truncated for analysis]

### Key points

- Exercises use complex-envelope representations of bandpass signals.
- They include DSB-SC spectrum derivations and power calculations.
- They ask for AM signal identification, spectrum sketching, and efficiency computation.
- They include PEP calculations across a 50 $\Omega$ load.
- They cover IQ detector block diagrams and output derivations.
- They require identifying AM, FM, or PM from signal expressions.
- They connect modulation index to bandwidth requirements.

### Related topics

- [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
- [[double-sideband-suppressed-carrier-modulation|Double-Sideband Suppressed Carrier Modulation]]
- [[fm-and-pm-modulation-indices-and-carsons-rule|FM and PM Modulation Indices and Carson's Rule]]
- [[fm-and-pm-frequency-spectrum-via-bessel-functions|FM and PM Frequency Spectrum via Bessel Functions]]

### Relationships

- applies-to: [[amplitude-modulation-fundamentals|Amplitude Modulation Fundamentals]]
- applies-to: [[double-sideband-suppressed-carrier-modulation|Double-Sideband Suppressed Carrier Modulation]]
- applies-to: [[fm-and-pm-modulation-indices-and-carsons-rule|FM and PM Modulation Indices and Carson's Rule]]
- applies-to: [[fm-and-pm-frequency-spectrum-via-bessel-functions|FM and PM Frequency Spectrum via Bessel Functions]]
