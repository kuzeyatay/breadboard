---
title: "Conjugate Symmetry and Line Spectra"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 9"]
related: ["spectrum-representation-of-sums-of-sinusoids", "fourier-series-coefficients-and-line-spectra", "spectrum-view-of-sampling-and-reconstruction"]
tags: ["line-spectrum", "conjugate-symmetry", "complex-amplitude", "frequency-component", "spectrum-plot"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-009.png"]
---

## Conjugate Symmetry and Line Spectra

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 9

The notes define the spectrum as a set of frequency-amplitude pairs $(f_k,a_k)$, where $a_k$ is the complex amplitude. For $k=0$, $a_k=A_0$; for nonzero sinusoidal components, $a_k=\frac{1}{2}A_ke^{j\theta_k}$. This allows the signal to be expressed compactly as $\sum_{k=-N}^{N}a_ke^{j2\pi f_kt}$. A line spectrum plots each frequency component as a vertical line at the appropriate frequency, with length proportional to $|a_k|$, and labels each spectral line with the value of $a_k$. The example signal $x(t)=10+14\cos(200\pi t+\pi/3)-8\cos(500\pi t+\pi/2)$ has spectrum lines at $0$, $\pm100$, and $\pm200$ in the plotted example, with the zero-frequency line labeled $10$. For real signals, the negative-frequency complex amplitude is the complex conjugate of the corresponding positive-frequency amplitude; this is called conjugate symmetry. If a spectrum is requested in $re^{j\theta}$ form with $r>0$, a negative magnitude can be converted by adding a phase of $\pi$.

### Source snapshots

![Signals and Systems full notes Page 9](/signals-and-systems/assets/signals-and-systems-full-notes-page-009.png)

### Page-grounded details

#### Page 9

Now we introduce ak as a new symbol for the complex amplitude
in the spectrum, and define it as follows:

              { A0,  for k = 0
        ak =  {
              { 1/2 Ake^(jθk), for k != 0.

This allows us to say that the spectrum is the set (fk, ak) pairs.
Now (2) can be written as

              N
             sum  ak e^(j2πfkt)
            k=-N


=> Graphical plot of the spectrum:

Each frequency component can be represented by a vertical line at the
appropriate frequency, and the length of the line can be drawn
proportional to the magnitude |ak|. Each spectral line is labeled
with the value of ak to complete the information needed to define the
spectrum.

ex)

[Graph: horizontal frequency axis with vertical spectral lines at -200, -100, 0, 100, 200.
A vertical axis is drawn at 0. The center line at 0 has height labeled 10.
Line at -200 labeled -4e^(-jπ/2).
Line at -100 labeled 7e^(-jπ/3).
Line at 100 labeled 7e^(jπ/3).
Line at 200 labeled -4e^(jπ/2).
Tick labels under the axis: -200, -100, 100, 200.]

* Spectrum plot for the signal
x(t) = 10 + 14 cos(200πt + π/3)
      - 8 cos(500πt + π/2).

=> The complex amplitude of each
negative frequency component
is the complex conj

[Truncated for analysis]

### Key points

- Spectrum can be represented as pairs $(f_k,a_k)$
- $a_0=A_0$ for the zero-frequency component
- For nonzero components, $a_k=\frac{1}{2}A_ke^{j\theta_k}$
- A signal can be written as $\sum_{k=-N}^{N}a_ke^{j2\pi f_kt}$
- A line spectrum uses vertical lines at component frequencies
- Line height is proportional to $|a_k|$
- Real signals have conjugate symmetry between positive and negative frequencies
- Negative magnitudes can be converted to positive magnitudes by adjusting phase

### Related topics

- [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]
- [[fourier-series-coefficients-and-line-spectra|Fourier Series Coefficients and Line Spectra]]
- [[spectrum-view-of-sampling-and-reconstruction|Spectrum View of Sampling and Reconstruction]]

### Relationships

- part-of: [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]
