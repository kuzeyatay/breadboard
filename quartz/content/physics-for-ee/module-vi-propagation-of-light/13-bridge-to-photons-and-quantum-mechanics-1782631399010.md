---
title: "13) Bridge to photons and quantum mechanics"
date: "2026-06-28T07:23:19.010Z"
source: "user-note"
knowledge_type: "user-note"
---

## Bridge to photons and quantum mechanics

The wave description of light has now explained a large part of Module VI. Wavefronts and rays allowed us to understand reflection and refraction. Huygens’s principle showed why ray laws can be derived from wavefront motion. Dispersion, polarization, scattering, interference, and diffraction all depended on wave ideas in different ways. In particular, interference and diffraction made the wave nature of light impossible to ignore, because bright and dark patterns require phase, path difference, and superposition.

That success creates a tempting conclusion: perhaps light is simply a classical wave. But the course does not stop there, because wave propagation is not the only thing light does. Light also interacts with matter. It can be absorbed, emitted, and used to remove electrons from a material. In those interactions, the continuous-wave picture is not enough. The next module begins at exactly this point: light behaves like a wave when it propagates and forms patterns, but it behaves particle-like when it exchanges energy with matter.

The new particle-like unit of light is called a **photon**. A photon is not a tiny classical ball moving along a ray. It is a quantum of electromagnetic radiation: one discrete packet of light energy. The key relation is

$$
E = hf.
$$

Here $E$ is the energy of one photon, $h$ is Planck’s constant, and $f$ is the frequency of the light. Since light in vacuum also satisfies

$$
c = \lambda f,
$$

the photon energy can also be written as

$$
E = \frac{hc}{\lambda}.
$$

This is the mathematical centerpiece of the subsection. It connects the wave variables from Module VI to the photon concept of Module VII. Frequency and wavelength were already used to describe wave propagation; now the same quantities determine the energy of one photon. Higher frequency means larger photon energy. Shorter vacuum wavelength means larger photon energy.

This immediately repairs a major misconception. Higher intensity does not mean that each photon has more energy. At fixed frequency, each photon still has energy $hf$. A more intense beam contains more photons arriving per second, so it can deliver more total energy per second, but it does not increase the energy of each individual photon. To increase the energy per photon, the frequency must increase.

The cleanest experiment showing why this matters is the **photoelectric effect**. Light shines on a metal surface, and electrons may be emitted from the metal. To escape, an electron must receive at least a certain amount of energy, called the **work function** of the material. The work function is written as $\phi$. It is the minimum energy needed to free an electron from that metal.

If one photon gives its energy $hf$ to an electron, then part of that energy is used to overcome the work function. Any remaining energy becomes kinetic energy of the emitted electron. For the fastest emitted electrons,

$$
hf = \phi + K_{\max}.
$$

Equivalently,

$$
K_{\max} = hf - \phi.
$$

Here $K_{\max}$ is the maximum kinetic energy of the emitted electrons. This equation says that the maximum electron energy depends on the photon frequency. If the frequency increases, $hf$ increases, so the emitted electrons can leave with more kinetic energy.

If a stopping potential $V_0$ is applied to stop the fastest electrons, then their maximum kinetic energy is

$$
K_{\max} = eV_0,
$$

where $e$ is the magnitude of the electron charge. Combining this with the photoelectric energy equation gives

$$
eV_0 = hf - \phi.
$$

This form is useful because it connects a measurable voltage to the photon energy. The stopping potential increases with frequency, not with intensity. Increasing intensity at the same frequency can increase the number of emitted electrons per second, but it does not increase $K_{\max}$.

[Interactive visual: photoelectric effect frequency versus intensity — vary light frequency and intensity separately and observe electron emission rate versus maximum electron kinetic energy; this teaches why frequency controls photon energy while intensity controls photon number.]

The same equation also gives a threshold condition. If

$$
hf < \phi,
$$

then one photon does not have enough energy to free an electron. In that case, no electrons are emitted in the simple one-photon picture, no matter how intense the beam is. The threshold frequency occurs when the photon energy is just equal to the work function:

$$
hf_c = \phi.
$$

Therefore,

$$
f_c = \frac{\phi}{h}.
$$

Here $f_c$ is the threshold frequency. For $f < f_c$, the photons are individually too weak to eject electrons. For $f > f_c$, electrons can be emitted, and the excess energy appears as kinetic energy. This threshold behavior is exactly what the purely classical wave picture fails to explain. A classical wave model would suggest that sufficiently intense light, or light applied for a long enough time, should eventually provide enough energy. The experiment instead shows that the frequency of each photon is decisive.

This is the bridge from wave optics to quantum mechanics. The wave model was not thrown away. It remains essential for propagation, interference, diffraction, polarization, and many optical patterns. But when light is absorbed or emitted in individual events, the photon model is necessary. The correct lesson is not “light is only a wave” or “light is only a particle.” The lesson is that different experiments reveal different aspects of light.

This idea is usually called **wave-particle duality**. Interference and diffraction reveal wave-like behavior because alternatives can superpose and produce patterns. The photoelectric effect reveals particle-like behavior because energy is exchanged in packets $hf$. Quantum mechanics is the framework that holds these facts together without forcing light into one classical picture. Later, the course will extend this logic further: particles such as electrons can also show wave-like behavior, and quantum theory will describe outcomes using probability amplitudes rather than definite classical paths.

For now, the important boundary is clear. Module VI used waves to explain how light travels, bends, spreads, and forms patterns. The bridge to Module VII begins when light interacts with matter in discrete energy exchanges. The photon relation

$$
E = hf = \frac{hc}{\lambda}
$$

is the link between the two descriptions: the frequency and wavelength that described the wave also determine the energy of one photon. The photoelectric effect then shows why this matters physically: frequency controls whether each photon has enough energy to free an electron, while intensity controls how many photons arrive. This prepares the next module, where photons, wave-particle duality, uncertainty, and quantum wave functions become the main language.
