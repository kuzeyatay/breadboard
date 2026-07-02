---
title: "5) Matter waves and De Broglie wavelength"
date: "2026-06-28T18:27:09.992Z"
source: "user-note"
knowledge_type: "user-note"
---

## Matter waves and De Broglie wavelength

The previous subsection ended with a strange asymmetry. Light, which was first understood as a wave, also behaves like particles when it exchanges energy and momentum. A photon can be detected as a localized event, and it carries energy $E=hf$ and momentum $p=h/\lambda$. Once that is accepted, the natural question is whether the reverse can also be true. If waves can behave like particles, can particles behave like waves?

Louis de Broglie proposed that they can. His hypothesis was that the motion of a particle is associated with a **matter wave**. This does not mean that an electron is a tiny water wave or a vibrating string. It means that the quantum state of a moving particle has wave-like properties, and these wave-like properties can produce interference and diffraction. The wavelength associated with a particle is called its **De Broglie wavelength**.

For a particle with momentum $p$, the De Broglie wavelength is

$$
\lambda=\frac{h}{p}.
$$

Equivalently,

$$
p=\frac{h}{\lambda}.
$$

This is the mathematical centerpiece of this subsection. It says that wavelength and momentum are inversely related. A particle with large momentum has a small De Broglie wavelength. A particle with small momentum has a large De Broglie wavelength. The relation mirrors the photon momentum formula $p=h/\lambda$, but De Broglie applied it to matter particles such as electrons, protons, and neutrons.

For a particle with rest mass $m$ moving at nonrelativistic speed $v$, the classical momentum is

$$
p=mv.
$$

Substituting this into the De Broglie relation gives

$$
\lambda=\frac{h}{mv}.
$$

This form is often the most useful starting point for ordinary electron and proton calculations in this module. The caveat matters: $p=mv$ is the nonrelativistic expression. It applies when the particle speed is much smaller than the speed of light, so relativistic corrections can be ignored. If the particle is moving extremely fast, the simple $mv$ momentum expression is no longer sufficient.

The same relation is often written using the wave number $k$, defined by

$$
k=\frac{2\pi}{\lambda}.
$$

Since

$$
\hbar=\frac{h}{2\pi},
$$

we can rewrite

$$
p=\frac{h}{\lambda}
$$

as

$$
p=\hbar k.
$$

This is the same physics in a different notation. The $\lambda$-form emphasizes wavelength. The $k$-form emphasizes wave number, which is useful later because wave functions are often written using expressions involving $kx$. For now, the important idea is that momentum is tied to spatial wave behavior.

[Interactive visual: momentum and De Broglie wavelength — the student changes particle mass and speed and observes how $p=mv$ and $\lambda=h/p$ change; the visual shows that larger mass or larger speed makes the matter wavelength shorter]

There is also a frequency relation associated with the matter wave:

$$
E=hf=\hbar\omega,
$$

where $E$ is the particle energy, $f$ is the frequency, and $\omega=2\pi f$ is angular frequency. This is the same Planck relation used for photons, but for matter particles one must be careful about what energy $E$ refers to. In the simple nonrelativistic problems in this course, we often connect the particle’s motion to its kinetic energy. The wavelength calculation, however, is usually controlled most directly by momentum:

$$
\lambda=\frac{h}{p}.
$$

That distinction prevents a common mistake. For photons, energy and wavelength are connected by

$$
E=\frac{hc}{\lambda}.
$$

For nonrelativistic massive particles, kinetic energy and wavelength are connected differently. Since

$$
K=\frac{1}{2}mv^2
\quad \text{and} \quad
p=mv,
$$

we can also write

$$
K=\frac{p^2}{2m}.
$$

Using $p=h/\lambda$,

$$
K=\frac{h^2}{2m\lambda^2}.
$$

So a photon and an electron with the same energy do not generally have the same wavelength. A photon uses $E=hc/\lambda$, while a nonrelativistic electron uses $K=h^2/(2m\lambda^2)$. The symbols may look similar, but the physical models are different because photons are massless and massive particles are not.

A common practical case is an electron accelerated through a voltage $V$. If the electron starts from rest and gains kinetic energy from the electric field, then

$$
K=eV,
$$

