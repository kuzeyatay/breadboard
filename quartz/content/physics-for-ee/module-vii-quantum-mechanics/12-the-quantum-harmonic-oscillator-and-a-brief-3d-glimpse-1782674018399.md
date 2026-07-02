---
title: "12) The quantum harmonic oscillator and a brief 3D glimpse"
date: "2026-06-28T19:13:38.399Z"
source: "user-note"
knowledge_type: "user-note"
---

## The quantum harmonic oscillator and a brief 3D glimpse

The particle in a box, the finite well, and tunneling barriers all showed the same basic rule: the potential energy function $U(x)$ shapes the allowed wave functions. In a box, hard walls forced nodes. In a finite well, the wave function leaked into forbidden regions. In a barrier, the same exponential penetration allowed tunneling. But those examples used potentials with sharp edges. Many real systems are confined more smoothly. Near a stable equilibrium point, the potential often looks like a bowl rather than a box.

The simplest smooth bowl is the harmonic oscillator potential. Classically, a mass attached to a spring has potential energy

$$
U(x)=\frac{1}{2}k_sx^2,
$$

where $x$ is displacement from equilibrium and $k_s$ is the spring constant. The restoring force is

$$
F=-k_sx,
$$

so the system is pulled back toward $x=0$. It is often useful to write the same potential as

$$
U(x)=\frac{1}{2}m\omega^2x^2,
$$

where $m$ is the particle mass and

$$
\omega=\sqrt{\frac{k_s}{m}}
$$

is the angular frequency of the corresponding classical oscillator. The subscript in $k_s$ keeps the spring constant distinct from the wave number $k$ used in matter waves.

This parabolic potential is important because it is more general than a literal spring. Whenever a stable potential has a smooth minimum, the region close to that minimum can often be approximated by a parabola. That makes the quantum harmonic oscillator the basic quantum model of smooth confinement.

To find its allowed stationary states, we use the time-independent Schrödinger equation,

$$
-\frac{\hbar^2}{2m}\frac{d^2\psi(x)}{dx^2}
+
U(x)\psi(x)
=
E\psi(x),
$$

where $\psi(x)$ is the spatial wave function, $E$ is the energy of the state, and $\hbar=h/(2\pi)$. Substituting the harmonic oscillator potential gives

$$
-\frac{\hbar^2}{2m}\frac{d^2\psi(x)}{dx^2}
+
\frac{1}{2}m\omega^2x^2\psi(x)
=
E\psi(x).
$$

The first term is the kinetic-energy term, controlled by the curvature of the wave function. The second term is the potential-energy term, which grows as $x^2$. The allowed states are the normalizable wave functions that satisfy this equation.

The result is a discrete energy ladder:

$$
E_n=\left(n+\frac{1}{2}\right)\hbar\omega,
\qquad
n=0,1,2,3,\ldots
$$

This is the mathematical centerpiece of the quantum harmonic oscillator. The integer $n$ labels the oscillator state. Unlike the particle in a box, the lowest state is labelled $n=0$. But because of the extra $1/2$, the lowest energy is not zero:

$$
E_0=\frac{1}{2}\hbar\omega.
$$

This lowest energy is called the **zero-point energy**.

[Interactive visual: quantum harmonic oscillator energy ladder — the student changes $\omega$ and observes the equally spaced levels $E_n=(n+\frac12)\hbar\omega$, highlighting the nonzero ground-state energy $E_0=\frac12\hbar\omega$]

Zero-point energy is not a small correction to a classical picture. It is a direct sign that the oscillator is quantum. A classical oscillator can have zero energy by sitting at $x=0$ with zero velocity. A quantum oscillator cannot be exactly localized at $x=0$ with exactly zero momentum, because position and momentum obey

$$
\Delta x\,\Delta p\geq \frac{\hbar}{2}.
$$

The ground state therefore still has a spread in position and momentum, and that unavoidable spread corresponds to nonzero energy. This does not mean the particle is secretly moving back and forth along a tiny classical path. It means the lowest allowed quantum state has a stationary probability distribution and a nonzero minimum energy.

The spacing between adjacent levels follows immediately from the energy formula:

$$
E_{n+1}-E_n=\hbar\omega.
$$

So the oscillator levels are equally spaced. This differs from the particle in a box, where

$$
E_n\propto n^2
$$

and the gaps grow larger at higher $n$. For the harmonic oscillator, every step up the ladder costs the same energy $\hbar\omega$. This equal spacing is why harmonic oscillators appear so often in quantum physics: vibrations and radiation modes can be described as systems whose energy increases in equal quanta.

The wave functions also have a recognizable pattern. The ground-state wave function is largest near the equilibrium point $x=0$ and decays smoothly away from it. Higher states have more nodes, meaning more positions where

$$
\psi(x)=0.
$$

As always, the probability density is

$$
|\psi(x)|^2.
$$

A node is a place where the particle will not be detected in that stationary state. Higher $n$ does not mean the wave function simply has a larger amplitude. The states are normalized, so the total probability remains one. Higher $n$ means more spatial structure, more nodes, and higher energy.

[Interactive visual: oscillator wave functions and probability densities — the student chooses $n$ and sees $\psi_n(x)$, $|\psi_n(x)|^2$, and the parabolic potential $U(x)=\frac12m\omega^2x^2$, highlighting how nodes increase with $n$]

