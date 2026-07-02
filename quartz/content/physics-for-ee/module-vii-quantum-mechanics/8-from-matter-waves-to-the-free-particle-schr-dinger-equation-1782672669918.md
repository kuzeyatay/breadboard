---
title: "8) From matter waves to the free-particle Schrödinger equation"
date: "2026-06-28T18:51:09.918Z"
source: "user-note"
knowledge_type: "user-note"
---

## From matter waves to the free-particle Schrödinger equation

The De Broglie relation gave matter a wavelength:

$$
\lambda=\frac{h}{p}.
$$

This relation is already a major step away from classical mechanics. It says that a moving electron, proton, or other matter particle is associated with a wave-like spatial scale. But by itself, it is not yet a complete quantum theory. A wavelength tells us how rapidly something oscillates in space; it does not tell us how the quantum state changes in time. To describe motion, we need more than a wavelength relation. We need an equation of evolution.

In classical mechanics, Newton’s second law plays that role. Given the forces, it tells us how a particle’s position changes with time. In quantum mechanics, the evolving object is not a definite classical trajectory $x(t)$. The evolving object is a **wave function**, written

$$
\Psi(x,t),
$$

where $x$ is position and $t$ is time. At this point, $\Psi$ should be understood as a probability amplitude: it contains the information from which probabilities will later be calculated. It is not a visible displacement of matter, like the height of a water wave or the vertical displacement of a string. Its full interpretation belongs to the next subsection, but here we need its wave character.

The simplest possible matter wave is one with a single wavelength and a single frequency. Such a wave is written

$$
\Psi(x,t)=A e^{i(kx-\omega t)}.
$$

Here $A$ is a constant amplitude, $i$ is the imaginary unit, $k$ is the wave number, and $\omega$ is the angular frequency. The wave number tells us how rapidly the phase changes with position:

$$
k=\frac{2\pi}{\lambda}.
$$

The angular frequency tells us how rapidly the phase changes with time:

$$
\omega=2\pi f.
$$

The complex exponential may look unfamiliar, but it is useful because it represents an oscillating wave while keeping track of phase. Quantum mechanics uses complex wave functions because phase is essential for interference. What is measured is not the complex value of $\Psi$ directly; measurable probabilities come from expressions such as $|\Psi|^2$, which will be developed in the next subsection.

The symbols $k$ and $\omega$ are not merely wave labels. For matter waves, they are tied directly to momentum and energy. From the De Broglie relation,

$$
p=\frac{h}{\lambda}.
$$

Using $k=2\pi/\lambda$ and $\hbar=h/(2\pi)$, this becomes

$$
p=\hbar k.
$$

Similarly, from Planck’s relation,

$$
E=hf,
$$

and using $\omega=2\pi f$, we get

$$
E=\hbar\omega.
$$

So a matter wave with large $k$ has large momentum, and a matter wave with large $\omega$ has large energy. Spatial oscillation is linked to momentum; time oscillation is linked to energy.

[Interactive visual: matter-wave phase — the student changes $k$ and $\omega$ in $\Psi=Ae^{i(kx-\omega t)}$; the visual shows that larger $k$ means shorter wavelength and larger momentum, while larger $\omega$ means faster time oscillation and larger energy]

Now restrict attention to a **free particle**. A free particle is a particle moving in a region with no force and no changing potential energy. In this subsection, that means

$$
U=0.
$$

For a nonrelativistic free particle of mass $m$, the total energy is just kinetic energy:

$$
E=K=\frac{p^2}{2m}.
$$

This equation is the bridge between classical mechanics and the quantum wave description. The quantum wave relations say

$$
E=\hbar\omega,
\qquad
p=\hbar k.
$$

The free-particle energy relation says

$$
E=\frac{p^2}{2m}.
$$

Putting these together gives

$$
\hbar\omega=\frac{(\hbar k)^2}{2m},
$$

or

$$
\omega=\frac{\hbar k^2}{2m}.
$$

This is the free-particle dispersion relation. It tells us which angular frequency $\omega$ must go with each wave number $k$. The important feature is the square: $\omega$ is proportional to $k^2$. That comes from kinetic energy being proportional to $p^2$.

But a dispersion relation is still not the final goal. It tells us what relation a valid free-particle wave must satisfy, but it does not yet give us an equation that can act on a general wave function. We want a differential equation whose plane-wave solutions automatically obey

$$
E=\frac{p^2}{2m}.
$$

The reason derivatives appear is that derivatives detect how rapidly a wave changes. For the plane wave

$$
\Psi(x,t)=A e^{i(kx-\omega t)},
$$

a time derivative brings down a factor involving $\omega$:

