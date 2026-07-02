---
title: "7) Lasers and blackbody radiation as quantization applications"
date: "2026-06-28T18:46:22.982Z"
source: "user-note"
knowledge_type: "user-note"
---

## Lasers and blackbody radiation as quantization applications

The Bohr model showed that atoms do not exchange arbitrary amounts of energy with light. An atom emits or absorbs a photon when the photon energy matches the difference between two allowed energy levels:

$$
hf=\Delta E.
$$

Here $h$ is Planck’s constant, $f$ is the photon frequency, and $\Delta E$ is the energy difference between the two atomic states. This rule explains why atomic spectra contain lines instead of a continuous range of colors. It also raises a new question: if atomic transitions produce photons with precise energies, can we control those transitions to produce light with precise properties?

That question leads to lasers. Consider an atom with a lower energy state $A$ and an excited state $A^*$. If the atom is initially in the lower state and a photon with the correct energy arrives, the atom can absorb the photon and move to the excited state:

$$
A+\text{photon}\rightarrow A^*.
$$

The photon must satisfy

$$
hf=E_{A^*}-E_A,
$$

where $E_A$ is the energy of the lower state and $E_{A^*}$ is the energy of the excited state. This is the same exact energy-gap rule from atomic spectra. The atom is not absorbing any random fraction of the beam energy; it is making a transition between discrete states.

An excited atom can also return to the lower state. If it does this without being triggered by an incoming photon, the process is called **spontaneous emission**:

$$
A^*\rightarrow A+\text{photon}.
$$

The emitted photon again has energy

$$
hf=E_{A^*}-E_A.
$$

Spontaneous emission explains why excited atoms can give off light, but it does not by itself produce laser light. Different atoms emit at different times, in different directions, and with unrelated phases. The photons have the correct energy for the transition, but they are not organized into one coherent beam.

The key laser process is **stimulated emission**. Suppose an atom is already in the excited state $A^*$, and a photon with the correct frequency passes by. That incoming photon can stimulate the atom to drop to the lower state and emit another photon:

$$
A^*+\text{photon}\rightarrow A+2\,\text{photons}.
$$

The crucial point is that the emitted photon matches the stimulating photon. It has the same frequency, travels in the same direction, and has the same phase. One organized photon becomes two organized photons. Repeating this process many times amplifies light without destroying its phase relationship. This is why the word laser means **light amplification by stimulated emission of radiation**.

[Interactive visual: stimulated emission — the student sends one photon through excited atoms and observes one photon becoming two photons with the same frequency, direction, and phase]

Stimulated emission explains how light can be amplified, but it does not automatically happen strongly in ordinary matter. In thermal equilibrium, most atoms are in lower energy states, not excited states. If a photon passes through such a material, it is more likely to be absorbed by a lower-state atom than to stimulate emission from an excited atom. So amplification requires a non-equilibrium condition called **population inversion**: more atoms must be available in the relevant excited state than in the lower state.

To create population inversion, energy must be supplied to the laser medium. This is called **pumping**. Pumping raises atoms into excited states. In many laser systems, atoms are first pushed to a higher state and then quickly fall into a longer-lived excited state called a **metastable state**. The word metastable means that the state lasts long enough for many atoms to accumulate there. Once enough atoms are stored in that excited state, a photon of the correct frequency can trigger a chain of stimulated emissions.

A laser cavity makes this chain grow. Mirrors reflect light back and forth through the excited medium, so photons repeatedly pass through atoms that are ready for stimulated emission. Each pass can produce more photons in the same optical mode. One mirror is partially transparent, allowing part of the amplified light to escape as the laser beam. The result is light that is nearly monochromatic, highly directional, and coherent.

[Interactive visual: laser cavity and population inversion — the student pumps atoms into a metastable state, adjusts mirror reflectivity, and sees coherent light build through repeated stimulated emission]

This is the point where a common misconception should be corrected. A laser is not special merely because it is bright. Brightness means high intensity, but laser light is special because of coherence and directionality. The photons are coordinated: they have nearly the same frequency, phase, and direction. Stimulated emission is the mechanism that produces this coordination.

A laser is therefore the controlled case of quantized emission. A chosen energy gap sets the photon frequency,

$$
f=\frac{\Delta E}{h},
$$

