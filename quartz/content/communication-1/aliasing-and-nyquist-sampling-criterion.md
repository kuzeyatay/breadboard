---
title: "Aliasing and Nyquist Sampling Criterion"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 30"]
related: ["aliasing-demonstration-minilab-procedure", "dimensionality-theorem-for-band-limited-signals", "pcm-bandwidth-requirements"]
tags: ["aliasing", "nyquist-sampling-rate", "sampling-frequency", "bandwidth", "audio", "human-hearing"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-030-2.png"]
---

## Aliasing and Nyquist Sampling Criterion

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 30

Aliasing is the distortion that occurs when a continuous-time signal is sampled too slowly, so that the replicated spectra created by sampling overlap in frequency. Once this overlap occurs, the original spectrum is deformed and the lost information cannot be uniquely recovered, making exact reconstruction impossible. The text frames this directly through the repeated-spectrum view of sampling: the sampling frequency must be high enough that neighboring shifted copies of the spectrum do not intersect. This yields Nyquist's sampling criterion, which states that the sampling frequency must be at least twice the bandwidth of the original signal. In the notation used, the condition is $f_s \ge 2B$, where $B$ is the highest frequency present in the signal. The material also ties the theorem to a familiar engineering choice: audio systems commonly sample around 44.1-48 kHz because human hearing spans approximately 20 Hz to 20 kHz, so sampling at a little above $2 \cdot 20\text{ kHz}$ prevents audible aliasing. The section emphasizes this as a design rule rather than a theoretical curiosity: sampling must always satisfy Nyquist's rate to avoid irreversible information loss.

### Source snapshots

![Communications_1_CourseReader Page 30](/communication-1/assets/communications-1-coursereader-page-030-2.png)

### Page-grounded details

#### Page 30

3.4.2 Aliasing
Another observation one can make from studying Eq. (40) is that if the sampling frequency
fs is too small, the repeated spectra will overlap.
Figure 19: Visualization of the effect of aliasing in frequency domain
The spectra overlapping is visualized in Fig. 19. As can be seen, this overlapping will
cause our original spectrum to be deformed, hence causing a loss of information about our
original signal and making it impossible to recover the original signal. This effect is known
as aliasing.
In order to prevent aliasing, by looking at the repeated spectra, we must make sure that
the sampling frequency ω0 = 2πfs is at least twice as big as the bandwidth B of the signal
being sampled. This relation is known as Nyquist's sampling rate criteria, and it can
be formally written as




fs >= 2B 	(44)
where fs is the sampling frequency and B is the bandwidth (or the highest frequency
component) of our signal which is being sampled.
We must always pick the sampling frequency such that it satisfies Nyquist's
sampling rate to avoid aliasing
You may have wondered why audio is usually sampled at a sampling rate of 44.1-48 kHz,
which is a familiar number in audio systems, the

[Truncated for analysis]

### Key points

- Aliasing happens when repeated spectra overlap because the sampling frequency is too small.
- Spectral overlap deforms the original spectrum and causes information loss.
- Once aliasing occurs, the original signal cannot be perfectly recovered.
- Nyquist's criterion requires $f_s \ge 2B$.
- Here $B$ is the signal bandwidth or highest frequency component.
- Audio sampling near 44.1 kHz is motivated by the human hearing range up to 20 kHz.

### Related topics

- [[aliasing-demonstration-minilab-procedure|Aliasing Demonstration Minilab Procedure]]
- [[dimensionality-theorem-for-band-limited-signals|Dimensionality Theorem for Band-Limited Signals]]
- [[pcm-bandwidth-requirements|PCM Bandwidth Requirements]]

## Added from [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Source label: upload

Locations: Page 8

The lecture introduces the Nyquist criterion as the rule for how closely sampling points must be placed. To sample a signal correctly, the sampling frequency must be at least twice the highest frequency present in the signal. The example assumes a signal whose highest frequency is $100\,\mathrm{Hz}$, corresponding to a period of $10\,\mathrm{ms}$ for that component. Sampling once per period is insufficient because the receiver only receives the sample values and may connect the points incorrectly, for example by linear interpolation. Sampling twice per period provides enough information to reconstruct a sinusoidal component at that maximum frequency under ideal conditions. Sampling below this rate is called under-sampling and can produce a different apparent signal than the original. The Nyquist criterion is later connected to spectral overlap in the frequency-domain analysis of sampling.

### Source snapshots

![997203_English Page 8](/communication-1/assets/997203-english-page-008.png)

### New key points

- The sampling frequency must be at least twice the highest frequency of the signal.
- This condition is called the Nyquist criterion.
- If the highest frequency is $100\,\mathrm{Hz}$, its period is $10\,\mathrm{ms}$.
- Sampling once per period does not provide enough information for reliable reconstruction.
- The receiver only has access to the transmitted sample points.
- Sampling below the Nyquist rate is called under-sampling.
