---
title: "4) Wave-particle duality, probability amplitudes, and uncertainty"
date: "2026-06-28T18:24:43.038Z"
source: "user-note"
knowledge_type: "user-note"
---

## Wave-particle duality, probability amplitudes, and uncertainty

The photoelectric effect, X-ray production, and Compton scattering all forced us to treat light as something that can exchange energy and momentum in localized packets. A photon can eject an electron from a metal, be produced when a fast electron is slowed down, and scatter from an electron like a collision partner. If we only looked at those phenomena, it would be tempting to say that light is simply made of tiny particles.

But that conclusion would be too fast. Light also shows interference and diffraction, which are wave phenomena. In interference, different parts of a wave overlap and can reinforce or cancel. In diffraction, a wave spreads after passing through an opening. These effects were central in the previous module, and they cannot be explained by imagining light as a stream of ordinary classical bullets. So the problem is not that light was first thought to be a wave and then corrected to be a particle. The problem is deeper: neither classical picture is complete.

The double-slit experiment makes this conflict unavoidable. Imagine sending objects toward a barrier with two narrow openings and a screen behind it. If classical bullets are fired through the slits, each bullet passes through one slit or the other, and the screen eventually shows two main impact regions. If water waves pass through the slits, each slit becomes a source of waves, and the overlapping waves create an interference pattern of maxima and minima. Now send photons, or electrons, one at a time. Each individual arrival is localized: one dot appears on the screen. But after many arrivals, the dots build up an interference pattern.

[Interactive visual: bullets, waves, and electrons through two slits — the student switches between classical bullets, classical waves, and one-at-a-time electrons; the visual shows two bands for bullets, a continuous interference pattern for waves, and individual dots gradually building an interference pattern for electrons]

This result cannot be explained by ordinary particle probability. If each electron simply went through slit 1 or slit 2 as an ordinary particle, and if we merely did not know which slit it used, then the final distribution would be the probability pattern from slit 1 plus the probability pattern from slit 2. That would produce a particle-like two-band distribution. It would not produce alternating bright and dark interference bands. Interference requires cancellation as well as reinforcement, and ordinary probabilities do not cancel.

Quantum mechanics therefore introduces a quantity that comes before probability: the **probability amplitude**. We will write a probability amplitude as $\phi$. The amplitude itself is not directly the measured probability. Instead, the probability $P$ of an event is obtained from the absolute square of the amplitude:

$$
P = |\phi|^2.
$$

This is the mathematical centerpiece of the subsection. It says that quantum mechanics does not assign probabilities in the same first step that classical statistics does. It assigns amplitudes first. These amplitudes can carry phase information, so they can add constructively or destructively. Only after the relevant amplitudes have been combined do we calculate the probability by taking $|\phi|^2$.

For the double-slit experiment, this distinction matters immediately. Suppose $\phi_1$ is the amplitude for arriving at a certain point on the screen by the alternative associated with slit 1, and $\phi_2$ is the amplitude for arriving there by the alternative associated with slit 2. If the experiment does not reveal which slit was used, the alternatives are indistinguishable. In that case, quantum mechanics says to add the amplitudes first:

$$
\phi = \phi_1 + \phi_2,
$$

and then calculate the probability:

$$
P = |\phi_1 + \phi_2|^2.
$$

Because $\phi_1$ and $\phi_2$ can have different phases, their sum can be large at some points and small at others. Where they reinforce, detections are likely. Where they cancel, detections are unlikely. That is how localized dots can gradually build an interference pattern.

This is also where a common misconception must be repaired. The electron is not being treated as a tiny classical ball that literally splits into two half-electrons. Nor is it simply a classical wave spread out in space like a water wave. What combines are the probability amplitudes for the alternatives. The individual detection remains localized, but the distribution of many detections is controlled by amplitude interference.

Now change the experiment. Place a detector at the slits so that it is possible to know which slit the electron used. Once the alternatives become distinguishable, the interference pattern disappears. The rule changes: we no longer add amplitudes for indistinguishable alternatives. We add the probabilities for distinguishable alternatives:

$$
P = P_1 + P_2 = |\phi_1|^2 + |\phi_2|^2.
$$

This gives a particle-like distribution rather than an interference pattern. The important point is not that the detector is badly built or that it accidentally disturbs the electron in a merely technical way. The point is that the measurement changes what kind of information is physically available. If the experiment is arranged so that path information exists, then the phase relation needed for interference no longer produces the same pattern.

[Interactive visual: which-slit measurement — the student toggles a detector at the slits; with no detector, amplitudes add and an interference pattern builds up, while with a detector, probabilities add and the interference disappears]

This is the idea behind **complementarity**. Wave-like and particle-like descriptions are both useful, but they answer different experimental questions. If the experiment is arranged to reveal interference, the wave-like amplitude description is essential. If it is arranged to reveal which path was taken, the particle-like path description becomes meaningful, but the interference pattern is lost. The mistake is to demand a fully classical trajectory and a fully classical interference wave at the same time.

The uncertainty principle is the quantitative version of this limitation. In classical mechanics, we imagine that a particle has an exact position and an exact momentum at the same time, even if our instruments are imperfect. Quantum mechanics does not allow that ideal for microscopic objects. If $\Delta x$ is the uncertainty in position and $\Delta p$ is the uncertainty in momentum, then

$$
\Delta x\,\Delta p \geq \frac{\hbar}{2},
$$

where

$$
\hbar = \frac{h}{2\pi}
$$

is the reduced Planck constant. This relation says that position and momentum cannot both be made arbitrarily precise. If we force $\Delta x$ to become small, meaning we localize the particle more sharply, then $\Delta p$ must become larger. If we make momentum more sharply defined, position becomes less sharply defined.

This connects directly back to the double slit. Finding out which slit the electron passed through is a form of position information. The more strongly the experiment localizes the electron’s path, the less the original interference behavior survives. In a related diffraction picture, narrowing the opening makes the particle’s transverse position more certain, but the outgoing momentum direction spreads out more. The uncertainty relation is therefore not just a statement about poor instruments. It expresses a real limitation in the simultaneous physical meaning of position and momentum.

[Interactive visual: uncertainty through a slit — the student narrows the slit width $\Delta x$ and observes the outgoing momentum spread $\Delta p$ increase, showing why $\Delta x\Delta p \geq \hbar/2$]

There is a second uncertainty relation involving energy and time:

$$
\Delta t\,\Delta E \geq \frac{\hbar}{2}.
$$

Here $\Delta E$ is the uncertainty in energy and $\Delta t$ is the uncertainty in time. In this course, this relation should be understood as part of the same quantum structure: some pairs of quantities cannot both be made arbitrarily sharp in the same physical description. Its deeper consequences will become more meaningful later, when energy levels, emitted photons, and wave functions are discussed.

The chain of reasoning is now different from classical physics. We began with the failure of a pure particle picture: localized photons and electrons can still build interference patterns. That required probability amplitudes, with probabilities calculated as $P = |\phi|^2$. The double-slit experiment then showed that indistinguishable alternatives require adding amplitudes, while distinguishable alternatives require adding probabilities. Measurement therefore becomes part of the physical description, not just a passive act of looking. The uncertainty relations express this limitation quantitatively. This prepares the next subsection: if photons can behave like particles while still showing interference, then particles such as electrons should also be able to behave like waves.