$$
\frac{\partial \Psi}{\partial t}=-i\omega\Psi.
$$

If we multiply by $i\hbar$, we get

$$
i\hbar\frac{\partial \Psi}{\partial t}=\hbar\omega\Psi.
$$

Since $E=\hbar\omega$, the left-hand operation acts like extracting the energy:

$$
i\hbar\frac{\partial \Psi}{\partial t}=E\Psi.
$$

A spatial derivative brings down a factor involving $k$. Because kinetic energy depends on $p^2$, and $p=\hbar k$, we need $k^2$. That is why the second spatial derivative appears:

$$
\frac{\partial^2\Psi}{\partial x^2}=-k^2\Psi.
$$

Multiplying by $-\hbar^2/(2m)$ gives

$$
-\frac{\hbar^2}{2m}\frac{\partial^2\Psi}{\partial x^2}=\frac{\hbar^2 k^2}{2m}\Psi.
$$

Since $p=\hbar k$, this is

$$
-\frac{\hbar^2}{2m}\frac{\partial^2\Psi}{\partial x^2}=\frac{p^2}{2m}\Psi.
$$

For a free particle,

$$
\frac{p^2}{2m}=E,
$$

so the spatial operation also gives

$$
-\frac{\hbar^2}{2m}\frac{\partial^2\Psi}{\partial x^2}=E\Psi.
$$

Now the structure of the equation becomes inevitable. The time-changing side gives the total energy of the free particle. The curvature-in-space side gives the kinetic energy of the free particle. Since these are the same energy, the two expressions are set equal:

$$
i\hbar\frac{\partial \Psi}{\partial t}=-\frac{\hbar^2}{2m}\frac{\partial^2\Psi}{\partial x^2}.
$$

This is the **time-dependent Schrödinger equation for a free particle in one dimension**. It is the mathematical centerpiece of this subsection. It is not guessed randomly. It is built so that matter waves obey the quantum relations

$$
E=\hbar\omega,
\qquad
p=\hbar k,
$$

while also obeying the nonrelativistic free-particle energy relation

$$
E=\frac{p^2}{2m}.
$$

[Interactive visual: free-particle Schrödinger equation builder — the student applies $i\hbar\partial/\partial t$ and $-\hbar^2/(2m)\partial^2/\partial x^2$ to $\Psi=Ae^{i(kx-\omega t)}$; the visual shows energy emerging from the time derivative and kinetic energy emerging from spatial curvature]

The shape of the equation is important. The left-hand side,

$$
i\hbar\frac{\partial \Psi}{\partial t},
$$

describes how the wave function evolves in time. The right-hand side,

$$
-\frac{\hbar^2}{2m}\frac{\partial^2\Psi}{\partial x^2},
$$

is the kinetic-energy part. The second derivative measures curvature. A wave with a short wavelength bends rapidly as a function of position, so it has large curvature, large $k$, large momentum, and therefore large kinetic energy.

This repairs a common misconception. The Schrödinger equation is not just the ordinary classical wave equation reused for particles. A simple classical wave equation often contains a second time derivative and a second space derivative. The free-particle Schrödinger equation contains a first time derivative and a second space derivative. That structure reflects the quantum energy relations: energy is proportional to $\omega$, while kinetic energy is proportional to $p^2$, and momentum is proportional to $k$. First order in $\omega$ leads to first order in time; second order in $k$ leads to second order in space.

It is also important not to overinterpret the plane wave solution. The wave

$$
\Psi(x,t)=A e^{i(kx-\omega t)}
$$

has a definite momentum because it has one definite $k$. It also has a definite energy because it has one definite $\omega$. But it extends through all space. It is not a localized particle sitting somewhere. A localized particle is represented by a wave packet, made by combining many waves with different $k$-values. That idea belongs to the next subsection, where the meaning of $\Psi$, $|\Psi|^2$, normalization, and wave packets will be treated directly.

So the path from matter waves to Schrödinger’s equation is a path from wavelength to dynamics. De Broglie gave the spatial relation $\lambda=h/p$. Writing the simplest matter wave as $\Psi=Ae^{i(kx-\omega t)}$ allowed momentum and energy to be encoded as $p=\hbar k$ and $E=\hbar\omega$. For a free nonrelativistic particle, the classical-looking energy relation $E=p^2/(2m)$ then forced an equation with a first time derivative and a second space derivative:

$$
i\hbar\frac{\partial \Psi}{\partial t}=-\frac{\hbar^2}{2m}\frac{\partial^2\Psi}{\partial x^2}.
$$

This prepares the next step: understanding what the wave function means physically, why $|\Psi|^2$ becomes a probability density, and why localized quantum particles require wave packets rather than single infinite plane waves.
