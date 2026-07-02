---
title: "1) Why quantum mechanics enters this course"
date: "2026-06-28T18:00:12.494Z"
source: "user-note"
knowledge_type: "user-note"
---

## Why quantum mechanics enters this course

At this point in the course, light already has a wave description. Reflection and refraction can often be drawn with rays, while interference and diffraction force us to think in terms of wavelength, phase, and superposition. That wave picture is not optional: without it, the two-slit pattern, diffraction spreading, and many polarization effects would make no sense. So if light can be treated as a wave so successfully, it is natural to ask why we need a new theory at all.

The reason is that wave optics describes how light propagates, but it does not fully describe how light exchanges energy with matter. A classical wave can have more or less intensity, and it is tempting to imagine that a sufficiently intense light wave should always be able to deliver enough energy to an electron, provided we wait long enough or shine the light brightly enough. The photoelectric effect shows that this is not how microscopic energy transfer works. When light shines on a metal surface, electrons may be emitted, but whether emission is possible depends crucially on the frequency of the light, not merely on the brightness. Below a certain frequency, increasing the intensity does not rescue the effect. Above that frequency, electrons can be emitted.

This is the first place where the old description needs a new rule. The rule is that light exchanges energy with matter in discrete packets called photons. The energy of one photon is

$$
E = hf = \frac{hc}{\lambda}.
$$

Here $E$ is the photon energy, $h$ is Planck’s constant, $f$ is the frequency of the light, $c$ is the speed of light in vacuum, and $\lambda$ is the wavelength of the light in vacuum. The second form follows from the wave relation $c = f\lambda$. This formula says that frequency is not just a wave label; it determines the energy carried by each photon. High-frequency, short-wavelength light has more energy per photon. Low-frequency, long-wavelength light has less energy per photon.

[Interactive visual: photon energy scale — the student changes the wavelength from infrared through visible to ultraviolet and observes how $f$ and $E = hc/\lambda$ change, showing why shorter wavelength means larger photon energy]

This immediately repairs a common wrong intuition. Brightness and photon energy are not the same thing. Increasing intensity means sending more photons per second. Increasing frequency means increasing the energy of each photon. For the photoelectric effect, an electron needs enough energy in one absorption event to escape the metal surface. If $\phi$ denotes the work function, meaning the minimum energy needed to remove an electron from the surface, then emission requires the photon energy to be large enough:

$$
hf \geq \phi.
$$

The full photoelectric-effect equation will come later; here the important point is the mechanism. A dim beam of sufficiently high-frequency light can emit electrons because each photon has enough energy. A very bright beam of too-low-frequency light cannot emit electrons because each individual photon is still too weak. That is the first experimental reason classical wave energy is not enough.

The second reason comes from the atom itself. A classical picture might imagine an atom as a tiny positive nucleus with negative electrons moving around it. But this picture immediately creates a problem. An orbiting electron is an accelerating charge, and accelerating charges radiate electromagnetic waves. Radiation carries energy away. Therefore, in a purely classical model, an electron orbiting a nucleus should lose energy, spiral inward, and collapse into the nucleus. Stable atoms should not exist in the form we observe.

That failure points in the same direction as the photoelectric effect. The problem is not just that light sometimes arrives in packets. Matter itself cannot be understood as ordinary particles following arbitrary classical paths at microscopic scales. Electrons in atoms occupy only certain allowed states, with certain allowed energies. Later, this idea will lead to the Bohr model, discrete spectra, matter waves, wave functions, and the Schrödinger equation. For now, the important conclusion is that microscopic physics needs rules that restrict energy and motion in ways classical mechanics does not.

[Interactive visual: classical atom collapse versus allowed quantum states — the student compares a classical orbiting electron that radiates energy and spirals inward with a diagram of discrete allowed energy levels]

This is why quantum mechanics belongs in a course for electrical engineering. Electrical and photonic devices work by controlling electrons and photons. A photodiode depends on photons transferring energy to electrons. A laser depends on transitions between quantized energy levels and stimulated emission. A semiconductor has allowed and forbidden energy ranges, which is why band gaps matter. A tunnel diode or scanning tunneling microscope depends on a particle having a nonzero chance to appear beyond a barrier that would be forbidden classically. These applications are not separate decorations; they are consequences of the same microscopic rules.

The course will not turn this into a full quantum mechanics course. It will not derive the full Standard Model, solve the complete three-dimensional hydrogen atom, or build the full mathematical machinery used in advanced quantum theory. The goal is narrower: to understand why photons are needed, why particles can behave like waves, why probabilities replace exact microscopic trajectories, why bound systems have discrete energies, and why simple one-dimensional quantum models already explain phenomena that classical physics cannot.

So the need for quantum mechanics enters through a sequence of failures. Wave optics explains propagation, but not the frequency threshold in energy exchange. The photon relation $E = hf = hc/\lambda$ explains why frequency matters. Classical atomic orbits explain neither stability nor discrete spectra, so electrons must be described by allowed quantum states rather than arbitrary classical paths. These ideas prepare the next step: using the photon model quantitatively in the photoelectric effect, where the abstract relation $E = hf$ becomes a direct tool for predicting when electrons are emitted and how much energy they can carry away.
