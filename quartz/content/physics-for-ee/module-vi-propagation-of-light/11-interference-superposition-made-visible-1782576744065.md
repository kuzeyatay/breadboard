---
title: "11) Interference: superposition made visible"
date: "2026-06-27T16:12:24.065Z"
source: "user-note"
knowledge_type: "user-note"
---

## Interference: superposition made visible

So far, light has mostly been described by asking how one beam changes direction: a ray reflects, refracts, scatters, or follows a path through a material. Interference begins from a different question. What happens when two light waves arrive at the same place at the same time? Because light is a wave, the answer is not found by treating the two beams as independent streams of particles. The waves overlap, their fields add, and the result can be brighter in some places and darker in others.

The basic rule is the **principle of superposition**. When two waves overlap, the resulting disturbance at a point is the sum of the disturbances that each wave would produce there separately. If the two wave disturbances are $y_1$ and $y_2$, then

$$
y_{\text{result}} = y_1 + y_2.
$$

For light, the wave quantity being added is the field, especially the electric field, not the intensity directly. This distinction is important. Interference patterns appear because the field amplitudes add first, and intensity is related to the square of the resulting field amplitude. So interference is not simple “intensity plus intensity.” It is field addition made visible as an intensity pattern.

To see how this produces bright and dark regions, imagine two sources $S_1$ and $S_2$ emitting waves with the same wavelength $\lambda$. At an observation point $P$, the wave from $S_1$ has travelled a distance $r_1$, while the wave from $S_2$ has travelled a distance $r_2$. The key quantity is the **path difference**

$$
\Delta r = r_2 - r_1.
$$

This is the mathematical centerpiece of the subsection. The absolute path lengths matter less than their difference, because the path difference determines whether the waves arrive in step or out of step. Geometry becomes phase through $\Delta r$.

If the two sources are in phase and the path difference is an integer number of wavelengths, the waves arrive in phase. A crest meets a crest, a trough meets a trough, and the fields reinforce. This is **constructive interference**:

$$
\Delta r = r_2 - r_1 = m\lambda,
$$

where

$$
m = 0, \pm 1, \pm 2, \ldots
$$

is the interference order. The central case $m = 0$ means the two paths are equal. The cases $m = \pm 1, \pm 2, \ldots$ mean that one path is longer than the other by one, two, or more full wavelengths, but the waves still arrive with the same phase.

If the path difference is a half-integer number of wavelengths, the waves arrive in opposite phase. A crest from one wave meets a trough from the other, so the fields cancel if the amplitudes are equal, or partly cancel if they are unequal. This is **destructive interference**:

$$
\Delta r = r_2 - r_1 = \left(m + \frac{1}{2}\right)\lambda,
$$

with

$$
m = 0, \pm 1, \pm 2, \ldots
$$

The half-wavelength part is the essential feature. A full wavelength returns a wave to the same phase; half a wavelength flips it to the opposite phase.

[Interactive visual: two-source path difference — move an observation point around two coherent sources and display $r_1$, $r_2$, and $\Delta r$; this teaches why integer-wavelength path differences give maxima and half-integer path differences give minima.]

This repairs a common misconception. A point is not bright simply because it is close to a source, and it is not dark simply because it is far away. What matters is whether the two waves arrive with phases that reinforce or cancel. A faraway point can be bright if the path difference is $m\lambda$. A nearer point can be dark if the path difference is $\left(m + \tfrac{1}{2}\right)\lambda$. Interference is controlled by phase, and path difference is the geometrical way of tracking that phase.

For a stable pattern, the two sources must be **coherent**. That means their phase relationship remains fixed in time. If the sources have the same frequency and a constant phase difference, the bright and dark regions stay in fixed places. If the phase relationship changes randomly, the pattern washes out. This is why interference experiments with light cannot usually use two unrelated ordinary lamps. Their phases are not locked together.

Young’s two-slit experiment solves this by using one light source to illuminate two narrow slits. The two slits then act like two coherent sources because both are driven by the same incoming wave. Waves from the slits overlap on a distant screen. Some screen positions receive waves that arrive in phase, producing bright fringes; other positions receive waves that arrive out of phase, producing dark fringes. The screen makes superposition visible.

Now the general path-difference condition becomes a specific geometry problem. Let the slit separation be $d$, and let the screen be far away compared with that separation. If $R$ is the distance from the slits to the screen, the far-screen approximation is

$$
R \gg d.
$$

Under this approximation, the two rays from the slits to the same point on the screen are nearly parallel. If the observation point is at an angle $\theta$ from the central direction, the path difference is

$$
\Delta r = d\sin\theta.
$$

Here $d$ is the distance between the slits, and $\theta$ is the angle from the central axis to the point on the screen. The expression $d\sin\theta$ is the projection of the slit separation along the direction of propagation. It is the extra distance one wave travels compared with the other.

![pasted 1782581675877](/physics-for-ee/assets/pasted-1782581675877.png)

Substituting this geometrical path difference into the constructive condition gives the bright fringes:

$$
d\sin\theta = m\lambda,
\qquad
m = 0, \pm 1, \pm 2, \ldots
$$

These are the directions where the two waves arrive in phase and reinforce on the screen. The central bright fringe has $m = 0$, because the two paths to the center of the screen are equal. On both sides of it are higher-order bright fringes, corresponding to path differences of one wavelength, two wavelengths, and so on.

Using the same path difference in the destructive condition gives the dark fringes:

$$
d\sin\theta = \left(m + \frac{1}{2}\right)\lambda,
\qquad
m = 0, \pm 1, \pm 2, \ldots
$$

These are the directions where the two waves arrive half a cycle out of phase and cancel. The screen therefore shows alternating bright and dark bands because different positions correspond to different values of $\Delta r$.

These formulas also explain how the fringe spacing changes. For fixed slit separation $d$, a larger wavelength $\lambda$ requires a larger value of $\sin\theta$ for the same order $m$, so the fringes spread farther apart. For fixed wavelength, a larger slit separation $d$ makes the same order occur at a smaller angle, so the fringes move closer together. The pattern is controlled by the comparison between wavelength and slit separation.

This is the right point to distinguish interference from diffraction without separating them too sharply. In this subsection, interference was introduced using two coherent sources, so the central question was the path difference between two waves. Diffraction, which comes next, appears when many parts of one wavefront contribute to the pattern, such as when light passes through a single slit or around an edge. The same superposition idea remains, but the number of contributing wavelets increases.

So interference is superposition made visible. We started with overlapping waves and the rule that fields add. That made the path difference $\Delta r = r_2 - r_1$ the key quantity, because it determines whether the waves arrive in phase or out of phase. Integer multiples of $\lambda$ give constructive interference, and half-integer multiples give destructive interference. In Young’s two-slit experiment, the far-screen geometry gives $\Delta r = d\sin\theta$, producing bright fringes at $d\sin\theta = m\lambda$ and dark fringes at $d\sin\theta = \left(m + \tfrac{1}{2}\right)\lambda$. This prepares the next step: diffraction, where the same superposition logic is applied not just to two sources, but to many parts of one wavefront.
