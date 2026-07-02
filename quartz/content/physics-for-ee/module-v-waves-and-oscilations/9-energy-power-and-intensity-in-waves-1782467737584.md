---
title: "9) Energy, power, and intensity in waves"
date: "2026-06-26T09:55:37.585Z"
source: "user-note"
knowledge_type: "user-note"
tags: ["average-power-measures-energy-crossing-a-point", "intensity-measures-power-per-unit-area", "string-power-depends-on-density-and-tension", "amplitude-differs-from-intensity", "faster-waves-are-not-automatically-more-powerful", "particle-velocity-differs-from-wave-speed", "wave-power-scales-with-amplitude-squared", "sinusoidal-wave-power-uses-cycle-average", "spreading-energy-lowers-wave-intensity", "string-waves-carry-kinetic-and-elastic-energy", "wave-power-scales-with-frequency-squared", "waves-transport-energy-without-transporting-medium"]
---

## Energy, power, and intensity in waves

The wave equation showed how a disturbance can propagate through a string. Curvature produces transverse acceleration, and the speed of the disturbance is set by the tension $F$ and the mass per unit length $\mu$. But propagation is not only a matter of shape. When a wave travels, something physically important travels with it: mechanical energy. A hand that shakes the end of a string does work on the string, and that energy is then passed along from one part of the string to the next.

This is the point where waves differ from a single isolated oscillator in a useful way. In a mass-spring oscillator, energy stays in one system and changes form between kinetic energy and potential energy. In a travelling wave, each small piece of the medium may still have kinetic and potential energy, but the disturbance carries energy through space. A point on the string does not travel along the string with the wave, yet energy does travel along the string. This is why the earlier distinction between material motion and wave motion matters: waves can transport energy without transporting the medium as a whole.

For a transverse wave on a string, the kinetic part of the energy is easy to recognize. Each small segment of string moves up and down, so it has kinetic energy. If $y(x,t)$ is the transverse displacement of the string, then the transverse velocity of a point of the string is

$$
v_y = \frac{\partial y}{\partial t}.
$$

Here $v_y$ is not the wave speed along the string. It is the vertical velocity of a small piece of string. This distinction is essential. The wave speed $v$ tells how fast the pattern travels in the $x$-direction. The particle velocity $v_y$ tells how fast a piece of the string moves transversely. They are different quantities, even though both are speeds.

A travelling wave also stores elastic potential energy because the string is stretched slightly as it bends. Where the string has slope, neighboring pieces of the string are displaced relative to one another, and the tension stores energy in that deformation. Thus a travelling wave on a string carries energy in two linked forms: kinetic energy from the motion of the string elements and potential energy from the deformation of the string.

![pasted 1782468063714](/physics-for-ee/assets/pasted-1782468063714.png)

To measure energy transport, we do not usually ask only how much energy exists in one small piece of the string. We ask how rapidly energy passes along the string. That rate is **power**:

$$
P = \frac{dE}{dt}.
$$

For a travelling wave, power means the rate at which mechanical energy crosses a chosen point on the string. A sinusoidal wave does not deliver energy at exactly the same rate at every instant, because the string elements are continually changing their velocity and deformation. Therefore the most useful quantity is the average power over one or many cycles.

Before writing the formula, its structure should make physical sense. A string with larger mass per unit length $\mu$ has more moving material per metre, so more energy is involved. A wave with larger amplitude $A$ makes the string elements move farther from equilibrium. A wave with larger angular frequency $\omega$ makes those elements move faster. Finally, the wave speed $v$ matters because energy is carried past a point more quickly when the disturbance propagates faster. For a sinusoidal transverse wave on a string, these dependencies combine into

$$
P_{\text{avg}} = \frac{1}{2}\mu v\omega^2 A^2.
$$

Here $P_{\text{avg}}$ is the average power carried by the wave, $\mu$ is the mass per unit length of the string, $v$ is the wave speed along the string, $\omega$ is the angular frequency, and $A$ is the displacement amplitude.

Since waves on a string travel at

$$
v = \sqrt{\frac{F}{\mu}},
$$

where $F$ is the string tension, the same average power can also be written as

$$
P_{\text{avg}} = \frac{1}{2}\sqrt{\mu F}\,\omega^2 A^2.
$$

