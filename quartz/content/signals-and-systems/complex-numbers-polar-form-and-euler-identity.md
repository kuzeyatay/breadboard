---
title: "Complex Numbers, Polar Form, and Euler Identity"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 4", "Page 5"]
related: ["complex-exponential-signals", "phasors-and-rotating-complex-vectors", "phasor-addition-of-same-frequency-cosines"]
tags: ["complex-numbers", "cartesian-form", "polar-form", "phasor", "eulers-identity", "argand-plane"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-004.png", "/signals-and-systems/assets/signals-and-systems-full-notes-page-005.png"]
---

## Complex Numbers, Polar Form, and Euler Identity

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 4, Page 5

Complex numbers are introduced as a foundation for complex exponential signals and phasors. A complex number $z\in\mathbb{C}$ is an ordered pair of real numbers with Cartesian representation $z=(x,y)$ or $z=x+jy$, where $x=\operatorname{Re}(z)$, $y=\operatorname{Im}(z)$, and $j=\sqrt{-1}$. In the complex or Argand plane, the real part is the horizontal coordinate and the imaginary part is the vertical coordinate. Because complex numbers can be viewed like vectors in a two-dimensional plane, they can also be represented in polar form as $z=re^{j\theta}$ or phasor notation $r\angle\theta$, where $r=|z|$ and $\theta=\operatorname{Arg}(z)$. Conversion from polar to Cartesian uses $x=r\cos\theta$ and $y=r\sin\theta$; conversion from Cartesian to polar uses $r=\sqrt{x^2+y^2}$ and an argument calculation. Since ordinary $\arctan(y/x)$ cannot distinguish quadrants, the notes give a piecewise rule for choosing the correct argument. Euler's identity, $e^{j\theta}=\cos\theta+j\sin\theta$, makes polar form algebraically useful.

### Source snapshots

![Signals and Systems full notes Page 4](/signals-and-systems/assets/signals-and-systems-full-notes-page-004.png)

![Signals and Systems full notes Page 5](/signals-and-systems/assets/signals-and-systems-full-notes-page-005.png)

### Page-grounded details

#### Page 4

1.3 Complex exponentials and Phasors

- We have shown that cosine signals are useful mathematical representations
for signals that arise in a practical setting; and they are simple to obtain
and interpret. However, it turns out that the analysis and manipulation
of sinusoidal signals is often greatly simplified by dealing with
related signals called complex exponential signals.

Preview of complex numbers:

[Diagram: Cartesian form complex plane. Vertical axis labeled Im(z), horizontal axis labeled R(z). A point marked x on the negative real axis. A vector/line from the origin down-left to a point labeled (x,y). Dashed vertical line from x down to the point, and dashed horizontal line from the point to the y mark near the vertical axis. Label: "cartesian form". Boxed equation: z = x + jy.]

[Diagram: Polar form complex plane. Vertical axis labeled Im(z), horizontal axis labeled R(z). A point marked x on the negative real axis. A vector/line from the origin down-left to a point. Dashed vertical line from x down to the point and dashed horizontal line to the y mark. The vector is labeled r. An angle arc at the origin is labeled θ. Label: "polar form". Boxed equation: z = re^(jθ).]

A

[Truncated for analysis]

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

### Key points

- Cartesian form is $z=x+jy$ with $x=\operatorname{Re}(z)$ and $y=\operatorname{Im}(z)$
- The imaginary unit is $j=\sqrt{-1}$
- Complex numbers are represented on the complex or Argand plane
- Polar form is $z=re^{j\theta}$, where $r=|z|$ and $\theta=\operatorname{Arg}(z)$
- Phasor notation can write polar form as $r\angle\theta$
- Polar-to-Cartesian conversion uses $x=r\cos\theta$ and $y=r\sin\theta$
- Cartesian-to-polar magnitude is $r=\sqrt{x^2+y^2}$
- Euler's identity is $e^{j\theta}=\cos\theta+j\sin\theta$

### Related topics

- [[complex-exponential-signals|Complex Exponential Signals]]
- [[phasors-and-rotating-complex-vectors|Phasors and Rotating Complex Vectors]]
- [[phasor-addition-of-same-frequency-cosines|Phasor Addition of Same-Frequency Cosines]]

