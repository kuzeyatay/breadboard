---
title: "6) Huygens’s principle: why ray laws come from waves"
date: "2026-06-27T08:33:49.129Z"
source: "user-note"
knowledge_type: "user-note"
---

## Huygens’s principle: why ray laws come from waves

In the previous subsection, reflection and refraction were described with ray laws. Those laws are useful, but by themselves they can feel like rules imposed on light from the outside: the reflected angle equals the incident angle, and the refracted angle obeys Snell’s law. The deeper question is this: if light is a wave, why should these ray laws follow at all? Huygens’s principle answers by shifting the description from rays back to wavefronts.

The principle begins with one wavefront at a given instant. Huygens’s principle says that **every point on that wavefront can be treated as the source of a small secondary wavelet**. Each secondary wavelet spreads out with the wave speed of the medium. After a short time $t$, a secondary wavelet has radius

$$
r = vt,
$$

where $r$ is the distance the wavelet has spread, $v$ is the wave speed in that medium, and $t$ is the elapsed time. The next wavefront is found by drawing the surface that just touches, or envelops, all these secondary wavelets.

This is the mathematical centerpiece of the subsection: an old wavefront is advanced by drawing secondary wavelets of radius $vt$, and the envelope of those wavelets becomes the new wavefront. A ray is then the direction perpendicular to the successive wavefronts. So Huygens’s principle does not replace ray diagrams with an unrelated picture. It explains where the ray direction comes from.

![pasted 1782549699775](/physics-for-ee/assets/pasted-1782549699775.png)

![pasted 1782549723966](/physics-for-ee/assets/pasted-1782549723966.png)

This construction should not be misunderstood as saying that tiny physical particles are launched from every point of the wavefront. The “secondary wavelets” are a geometrical way to predict the next position of the wavefront. The real physical idea is that each part of the wavefront advances locally according to the wave speed in the medium. If all parts advance equally, the wavefront keeps its orientation. If some parts advance differently, the wavefront turns.

The wavefront turns because different parts of the same wavefront enter the new medium at different times and therefore change speed at different times. When a wavefront hits a boundary at an angle, one side reaches the new medium first. If that new medium has a lower wave speed, the first side slows down while the other side is still moving faster in the original medium. One side therefore advances less than the other, making the whole wavefront pivot. Since rays are perpendicular to wavefronts, the ray direction turns as well. This turning of the ray is refraction.

Reflection is the simplest place to see the idea. Imagine a plane wavefront approaching a smooth reflecting surface. One end of the wavefront reaches the surface before the other end. During the time interval $t$, the part of the incident wavefront that has not yet reached the surface continues moving toward it. At the same time, the point that has already reached the surface begins the reflected construction. Because reflection happens back into the same medium, the incident and reflected advances are both governed by the same speed $v$. The relevant distances are therefore both of the form

$$
vt.
$$

When the reflected wavefront is drawn as the envelope of the reflected secondary wavelets, the geometry is symmetric about the normal. The reflected ray is perpendicular to that new wavefront, so the angle of reflection equals the angle of incidence:

$$
\theta_r = \theta_a.
$$

Here $\theta_a$ is the incident angle and $\theta_r$ is the reflected angle, both measured from the normal. The equality is therefore not just a rule for mirrors. It follows from reconstructing the wavefront in the same medium with the same wave speed.

Refraction uses the same construction, but now the two sides of the boundary have different wave speeds. Let medium $a$ have refractive index $n_a$ and wave speed $v_a$, and let medium $b$ have refractive index $n_b$ and wave speed $v_b$. A plane wavefront approaches the boundary from medium $a$. One point of the wavefront reaches the boundary first and begins producing a secondary wavelet in medium $b$, where the wavelet spreads with speed $v_b$. Meanwhile, another point of the original wavefront is still travelling in medium $a$, where it moves with speed $v_a$.

After the same time interval $t$, the part still in medium $a$ has advanced a distance

$$
v_a t,
$$

while the secondary wavelet in medium $b$ has advanced a distance

$$
v_b t.
$$

If $v_a$ and $v_b$ are different, these two distances are different. That unequal advance tilts the new wavefront. Since rays are perpendicular to wavefronts, the ray bends.

![pasted 1782551008201](/physics-for-ee/assets/pasted-1782551008201.png)

The same picture gives the quantitative law. In the standard Huygens construction for refraction, the same segment $AO$ appears in the two right triangles formed by the incident and refracted wavefronts. On the incident side,

$$
\sin \theta_a = \frac{v_a t}{AO},
$$

and on the refracted side,

$$
\sin \theta_b = \frac{v_b t}{AO}.
$$

Here $\theta_a$ is the incident angle in medium $a$, $\theta_b$ is the refracted angle in medium $b$, $v_a$ and $v_b$ are the wave speeds in the two media, $t$ is the same elapsed time for both parts of the construction, and $AO$ is the shared geometric length in the construction. Dividing the two equations eliminates both $t$ and $AO$:

$$
\frac{\sin \theta_a}{\sin \theta_b} = \frac{v_a}{v_b}.
$$

This already says the essential physical thing: refraction is controlled by the ratio of wave speeds. To write it in the form used in ray optics, use the definition of refractive index,

$$
n = \frac{c}{v}.
$$

Thus

$$
v_a = \frac{c}{n_a}
\qquad \text{and} \qquad
v_b = \frac{c}{n_b}.
$$

Substituting these into the speed-ratio equation gives

$$
\frac{\sin \theta_a}{\sin \theta_b}
= \frac{c/n_a}{c/n_b}
= \frac{n_b}{n_a}.
$$

Rearranging gives Snell’s law:

$$
n_a \sin \theta_a = n_b \sin \theta_b.
$$

This result now has a wave explanation. Snell’s law is not an independent rule added on top of wave theory. It comes from Huygens’s principle plus the fact that light travels at different speeds in different media. If the transmitted medium has a larger refractive index, then its wave speed is smaller. The secondary wavelets in that medium grow less during the same time interval, so the transmitted wavefront rotates in the direction that makes the ray bend toward the normal. If the transmitted medium has a smaller refractive index, the wavelets grow more, and the ray bends away from the normal.

This also shows why the normal remains the reference direction. Rays are perpendicular to wavefronts, and the normal is perpendicular to the boundary. Reflection and refraction compare how the wavefront orientation changes relative to the boundary, so the natural ray angles are measured relative to the normal. Measuring from the surface would use complementary angles and would not match the standard form of the laws.

The value of Huygens’s principle is therefore not mainly that it gives the fastest calculation method. For ordinary reflection and refraction problems, the ray laws are usually quicker. Its value is that it explains why ray laws belong inside the wave picture. Equal wave speeds in the same medium give the reflection law. Unequal wave speeds across a boundary give refraction and Snell’s law. The ray diagram is a compressed version of the wavefront construction.

We started with ray laws that described what light does at a boundary but did not yet explain why. Huygens’s principle supplied the missing wave mechanism: every point on a wavefront acts as a source of secondary wavelets, and their envelope forms the next wavefront. When the wavelets advance equally, reflection gives $\theta_r = \theta_a$. When they advance at different speeds across a boundary, refraction gives $n_a \sin \theta_a = n_b \sin \theta_b$. This completes the bridge from waves to ray laws and prepares the next step, where Snell’s law reaches its limiting case: total internal reflection.