This is the central power formula for a sinusoidal wave on an ideal string. It should be read as a statement about energy transport, not just as an algebraic expression. The power increases when the string has more mass per unit length, because more moving material carries energy. It increases when the tension is larger, because stronger tension allows energy to be transmitted more rapidly along the string. Most noticeably, it increases with the square of both angular frequency and amplitude.

The square dependence on amplitude is especially important. Doubling the amplitude does not double the average power; it makes the average power four times as large. This is the same kind of square dependence seen in the energy of a simple harmonic oscillator, where energy is proportional to $A^2$. A wave with larger amplitude makes each part of the medium move farther from equilibrium, so more energy is involved.

The square dependence on angular frequency also has a clear meaning. For the same amplitude, a higher-frequency wave makes each piece of string move up and down more rapidly. Since kinetic energy depends on speed squared, faster oscillation means much more energy transported per second. This is why $P_{\text{avg}}$ contains $\omega^2$, not just $\omega$.

![pasted 1782468184876](/physics-for-ee/assets/pasted-1782468184876.png)

This formula also repairs a common misconception about wave speed and power. A faster wave is not automatically more powerful just because it is faster. The power depends on how much energy the wave carries and how quickly that energy passes a point. For a sinusoidal string wave, the relevant quantities are amplitude, angular frequency, mass per unit length, and tension. The wave speed is part of the formula, but it is not the only factor. A small-amplitude wave travelling quickly may carry less power than a larger-amplitude wave travelling more slowly.

The appearance of average power also needs interpretation. At a particular instant, the rate of energy flow can vary because different parts of the wave are at different stages of motion. Over a full cycle, however, the repeating pattern gives a stable average. That is why the formula is written as $P_{\text{avg}}$. It describes the average rate of energy transport for a sinusoidal travelling wave, not the instantaneous power at every point and every moment.

For a string, power is naturally described as energy passing a point along a one-dimensional medium. But many waves are not confined to a single line. Sound can spread through air, water waves can spread across a surface, and other mechanical waves may distribute their energy over a growing region. Then the question becomes not only “how much power is carried?” but “over how much area is that power spread?”

That leads to **intensity**, defined as average power per unit area:

$$
I = \frac{P_{\text{avg}}}{S}.
$$

Here $I$ is intensity, $P_{\text{avg}}$ is the average power crossing a surface, and $S$ is the area of that surface. Intensity measures how concentrated the energy flow is. The same power spread over a large area gives a smaller intensity; the same power concentrated through a small area gives a larger intensity.

This definition should not be confused with amplitude. Amplitude describes the size of the displacement or disturbance. Intensity describes the rate of energy flow per unit area. In many simple wave models, intensity is related to the square of the amplitude, but it is not the same physical quantity as amplitude. Amplitude is measured in units of displacement, such as metres for a transverse string wave. Intensity is measured in watts per square metre.

For a wave on a string, it is usually more natural to speak of power carried along the string than of intensity through an area, because the string is effectively a one-dimensional medium. For waves spreading through air, water, or another extended medium, intensity becomes the more natural quantity because the energy may pass through a surface. The detailed geometry of spreading, reflection, and interference belongs later. The essential idea here is simpler: power tells how rapidly a wave transports energy, and intensity tells how concentrated that transported power is over an area.

We started from a question left open by the wave equation. The wave equation explains how a disturbance propagates, but a physical wave is more than a moving shape: it is a mechanism for transporting mechanical energy. On a string, that energy appears as kinetic energy of moving string elements and elastic potential energy from deformation. Describing how quickly this energy passes a point led to average power, with

$$
P_{\text{avg}} = \frac{1}{2}\mu v\omega^2 A^2 = \frac{1}{2}\sqrt{\mu F}\,\omega^2 A^2
$$

for a sinusoidal wave on an ideal string. Extending the same energy-flow idea to waves spread over an area led to intensity,

$$
I = \frac{P_{\text{avg}}}{S}.
$$

The section therefore turns the idea “waves carry energy” into measurable quantities. This prepares the next subsection, where waves meet boundaries and other waves, so the transported energy and the displacement pattern must be understood together through reflection and superposition.
