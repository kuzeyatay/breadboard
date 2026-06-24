---
title: "Complex Exponential Signals"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 5", "Page 6"]
related: ["complex-numbers-polar-form-and-euler-identity", "phasors-and-rotating-complex-vectors", "spectrum-representation-of-sums-of-sinusoids"]
tags: ["complex-exponential-signal", "eulers-identity", "real-part", "imaginary-part", "cosine", "sine"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-005.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-006.png"]
---

## Complex Exponential Signals

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 5, Page 6

A complex exponential signal packages a cosine and sine into one complex-valued signal. It is defined as $z(t)=Ae^{j(\omega_0t+\phi)}=A\cos(\omega_0t+\phi)+jA\sin(\omega_0t+\phi)$. The real part is a real cosine signal and the imaginary part is a real sine signal. The example $z(t)=20e^{j(80t-0.4\pi)}$ expands to $20\cos(80t-0.4\pi)+20j\sin(80t-0.4\pi)$, and the sine term can also be written as a cosine with phase shift: $20j\cos(80t-0.9\pi)$. Since a complex signal has both real and imaginary parts, plotting it as a function of time requires two graphs. The notes emphasize that complex exponentials are useful because the real sinusoid can be obtained as $x(t)=\operatorname{Re}(Ae^{j(\omega_0t+\phi)})=A\cos(\omega_0t+\phi)$. This representation simplifies later calculations involving sinusoidal signals.

### Source snapshots

![Signals and Systems full notes Page 5](/signals-and-systems/assets/signals-and-systems-full-notes-page-005.png)

![Signals and Systems full notes Page 6](/signals-and-systems/assets/signals-and-systems-full-notes-page-006.png)

### Page-grounded details

#### Page 5

Polar form: forms can also denoted by the "phasor" notation

r∠θ where r=|z|, θ=Arg(z)

To convert polar form to cartesian form:

x = r cosθ,      y = r sinθ

and to convert cartesian form to polar form:

r = √(x^2+y^2) and θ = arctan (imaginary part / real part) = arctan (y/x)

! Since arctan returns values only in the interval (-π/2, π/2) cannot distinguish
points in different quadrants.

down
eg. (x,y) = (1,1) and (-1,-1) give the same ratio 1, but their arguments
should differ.

∴ A better way is the piecewise definition; (indetermined for x=y=0).

arg(z) {
arctan(y/x) : x>0, y>0 or x>0, y<0 (quadrant I, IV)
arctan(y/x)+π : x<0, y>0 (quadrant II)
arctan(y/x)-π : x<0, y<0 (quadrant III)
π/2 : for x=0, y>0
-π/2 : for x=0, y<0
}

The r∠θ notation is clumsy and does not lend itself to ordinary algebraic
rules. A much better formula is given by Euler's identity e^(jθ)=cos(θ)+j sin(θ).

z = r e^(jθ) = r cos(θ) + j r sin(θ).

-> Complex exponential Signal is defined as:

z(t) = A e^(j(ω0t+ϕ)) = A cos(ω0t+ϕ) + j A sin(ω0t+ϕ)

It is clear that the real part of the complex exponential signal is a
real cosine signal and its imaginary part is a real sine signal.

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

### Key points

- Complex exponential signal: $z(t)=Ae^{j(\omega_0t+\phi)}$
- Euler expansion gives $A\cos(\omega_0t+\phi)+jA\sin(\omega_0t+\phi)$
- The real part is a cosine signal
- The imaginary part is a sine signal
- Complex signals require separate plots for real and imaginary parts
- Example: $20e^{j(80t-0.4\pi)}$ expands into real and imaginary sinusoids
- A real cosine is recovered by taking the real part of the complex exponential
- Complex exponentials provide an alternative representation of real cosine and sine signals

### Related topics

- [[complex-numbers-polar-form-and-euler-identity|Complex Numbers, Polar Form, and Euler Identity]]
- [[phasors-and-rotating-complex-vectors|Phasors and Rotating Complex Vectors]]
- [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]

### Relationships

- depends-on: [[complex-numbers-polar-form-and-euler-identity|Complex Numbers, Polar Form, and Euler Identity]]
