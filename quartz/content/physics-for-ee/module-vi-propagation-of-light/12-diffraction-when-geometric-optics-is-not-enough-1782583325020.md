---
title: "12) Diffraction: when geometric optics is not enough"
date: "2026-06-27T18:02:05.020Z"
source: "user-note"
knowledge_type: "user-note"
---

## Diffraction: when geometric optics is not enough

Geometric optics works well when light interacts with objects and openings much larger than its wavelength. In that approximation, rays travel in straight lines through uniform media, and shadows should have sharp edges. If a light source shines past an obstacle, the ray picture predicts a clean boundary between illuminated and dark regions. But real light does not always behave so sharply. When monochromatic light passes by a razor blade, through a narrow slit, or around a small obstacle, the shadow edge can become blurred and can show alternating bright and dark fringes. This spreading of a wave around edges or through openings is called **diffraction**.

Diffraction is not a new force pulling light sideways. It is the wave nature of light becoming impossible to ignore. A ray diagram keeps only the direction of propagation and suppresses most of the wavefront. That is usually acceptable when the aperture or obstacle is very large compared with the wavelength. But near a small opening or edge, different parts of the same wavefront can reach the same observation point with different path lengths. Those parts can then interfere with one another. Light can therefore appear in regions where a purely geometric ray diagram would predict darkness.

This connects directly to Huygens’s principle. Every point on a wavefront can be treated as a source of secondary wavelets. For reflection and refraction, this idea reconstructed how a wavefront moves at a boundary. For diffraction, the same idea is applied to an aperture or edge. A slit is not just an empty gap through which a single ray passes. Every point across the slit acts like a source of Huygens wavelets. Those wavelets spread out, overlap, and interfere on the screen.

[Interactive visual: Huygens wavelets through a slit — adjust the slit width and watch many wavelets spread from points across the opening; this teaches why a slit produces a pattern rather than a perfectly sharp beam.]

The cleanest quantitative case is **single-slit diffraction**. Imagine monochromatic plane waves incident on a long narrow slit of width $a$. A screen is placed far behind the slit, so that rays from different points in the slit to one point on the screen are approximately parallel. This far-screen situation is called **Fraunhofer diffraction**. If the screen is close enough that this parallel-ray approximation fails, the pattern is called **Fresnel diffraction**. The simple formula used here belongs to the Fraunhofer case.

At the center of the screen, directly opposite the slit, all parts of the slit send waves that travel essentially equal distances. They arrive in phase, so the center of the pattern is bright. Away from the center, at an angle $\theta$, waves from different points across the slit travel different distances. At some angles, these different contributions cancel. Those angles give the dark fringes.

To find the first dark fringe, divide the slit into two equal halves. Pair each point in the upper half with the corresponding point in the lower half. Each pair is separated by a distance $a/2$ across the slit. For an observation direction at angle $\theta$, the path difference between the two members of each pair is

$$
\frac{a}{2}\sin\theta.
$$

If this path difference equals half a wavelength,

$$
\frac{a}{2}\sin\theta = \frac{\lambda}{2},
$$

then each pair arrives half a cycle out of phase. One contribution cancels the other. Multiplying both sides by 2 gives

$$
a\sin\theta = \lambda.
$$

This is the first dark fringe. The same cancellation idea can be extended by dividing the slit into more equal parts. The general condition for dark fringes in single-slit Fraunhofer diffraction is

$$
a\sin\theta = m\lambda,
\qquad
m = \pm 1, \pm 2, \pm 3, \ldots
$$

or equivalently,

$$
\sin\theta = \frac{m\lambda}{a}.
$$

This is the mathematical centerpiece of the subsection. Here $a$ is the slit width, $\lambda$ is the wavelength of the light, $\theta$ is the angle from the central axis to a dark fringe, and $m$ labels the order of the dark fringe. The value $m = 0$ is not included because $\theta = 0$ is the central bright maximum, not a dark fringe.

[Interactive visual: single-slit minima — vary slit width $a$ and wavelength $\lambda$, then watch the first and higher dark fringes move according to $a\sin\theta = m\lambda$; this teaches why narrower slits produce wider diffraction patterns.]

This is the natural moment to compare diffraction with the two-slit interference formulas. In two-slit interference,

$$
d\sin\theta = m\lambda
$$

locates **bright** fringes, including the central bright fringe at $m = 0$. In single-slit diffraction,

$$
a\sin\theta = m\lambda
$$

locates **dark** fringes, and $m$ starts at $\pm 1$. The formulas look similar because both come from path differences and superposition, but they refer to different geometries. Two-slit interference compares waves from two separated slits. Single-slit diffraction compares many contributions from different parts of one opening.

The formula also tells us how wide the diffraction pattern is. The first minimum satisfies

$$
\sin\theta_1 = \frac{\lambda}{a}.
$$

For visible light, the angles are often small enough that

$$
\sin\theta \approx \theta
$$

when $\theta$ is measured in radians. Then

$$
\theta_1 \approx \frac{\lambda}{a}.
$$

This approximation shows the key physical trend: a longer wavelength or a narrower slit gives a wider diffraction pattern. A wider slit gives a narrower pattern. This may feel backwards at first, because a larger opening sounds as if it should allow more spreading. But wave spreading is strongest when the opening is comparable to the wavelength. If the slit is very wide compared with the wavelength, most of the light stays close to the geometric direction and the ray picture becomes a better approximation.

This also explains why diffraction is easy to notice for sound but harder to notice for ordinary light. Sound wavelengths can be comparable to doorways, corridors, and everyday openings, so sound bends around corners noticeably. Visible-light wavelengths are only hundreds of nanometers, much smaller than most everyday openings, so diffraction is usually subtle unless the opening or obstacle is very small, the screen is far away, or the experiment is carefully arranged.

The full single-slit intensity pattern contains more detail than just the dark fringes. It has a broad central bright maximum, with weaker side maxima separated by minima. A full intensity formula can describe the relative brightness of all these regions, but the essential structure for this course is the cancellation condition: many Huygens wavelets from one aperture interfere, and complete destructive interference occurs at

$$
a\sin\theta = m\lambda.
$$

In real optical experiments, interference and diffraction often appear together. For example, a two-slit experiment with slits of finite width shows two-source interference fringes whose overall brightness is shaped by the diffraction pattern of each slit. That combined pattern belongs beyond the clean first step. The clean distinction is this: two-slit interference begins with path difference between two coherent openings, while single-slit diffraction begins with interference among many parts of one opening.

So diffraction is the point where geometric optics stops being enough. We started from the ray prediction of sharp shadows, then saw that waves can spread around edges and through openings. Huygens’s principle explains why: every part of an aperture contributes wavelets, and those many contributions interfere on the screen. For a single slit of width $a$, far-field destructive interference occurs at $a\sin\theta = m\lambda$, with $m = \pm 1, \pm 2, \ldots$. The ratio $\lambda/a$ controls the width of the pattern: narrower slits and longer wavelengths spread more. This completes the wave-optics chain from rays to interference and diffraction, and prepares the final bridge to the photon and quantum description of light.
