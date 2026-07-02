---
title: "10) The time-independent Schrödinger equation and the particle in a box"
date: "2026-06-28T19:04:05.430Z"
source: "user-note"
knowledge_type: "user-note"
---

## The time-independent Schrödinger equation and the particle in a box

The previous subsection gave the wave function a physical interpretation. The wave function $\Psi(x,t)$ is a probability amplitude, and its absolute square,

$$
|\Psi(x,t)|^2,
$$

is the probability density for finding the particle near position $x$ at time $t$. Once we know this, the next question becomes practical: how do we find the wave function for a particle in a particular physical situation?

The free-particle Schrödinger equation was the first answer, but it applied only when the particle had no potential-energy variation. Real quantum systems usually involve confinement or forces. An electron in an atom, an electron in a small semiconductor region, or a particle trapped between barriers is not simply free everywhere. The potential energy $U(x)$ must be included. In one dimension, the time-dependent Schrödinger equation becomes

$$
i\hbar\frac{\partial \Psi(x,t)}{\partial t}
=
-\frac{\hbar^2}{2m}
\frac{\partial^2\Psi(x,t)}{\partial x^2}
+
U(x)\Psi(x,t).
$$

Here $m$ is the particle mass, $U(x)$ is the potential energy, and $\hbar=h/(2\pi)$. The first term on the right-hand side is the kinetic-energy term. It contains a second spatial derivative because kinetic energy depends on momentum squared. The second term is the potential-energy term. Together, they describe how the wave function evolves in time.

For many quantum systems, however, we first want to find states with definite energy. These are called **stationary states**. A stationary state has a wave function of the form

$$
\Psi(x,t)=\psi(x)e^{-iEt/\hbar},
$$

where $\psi(x)$ is the spatial part of the wave function and $E$ is the energy of the state. The exponential factor changes with time, but its magnitude is always one:

$$
\left|e^{-iEt/\hbar}\right|^2=1.
$$

Therefore,

$$
|\Psi(x,t)|^2=|\psi(x)|^2.
$$

So in a stationary state, the complex phase still evolves in time, but the probability density does not. This is why stationary states are so useful: they let us find fixed probability patterns associated with definite energies.

Substituting

$$
\Psi(x,t)=\psi(x)e^{-iEt/\hbar}
$$

into the time-dependent Schrödinger equation separates the time part from the position part and gives the **time-independent Schrödinger equation**:

$$
-\frac{\hbar^2}{2m}
\frac{d^2\psi(x)}{dx^2}
+
U(x)\psi(x)
=
E\psi(x).
$$

This is the mathematical centerpiece of this subsection. It says that an allowed spatial wave function $\psi(x)$ must be shaped so that its kinetic-energy contribution plus its potential-energy contribution equals the same function multiplied by a definite energy $E$. In simpler terms: the potential $U(x)$ sets the rules, and only certain wave shapes satisfy those rules.

[Interactive visual: stationary-state phase — the student changes $E$ in $\Psi(x,t)=\psi(x)e^{-iEt/\hbar}$; the visual shows the complex phase rotating while $|\Psi|^2=|\psi|^2$ remains fixed]

The cleanest example is the **particle in a box**, also called the one-dimensional infinite square well. Imagine a particle trapped between two perfectly rigid walls at

$$
x=0
\qquad \text{and} \qquad
x=L.
$$

Inside the box, the particle is free:

$$
U(x)=0
\qquad
\text{for } 0<x<L.
$$

Outside the box, the potential is idealized as infinitely large:

$$
U(x)=\infty
\qquad
\text{for } x\leq 0 \text{ or } x\geq L.
$$

The infinite walls mean the particle cannot be found outside the box. Since $|\psi(x)|^2$ gives probability density, the wave function must be zero outside. It must also be zero at the walls:

$$
\psi(0)=0,
\qquad
\psi(L)=0.
$$

These boundary conditions are the key to the whole model. They are what turn a continuous range of possible waves into a discrete set of allowed states.

Inside the box, where $U=0$, the time-independent Schrödinger equation reduces to

$$
-\frac{\hbar^2}{2m}
\frac{d^2\psi}{dx^2}
=
E\psi.
$$

This equation asks for functions whose second derivative is proportional to the negative of the original function. Sine and cosine functions have exactly that behavior. But the wall at $x=0$ requires

$$
\psi(0)=0.
$$

A cosine term would not vanish at $x=0$, so the allowed shapes must be sine waves. The second wall at $x=L$ then requires the sine wave to vanish there too. That only happens when an integer number of half-wavelengths fits into the box:

$$
L=\frac{n\lambda_n}{2},
\qquad
n=1,2,3,\ldots
$$

So the allowed wavelengths are

$$
\lambda_n=\frac{2L}{n}.
$$

This is the central mechanism of quantization in the box. The particle is not assigned arbitrary wavelengths. The walls force nodes at both ends, and only standing waves that fit between those nodes are allowed.

[Interactive visual: standing waves in an infinite box — the student changes $n$ and sees which sine waves fit between $x=0$ and $x=L$; the visual highlights nodes at both walls and the condition $L=n\lambda_n/2$]

The corresponding spatial wave functions are

$$
\psi_n(x)=A\sin\left(\frac{n\pi x}{L}\right),
\qquad
n=1,2,3,\ldots
$$

where $A$ is a normalization constant. There is no $n=0$ state. If $n=0$, then

$$
\psi_0(x)=A\sin(0)=0
$$

everywhere, which represents no particle at all. The lowest allowed state is therefore $n=1$, not $n=0$.