where $e$ is the elementary charge. For a nonrelativistic electron,

$$
K=\frac{p^2}{2m_e},
$$

where $m_e$ is the electron mass. Therefore

$$
p=\sqrt{2m_eK}=\sqrt{2m_e eV}.
$$

The De Broglie wavelength is then

$$
\lambda=\frac{h}{\sqrt{2m_e eV}}.
$$

This formula is not a new principle. It is just the De Broglie relation combined with energy conservation for an accelerated electron. It shows why increasing the accelerating voltage makes the electron wavelength smaller: a larger voltage gives a larger kinetic energy, hence a larger momentum, hence a shorter wavelength.

[Interactive visual: accelerated electron wavelength — the student changes accelerating voltage $V$ and observes $K=eV$, $p=\sqrt{2m_e eV}$, and $\lambda=h/p$; the visual shows why faster electrons have shorter wavelengths]

The strongest evidence for matter waves is diffraction. In ordinary wave physics, diffraction appears when a wave encounters openings or structures with sizes comparable to its wavelength. X-rays diffract from crystals because their wavelengths are comparable to atomic spacings. If electrons really have De Broglie wavelengths, then electrons with suitable momenta should diffract from matter in a similar way.

That is what is observed. Electron diffraction patterns can look like X-ray diffraction patterns. In the course slides, the comparison is made between X-rays passing through aluminium foil and electrons diffracting from aluminium. The scales differ, but the pattern type is the same. This is not what classical particles should do. A stream of tiny classical charged balls would scatter, but it would not produce a wave-like diffraction pattern governed by wavelength. Electron diffraction is therefore direct evidence that electrons have wave-like behavior.

[Interactive visual: X-ray diffraction versus electron diffraction — the student compares a crystal hit by X-rays and by electrons; changing electron momentum changes the De Broglie wavelength and therefore the diffraction pattern]

This also explains why we do not notice matter waves in everyday life. The formula

$$
\lambda=\frac{h}{p}
$$

contains Planck’s constant $h$, which is extremely small. Macroscopic objects have enormous momentum compared with electrons, so their De Broglie wavelengths are fantastically tiny. A walking person, a falling grain of sand, or a thrown ball has a wavelength far too small to produce noticeable diffraction through ordinary openings. Quantum wave behavior is not absent for large objects in the formula, but it is practically invisible because the wavelength is so small.

The inverse relation between momentum and wavelength also creates an important comparison trap. Suppose a proton and an electron move with the same speed $v$. The proton has much larger mass, so its momentum

$$
p=mv
$$

is much larger. Since

$$
\lambda=\frac{h}{p},
$$

the proton’s wavelength is much smaller. If the proton mass is approximately $1836$ times the electron mass, then at the same speed

$$
p_p=1836p_e,
$$

so

$$
\lambda_p=\frac{1}{1836}\lambda_e.
$$

The smaller wavelength does not come from the proton being “less quantum.” It comes from the proton having larger momentum at the same speed.

But if the proton and electron have the same momentum, the conclusion changes. Since the De Broglie wavelength depends directly on momentum,

$$
\lambda=\frac{h}{p},
$$

same momentum means same wavelength, regardless of the particle mass. This is why one must read the condition carefully. “Same speed” and “same momentum” are not equivalent for particles with different masses.

There is one more subtle point about frequency. The relation

$$
E=hf=\hbar\omega
$$

connects energy to temporal wave behavior, while

$$
p=\frac{h}{\lambda}=\hbar k
$$

connects momentum to spatial wave behavior. It is easy to mix these up because both pairs look similar. Frequency and angular frequency describe time oscillation. Wavelength and wave number describe spatial oscillation. This distinction becomes essential later when the wave function is written as a function of both position and time.

Matter waves therefore complete the first version of wave-particle duality. Light, once treated as a wave, must also be described using photons with energy and momentum. Matter, once treated as particles, must also be described using waves with wavelength $\lambda=h/p$. The De Broglie relation explains why electron diffraction exists, why massive everyday objects do not visibly diffract, and why comparing particles requires attention to momentum rather than speed alone. This prepares the next subsection: if electrons have matter waves, then atomic orbits and spectra can be reinterpreted using allowed wavelengths, leading naturally to the Bohr model of the atom.