The harmonic oscillator also continues the earlier lesson about forbidden regions. For a classical oscillator with total energy $E$, the turning points occur where all the energy is potential energy:

$$
E=U(x)=\frac{1}{2}m\omega^2x^2.
$$

Solving gives

$$
x=\pm x_t,
\qquad
x_t=\sqrt{\frac{2E}{m\omega^2}}.
$$

Classically, the oscillator cannot go beyond these points, because beyond them

$$
K=E-U(x)<0.
$$

Quantum mechanically, the wave function does not abruptly stop at $\pm x_t$. Beyond the classical turning points, the region is classically forbidden, so the wave function decays rather than oscillates. This is the same principle as in finite wells and tunneling: $E<U$ does not force $\psi$ to become zero; it changes the wave function into an exponentially decaying form. Therefore there is a nonzero probability of detecting the oscillator slightly outside the classical turning points.

[Interactive visual: oscillator turning points and forbidden tails — the student chooses an energy level and sees the classical turning points $x=\pm x_t$; the visual shows $\psi$ extending beyond the turning points as exponentially decaying tails]

This repairs the main classical misconception. The quantum oscillator is not just a classical oscillator with only certain allowed amplitudes. In a classical oscillator, a particle follows a definite path and spends more time near the turning points because it moves more slowly there. In a quantum stationary state, the theory gives a probability density, not a hidden back-and-forth trajectory. The wave function determines where detections are likely, and it can extend into regions that a classical oscillator could never enter.

The harmonic oscillator therefore completes the sequence of one-dimensional models. The infinite box showed quantization from hard boundary conditions. The finite well showed penetration into forbidden regions. The barrier showed tunneling. The harmonic oscillator shows that smooth confinement also creates discrete stationary states, with equally spaced energies and a nonzero ground-state energy.

The natural next question is what happens when the particle is not limited to one dimension. In one dimension, the stationary wave function is

$$
\psi(x),
$$

and the probability density is

$$
|\psi(x)|^2.
$$

In three dimensions, the wave function depends on position in space:

$$
\psi(x,y,z).
$$

The probability density is still the absolute square,

$$
|\psi(x,y,z)|^2,
$$

but now it is a probability density per unit volume. The probability of finding the particle inside a region of space is

$$
P=\int_{\text{region}}|\psi(x,y,z)|^2\,dV.
$$

Normalization becomes

$$
\int_{\text{all space}}|\psi(x,y,z)|^2\,dV=1.
$$

So the interpretation is not changed; it is widened. In one dimension, probability is area under a curve. In three dimensions, probability is accumulated over volume.

The Schrödinger equation widens in the same way. In one dimension, the kinetic-energy term used the curvature

$$
\frac{d^2\psi}{dx^2}.
$$

In three dimensions, the wave function can curve in the $x$, $y$, and $z$ directions. The curvature operator becomes the Laplacian,

$$
\nabla^2
=
\frac{\partial^2}{\partial x^2}
+
\frac{\partial^2}{\partial y^2}
+
\frac{\partial^2}{\partial z^2}.
$$

The three-dimensional time-independent Schrödinger equation is

$$
-\frac{\hbar^2}{2m}
\nabla^2\psi(x,y,z)
+
U(x,y,z)\psi(x,y,z)
=
E\psi(x,y,z).
$$

This is the same structure as before: kinetic energy comes from wave-function curvature, potential energy comes from $U$, and the allowed stationary states are the wave functions that satisfy the equation with definite energy.

[Interactive visual: from 1D wave function to 3D probability cloud — the student compares $|\psi(x)|^2$ on a line with $|\psi(x,y,z)|^2$ in space; the visual shows probability as area in 1D and as volume density in 3D]

This three-dimensional view is especially important for atoms. The Bohr model pictured electrons in circular orbits, but the fuller quantum picture describes electrons using three-dimensional wave functions. The electron is not assigned a classical path around the nucleus. Instead, $|\psi(x,y,z)|^2$ forms a probability cloud: it tells us where the electron is likely to be detected.

This is only a brief glimpse. Solving the three-dimensional Schrödinger equation for hydrogen introduces additional quantum numbers and orbital shapes, which belong beyond this section’s scope. The essential point here is simpler: the same logic used for boxes, barriers, and oscillators generalizes to real space. Potentials shape wave functions, normalization gives probabilities, and allowed stationary states come from solving Schrödinger’s equation.

The quantum harmonic oscillator and the 3D glimpse therefore extend the same chain of ideas. We began with smooth confinement and modeled it by the parabolic potential

$$
U(x)=\frac{1}{2}m\omega^2x^2.
$$

Solving the stationary-state problem gives the quantized ladder

$$
E_n=\left(n+\frac{1}{2}\right)\hbar\omega,
$$

with equal spacing, zero-point energy, nodes, and forbidden-region tails. Then the same wave-function interpretation widened from a line to three-dimensional space, where probability density becomes $|\psi(x,y,z)|^2$ and atomic electrons are better pictured as probability clouds than as classical orbits. This prepares the final conceptual step: entanglement, where the quantum state of more than one object cannot always be separated into independent single-particle wave functions.