The allowed wavelengths now determine allowed momenta. From the De Broglie relation,

$$
p=\frac{h}{\lambda}.
$$

Using

$$
\lambda_n=\frac{2L}{n},
$$

we get

$$
p_n=\frac{h}{\lambda_n}
=
\frac{nh}{2L}.
$$

Inside the box the particle has no potential energy, so its energy is kinetic:

$$
E_n=\frac{p_n^2}{2m}.
$$

Substituting $p_n=nh/(2L)$ gives

$$
E_n
=
\frac{1}{2m}
\left(\frac{nh}{2L}\right)^2
=
\frac{n^2h^2}{8mL^2}.
$$

Equivalently, using $\hbar=h/(2\pi)$,

$$
E_n=
\frac{n^2\pi^2\hbar^2}{2mL^2}.
$$

These are the allowed energy levels of a particle in a one-dimensional infinite box.

This result is not just a formula to plug into. It says why confinement creates quantization. The walls force the wave function into standing-wave shapes. Standing-wave shapes allow only certain wavelengths. Certain wavelengths give certain momenta. Certain momenta give certain kinetic energies. The energy is discrete because the wave has to fit.

The formula also shows how the physical size of the box matters. Since

$$
E_n=\frac{n^2h^2}{8mL^2},
$$

smaller $L$ gives larger energies and larger energy spacing. A tightly confined particle has a strongly curved wave function, and curvature corresponds to kinetic energy. A lighter particle also has larger level spacing, because the same confinement produces more kinetic energy for smaller $m$.

[Interactive visual: particle-in-a-box energy ladder — the student changes $L$, $m$, and $n$; the visual shows $E_n=n^2h^2/(8mL^2)$, emphasizing that smaller boxes and lighter particles produce larger energy spacing]

The lowest energy is not zero. For $n=1$,

$$
E_1=\frac{h^2}{8mL^2}.
$$

This is the ground-state energy. A zero-energy state would mean zero momentum and an infinite wavelength, but an infinite wavelength cannot fit between two walls while also being zero at both walls. So the particle cannot simply sit motionless in the box. Confinement forces nonzero kinetic energy.

This repairs a common classical misconception. A particle in a box is not a tiny ball bouncing between two walls with some hidden path. In a stationary state, the probability density is fixed in time. The particle is detected at one location when measured, but the theory predicts the distribution of many such detections, not a classical trajectory.

To find that distribution, the wave functions must be normalized. The normalized spatial wave functions for the infinite box are

$$
\psi_n(x)=\sqrt{\frac{2}{L}}
\sin\left(\frac{n\pi x}{L}\right),
\qquad
0<x<L.
$$

The factor

$$
\sqrt{\frac{2}{L}}
$$

is chosen so that the total probability inside the box equals one:

$$
\int_0^L |\psi_n(x)|^2\,dx=1.
$$

The probability density is

$$
|\psi_n(x)|^2
=
\frac{2}{L}
\sin^2\left(\frac{n\pi x}{L}\right).
$$

For $n=1$, the probability density is largest near the center and zero at the walls. For $n=2$, there is also a node at the center, so the probability of finding the particle exactly at $x=L/2$ is zero in that state. These nodes are not classical turning points. They are places where the probability amplitude vanishes.

[Interactive visual: box wave functions and probability densities — the student selects $n$ and sees $\psi_n(x)$ together with $|\psi_n(x)|^2$; the visual highlights nodes, antinodes, and the normalized area under $|\psi_n|^2$]

Higher $n$ should not be interpreted as simply “larger amplitude.” The wave functions are normalized, so the total probability remains one for every allowed state. Higher $n$ means more nodes, shorter wavelength, larger momentum magnitude, and higher energy. The amplitude factor stays fixed by normalization; the spatial oscillation changes.

The same energy-level structure explains photon emission or absorption in a confined system. If the particle moves from an upper level $n_U$ to a lower level $n_L$, the system loses energy

$$
\Delta E=E_{n_U}-E_{n_L}.
$$

A photon emitted in that transition has energy

$$
hf=\Delta E.
$$

Using

$$
E_n=\frac{n^2h^2}{8mL^2},
$$

the transition energy becomes

$$
\Delta E
=
\frac{h^2}{8mL^2}
\left(n_U^2-n_L^2\right).
$$

This is the same basic logic as atomic spectra: photons correspond to differences between allowed energy levels. The difference is that here the levels arise from a particle fitting as a standing wave inside a one-dimensional box.

The time-independent Schrödinger equation therefore turns the probability interpretation of $\psi$ into a method for finding allowed states. We began with the need to find spatial wave functions in a potential. Stationary states allowed the separation

$$
\Psi(x,t)=\psi(x)e^{-iEt/\hbar},
$$

which led to

$$
-\frac{\hbar^2}{2m}
\frac{d^2\psi}{dx^2}
+
U(x)\psi
=
E\psi.
$$

In the infinite box, the walls forced $\psi(0)=\psi(L)=0$, so only standing waves fitting the box were allowed. Those standing waves produced discrete wave functions,

$$
\psi_n(x)=\sqrt{\frac{2}{L}}
\sin\left(\frac{n\pi x}{L}\right),
$$

and discrete energies,

$$
E_n=\frac{n^2h^2}{8mL^2}.
$$

The core lesson is that boundary conditions create quantized states. The next subsection weakens the idealization of infinitely high walls. Real barriers are finite, and finite barriers lead naturally to wave-function penetration, finite wells, and tunneling.