and the device is engineered so that many atoms emit photons into the same organized mode. Blackbody radiation looks very different at first, because it is not organized into one narrow beam. A hot object emits a broad range of wavelengths in many directions. Yet the same quantum idea is still needed, because the radiation comes from microscopic energy exchange between matter and electromagnetic modes.

A **blackbody** is an idealized object that absorbs all incoming radiation and emits radiation according only to its temperature. Instead of producing isolated spectral lines like a dilute gas, a hot dense object emits a continuous spectrum. The emitted intensity depends on wavelength, so we describe it using a spectral distribution $I(\lambda)$, where $\lambda$ is wavelength. The total emitted intensity is the area under this curve:

$$
I=\int_0^\infty I(\lambda)\,d\lambda.
$$

Experimentally, the total intensity follows the **Stefan–Boltzmann law**:

$$
I=\sigma T^4.
$$

Here $I$ is the total radiated power per unit area, $T$ is the absolute temperature in kelvin, and $\sigma$ is the Stefan–Boltzmann constant. The fourth power is physically important: increasing the temperature even moderately can greatly increase the total emitted radiation.

[Interactive visual: blackbody area under the curve — the student changes temperature $T$ and sees the whole spectrum $I(\lambda)$ rise so that the total area grows like $T^4$]

Temperature also determines where the spectrum is strongest. The wavelength at which the blackbody curve reaches its maximum is called $\lambda_m$. The observed relation is **Wien’s displacement law**:

$$
\lambda_m T=2.90\times10^{-3}\,\mathrm{m\,K}.
$$

This says that hotter objects peak at shorter wavelengths. If $T$ increases, $\lambda_m$ decreases. This is why cooler glowing objects look redder, while hotter objects shift toward shorter wavelengths and can appear whiter or bluer. But the peak wavelength is not the only wavelength emitted. A blackbody emits a continuous range of wavelengths; $\lambda_m$ only marks the maximum of the curve.

[Interactive visual: blackbody spectrum and peak shift — the student changes $T$ and watches the continuous spectrum move upward and left, showing $I=\sigma T^4$ and $\lambda_mT=2.90\times10^{-3}\,\mathrm{m\,K}$]

Classical physics could describe some parts of this radiation curve, but it failed badly at short wavelengths. If electromagnetic energy were shared continuously among all possible modes, the classical prediction would grow without bound as wavelength became very small. This impossible result is called the **ultraviolet catastrophe**. It would mean that hot objects emit an infinite or enormously excessive amount of short-wavelength radiation, which is not observed.

Planck repaired this by changing the allowed energies of the microscopic oscillators that exchange energy with radiation. Instead of allowing an oscillator of frequency $f$ to have any energy, Planck proposed that its energies are restricted to

$$
E_n=nhf,
\qquad n=0,1,2,\ldots
$$

where $n$ is a nonnegative integer. This is the mathematical centerpiece of the blackbody part of the subsection. Energy exchange is quantized in steps of size $hf$. For low-frequency modes, the step size is small. For high-frequency modes, the step size is large. At a given temperature, very high-frequency modes are therefore difficult to excite, because each energy step costs a large amount of energy. This suppresses the short-wavelength part of the spectrum and removes the ultraviolet catastrophe.

This is the same quantum principle as before, but used in a different physical situation. In a laser, a selected atomic energy gap produces photons of one controlled frequency, and stimulated emission organizes those photons into a coherent beam. In blackbody radiation, many microscopic emitters and electromagnetic modes contribute thermally, producing a continuous spectrum. Quantization does not always produce isolated spectral lines. It means that microscopic energy exchange occurs in discrete amounts, while the macroscopic pattern depends on how many states, modes, and emitters are involved.

The two applications therefore show opposite sides of the same idea. A laser is quantized emission made orderly: population inversion and stimulated emission turn a chosen energy gap into coherent light. Blackbody radiation is quantized thermal emission made collective: many microscopic modes produce a continuous spectrum, but Planck’s energy steps $E_n=nhf$ prevent the classical ultraviolet catastrophe and explain the observed curve together with $I=\sigma T^4$ and $\lambda_mT=2.90\times10^{-3}\,\mathrm{m\,K}$. We began with atomic transitions, used them to understand controlled light amplification, and then extended the same quantization principle to thermal radiation. This prepares the next subsection, where matter waves are no longer treated only as a wavelength idea but become a mathematical equation for quantum states: the Schrödinger equation.
