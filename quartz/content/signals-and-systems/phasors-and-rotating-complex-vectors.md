---
title: "Phasors and Rotating Complex Vectors"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 6", "Page 7"]
related: ["complex-exponential-signals", "phasor-addition-of-same-frequency-cosines", "spectrum-representation-of-sums-of-sinusoids"]
tags: ["phasor", "complex-amplitude", "complex-multiplication", "polar-form", "angular-velocity", "rotating-phasor"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-006.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-007.png"]
---

## Phasors and Rotating Complex Vectors

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 6, Page 7

The notes use complex multiplication to motivate the rotating phasor interpretation of a complex exponential. When two complex numbers are multiplied in polar form, their magnitudes multiply and their angles add: $z_3=r_1e^{j\theta_1}r_2e^{j\theta_2}=r_1r_2e^{j(\theta_1+\theta_2)}$. A complex exponential can therefore be factored as $z(t)=Ae^{j(\omega_0t+\phi)}=Ae^{j\phi}e^{j\omega_0t}$. The fixed factor $X=Ae^{j\phi}$ is defined as the phasor or complex amplitude, while $e^{j\omega_0t}$ rotates with time. Thus $z(t)=Xe^{j\omega_0t}$ describes a vector in the complex plane rotating as time increases. The complex amplitude specifies the initial magnitude and phase, and $\omega_0$ specifies the angular velocity of rotation. This phasor viewpoint is later used to simplify adding sinusoids and constructing spectra.

### Source snapshots

![Signals and Systems full notes Page 6](/signals-and-systems/assets/signals-and-systems-full-notes-page-006.png)

![Signals and Systems full notes Page 7](/signals-and-systems/assets/signals-and-systems-full-notes-page-007.png)

### Page-grounded details

#### Page 6

Ex. plot z(t)=20e^(j(80t-0.4π))

[Graph: top plot labeled "Real Part". Vertical axis marked 20, 0, -20. Curve starts near +20, descends to about -20, rises to near +20, then descends toward -20.]

[Graph: bottom plot labeled "Imaginary Part". Vertical axis marked 20, 0, -20. Curve starts below 0, rises to about +20, descends to about -20, then rises again.]

- z(t)=20e^(j(80t-0.4π))

=20cos(80t-0.4π)+20j sin(80t-0.4π)

=20cos(80t-0.4π)+20j cos(80t-0.9π)

Plotting a complex signal as a function of time requires two graphs. One for the real part and one for the imaginary part. Observe that the real and imaginary parts of the complex exponential signal are both real sinusoid signals, and they are phase shifted by a phase shift of 0.5π rad.

=> The main reason that we are interested in the complex exponential signal is that it is an alternative representation of the real cos/sin signal.

∴ x(t)=Re(Ae^j(ω_0t+ϕ)) = A cos(ω_0t+ϕ)

This will greatly simplify our further calculations.

=> The rotating phasor interpretation.

[Diagram: complex plane with vertical axis labeled Im(z) and horizontal axis labeled Re(z). Three vectors drawn from origin: z_1 in first quadrant with angle θ_1 from p

[Truncated for analysis]

#### Page 7

- The complex amplitude specifies the initial magnitude and phase of the
phasor, while the frequency w0 specifies the angular velocity of its
rotation in the complex plane

[arrow/label:] same frequency

1.4 Phasor Addition (Cosine Addition)

- There are many situations in which it is necessary to add two or more
sinusoidal signals. When all signals have the same frequency, the addition
simplifies.

\[
\sum_{k=1}^{N} A_k \cos(\omega_0 t + \phi_k) = A \cos(\omega_0 t + \phi)
\]

- The equation above states that a sum of N cosine signals of different
amplitudes and, but with the same frequency, can always be reduced to a single
cosine signal of the same frequency.

The algorithm is as follows:

[large downward arrow]

Ex: calculate \(x(t)=2\cos(100\pi t+\frac{\pi}{6})-2\sqrt{3}\cos(100\pi t-\frac{\pi}{3})\)

Solution:

1. Represent \(x_1(t)\) and \(x_2(t)\) by the phasors

\[
\tilde{x}_1(t)=2e^{j\pi/6}
\]

\[
\tilde{x}_2(t)=-2\sqrt{3}e^{-j\pi/3}
\]

2. Convert phasors to rectangular form

\[
\tilde{x}_1(t)=r\cos(\frac{\pi}{6})+r\sin(\frac{\pi}{6})j
=\frac{2\sqrt{3}}{2}+\frac{2}{2}j=-\sqrt{3}+j
\]

\[
\tilde{x}_2(t)=-\sqrt{3}+3j
\]

3. Add the real and imaginary parts

\[
(-\sqrt{3}+\

[Truncated for analysis]

### Key points

- Polar multiplication multiplies magnitudes and adds angles
- $z_3=r_1r_2e^{j(\theta_1+\theta_2)}$ for $z_1z_2$ in polar form
- A complex exponential can be factored as $Ae^{j\phi}e^{j\omega_0t}$
- The phasor is defined as $X=Ae^{j\phi}$
- The signal can be written $z(t)=Xe^{j\omega_0t}$
- The phasor gives initial magnitude and phase
- $\omega_0$ gives angular velocity of rotation in the complex plane
- The notes also call $X$ the complex amplitude

### Related topics

- [[complex-exponential-signals|Complex Exponential Signals]]
- [[phasor-addition-of-same-frequency-cosines|Phasor Addition of Same-Frequency Cosines]]
- [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]

### Relationships

- depends-on: [[complex-exponential-signals|Complex Exponential Signals]]
