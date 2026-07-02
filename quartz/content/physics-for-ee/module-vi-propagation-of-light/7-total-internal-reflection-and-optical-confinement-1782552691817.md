---
title: "7) Total internal reflection and optical confinement"
date: "2026-06-27T09:31:31.817Z"
source: "user-note"
knowledge_type: "user-note"
---

## Total internal reflection and optical confinement

Snell’s law usually tells us the direction of the refracted ray. But if we push the law far enough, we reach a situation where ordinary refraction becomes impossible. That limiting case is **total internal reflection**. It occurs when light tries to go from a medium with a larger refractive index into a medium with a smaller refractive index, such as water to air, glass to air, or the high-index core of an optical fiber to its lower-index surroundings.

Start with Snell’s law for light going from medium $a$ into medium $b$:

$$
n_a\sin\theta_a = n_b\sin\theta_b.
$$

Here $n_a$ is the refractive index of the incident medium, $n_b$ is the refractive index of the second medium, $\theta_a$ is the angle of incidence, and $\theta_b$ is the angle of refraction. All angles are measured from the normal to the boundary. Total internal reflection can only arise in the case

$$
n_a > n_b.
$$

This condition means the light is trying to leave a higher-index medium and enter a lower-index medium. Since a higher refractive index means a lower light speed, the light would speed up if it entered medium $b$. In ordinary refraction, this is exactly the case where the refracted ray bends away from the normal.

As the incident angle $\theta_a$ increases, Snell’s law demands a larger and larger refracted angle $\theta_b$. Eventually, the refracted ray is pushed all the way along the boundary. That limiting situation is

$$
\theta_b = 90^\circ.
$$

The incident angle that produces this limiting refracted ray is called the **critical angle**, written $\theta_{\mathrm{crit}}$. Substituting $\theta_b = 90^\circ$ into Snell’s law gives

$$
n_a\sin\theta_{\mathrm{crit}} = n_b\sin 90^\circ.
$$

Since

$$
\sin 90^\circ = 1,
$$

we obtain

$$
n_a\sin\theta_{\mathrm{crit}} = n_b,
$$

and therefore

$$
\sin\theta_{\mathrm{crit}} = \frac{n_b}{n_a}.
$$

This is the mathematical centerpiece of the subsection. It gives the threshold angle separating ordinary refraction from total internal reflection. The formula only makes physical sense when

$$
n_b < n_a,
$$

because only then is $n_b/n_a < 1$, allowing a real critical angle. If light goes from lower index to higher index, there is no critical angle for total internal reflection.

[Interactive visual: critical angle from Snell’s law — choose $n_a$ and $n_b$, increase $\theta_a$, and watch the refracted ray bend away from the normal until $\theta_b = 90^\circ$; this teaches why the critical angle exists only for high-index to low-index propagation.]

The critical angle is best understood as a threshold. If the incident angle is smaller than the critical angle,

$$
\theta_a < \theta_{\mathrm{crit}},
$$

then a refracted ray exists in medium $b$. It bends away from the normal, but it still leaves the original medium. If

$$
\theta_a = \theta_{\mathrm{crit}},
$$

then the refracted ray lies along the boundary. If

$$
\theta_a > \theta_{\mathrm{crit}},
$$

then Snell’s law would require

$$
\sin\theta_b > 1.
$$

No real angle has a sine larger than 1, so there is no ordinary refracted ray. In the ray model, the light is reflected back into the original medium. This is **total internal reflection**.

This repairs the most common misconception about the phenomenon. Total internal reflection is not caused merely by a large angle. It also is not caused merely by a shiny surface. Two conditions must be satisfied at the same time:

$$
n_a > n_b
\qquad\text{and}\qquad
\theta_a > \theta_{\mathrm{crit}}.
$$

The first condition says the light must be trying to move from higher refractive index to lower refractive index. The second condition says the incident angle must be large enough. For example, light going from air into glass cannot undergo total internal reflection at that first air-glass boundary, because it is going from lower index to higher index. The relevant direction is the opposite one: glass to air, water to air, or fiber core to lower-index cladding.

The formula also explains why high-index materials are good at keeping light inside. If $n_a$ is much larger than $n_b$, then the ratio

$$
\frac{n_b}{n_a}
$$

is small, so $\theta_{\mathrm{crit}}$ is small. A smaller critical angle means more internal rays satisfy

$$
\theta_a > \theta_{\mathrm{crit}}.
$$

That is why a high-index material such as diamond can send light through several internal reflections before the light escapes. The diamond is not simply “shiny” in the ordinary surface sense; its large refractive index makes total internal reflection easier to achieve inside it.

The same threshold condition is the basis of **optical confinement**. Suppose light is inside a transparent core of refractive index $n_1$, surrounded by cladding of lower refractive index $n_2$, with

$$
n_1 > n_2.
$$

At the core-cladding boundary, the critical angle is

$$
\sin\theta_{\mathrm{crit}} = \frac{n_2}{n_1}.
$$

If a ray inside the core strikes the boundary with

$$
\theta_a > \theta_{\mathrm{crit}},
$$

it is totally internally reflected back into the core. When the ray reaches the boundary again, the same condition can be satisfied again. In this way, the ray remains guided by repeated total internal reflection. This is the basic ray-optics picture of an optical fiber.

[Interactive visual: optical fiber confinement — launch a ray into a high-index core surrounded by lower-index cladding and vary the incident angle or bend radius; this teaches that the ray remains trapped only while each boundary hit satisfies $\theta_a > \theta_{\mathrm{crit}}$.]

This also explains why the refractive-index ordering in an optical fiber is essential. The core must have the higher refractive index. If the core and cladding had the same refractive index, there would be no critical-angle boundary for confinement. If the cladding had the higher refractive index, a ray inside the core would be trying to go from lower index to higher index, and total internal reflection would not occur. The light is confined because it repeatedly tries to leave a higher-index region for a lower-index region at sufficiently large incident angles.

The same logic explains why bending a fiber too sharply can make light leak out. In a straight fiber, a guided ray may hit the boundary at an angle safely above the critical angle. When the fiber bends, the geometry of the ray path changes. At the outer side of the bend, the ray can meet the boundary with a smaller incident angle. If that angle falls below

$$
\theta_{\mathrm{crit}},
$$

ordinary refraction becomes possible again, so part of the light can escape. The bend does not introduce a new law; it changes whether the same critical-angle condition is still satisfied.

The water-stream demonstration uses the same idea in a more visible form. Light inside water approaches the water-air boundary from the higher-index side. If the angle at the boundary is larger than the critical angle, the light reflects internally and can follow the stream. Transparent prisms can also use this effect: instead of relying on a metallic mirror, the prism geometry can be chosen so that light meets an internal boundary above the critical angle and reflects with very little loss in the ray picture.

So total internal reflection is not a separate phenomenon added on top of Snell’s law. It is what Snell’s law predicts when refraction is pushed to its limit. We started with light going from higher index to lower index. As the incident angle increased, the refracted ray bent farther away from the normal until the critical angle was reached, where $\theta_b = 90^\circ$. Beyond that threshold, ordinary refraction would require an impossible sine value, so the ray remains inside by reflection. This is the mechanism behind optical confinement: light can be guided inside a high-index region if every attempted escape meets a lower-index boundary at an angle larger than $\theta_{\mathrm{crit}}$. The next step is to move from single-color ray bending to dispersion, where the refractive index depends on wavelength and different colors bend by different amounts.
