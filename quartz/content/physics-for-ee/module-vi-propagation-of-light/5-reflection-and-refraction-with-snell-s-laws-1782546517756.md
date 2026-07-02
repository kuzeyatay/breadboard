---
title: "5) Reflection and refraction with Snell’s laws"
date: "2026-06-27T07:48:37.756Z"
source: "user-note"
knowledge_type: "user-note"
---

## Reflection and refraction with Snell’s laws

Once we know that a material can change the speed and wavelength of light, the next natural question is what happens when a ray reaches the boundary between two materials. A ray travelling through air may strike water, glass, or another transparent medium. At that boundary, two things can happen. Part of the light can remain in the original medium by bouncing back; this is **reflection**. Another part can enter the second medium; this is **refraction**. Reflection changes the direction of light without changing medium. Refraction changes the direction of light because the transmitted light moves into a medium where its speed is different.

To describe either process, we need a reference direction at the surface. That reference direction is the **normal**, the line perpendicular to the interface at the point where the ray hits. All angles in reflection and refraction are measured from this normal, not from the surface itself. This convention is essential. If an angle is given relative to the surface, it must first be converted into the angle relative to the normal before using any ray law.

Consider two media, called medium $a$ and medium $b$, with refractive indices $n_a$ and $n_b$. A ray approaches the boundary from medium $a$. The angle between this incident ray and the normal is $\theta_a$. The reflected ray stays in medium $a$, and its angle with the normal is $\theta_r$. The refracted ray enters medium $b$, and its angle with the normal is $\theta_b$. In this subsection we assume **monochromatic** light, meaning light of a single color, so that each medium can be described by one refractive index for the light under discussion. The later complication that different colors can have different refractive indices is dispersion.

![pasted 1782546869667](/physics-for-ee/assets/pasted-1782546869667.png)

With this geometry in place, a two-dimensional ray diagram becomes meaningful. The incoming ray and the normal define a plane, called the **plane of incidence**. For ordinary reflection and refraction at a smooth interface, the incident ray, reflected ray, refracted ray, and normal all lie in this same plane. This is why the usual flat page drawing works: the essential geometry is contained in the plane defined by the incoming ray and the normal.

Reflection is the simpler case because the ray remains in the same medium. For a smooth surface, called **specular reflection**, the reflected ray is symmetric with the incident ray about the normal. Therefore,

$$
\theta_r = \theta_a.
$$

Here $\theta_a$ is the angle of incidence and $\theta_r$ is the angle of reflection, both measured from the normal. This law describes mirror-like reflection from a sufficiently smooth surface. A rough surface gives **diffuse reflection**, because different small patches of the surface have different local normals and send light in many directions. But for a smooth interface where a single normal is meaningful, the reflected ray obeys $\theta_r = \theta_a$.

Refraction needs a different rule because the ray crosses into a medium where the light speed changes. In the previous subsection, the refractive index was defined as

$$
n = \frac{c}{v},
$$

so a larger $n$ means a smaller light speed $v$. When light reaches a boundary at an angle, one part of a wavefront enters the second medium before another part does. If the speed changes, that first part of the wavefront advances at the new speed while the rest is still moving at the old speed. The wavefront turns, and because rays are perpendicular to wavefronts, the ray direction turns as well. The quantitative rule for this turning is **Snell’s law**:

$$
n_a \sin \theta_a = n_b \sin \theta_b.
$$

This is the mathematical centerpiece of the subsection. The symbols $n_a$ and $n_b$ are the refractive indices of the two media. The angle $\theta_a$ is the incident angle in medium $a$, and $\theta_b$ is the refracted angle in medium $b$. Snell’s law tells us how the direction of the transmitted ray changes when light crosses the boundary.

To read the law physically, solve it for the refracted angle:

$$
\sin \theta_b = \frac{n_a}{n_b} \sin \theta_a.
$$

This form shows that the refracted angle is controlled by the ratio of refractive indices. If light enters a medium with a larger refractive index, then $n_b > n_a$. The fraction $n_a / n_b$ is less than 1, so

$$
\sin \theta_b < \sin \theta_a.
$$

For angles between $0^\circ$ and $90^\circ$, a smaller sine corresponds to a smaller angle. Thus

$$
\theta_b < \theta_a.
$$

So when light enters a higher-index medium, it bends **towards the normal**. This is the same case in which the light slows down.

If light enters a medium with a smaller refractive index, then $n_b < n_a$. The fraction $n_a / n_b$ is greater than 1, so the refracted angle must be larger than the incident angle, as long as refraction is possible:

$$
\theta_b > \theta_a.
$$

So when light enters a lower-index medium, it bends **away from the normal**. This is the case in which the light speeds up. The “towards the normal” and “away from the normal” rules should not be treated as separate memorized facts. They are already contained in Snell’s law.

There is one simple case where the speed changes but the direction does not. If the ray hits the boundary along the normal, then

$$
\theta_a = 0^\circ.
$$

Since $\sin 0^\circ = 0$, Snell’s law gives

$$
n_b \sin \theta_b = 0,
$$

so

$$
\theta_b = 0^\circ.
$$

At normal incidence, the light may still change speed and wavelength when it enters the new medium, but it does not bend. Bending requires the wavefront to meet the boundary at an angle, so that different parts of the wavefront change speed at different times.

![pasted 1782546983441](/physics-for-ee/assets/pasted-1782546983441.png)

![pasted 1782547008282](/physics-for-ee/assets/pasted-1782547008282.png)

This explains why objects viewed through water or glass often appear displaced. A ruler partly submerged in water appears bent because light from the underwater part changes direction when it leaves water and enters air. The ray arriving at your eye is real, but your visual system traces that final ray backward in a straight line. It therefore reconstructs the underwater part at an apparent position that differs from its actual position. The object itself has not bent; the rays carrying information from the object have bent at the interface.

The same reasoning explains why a fish in water appears at a smaller depth than it really is. Light travelling from the fish to your eye goes from water into air. Since air has a smaller refractive index than water, the ray bends away from the normal as it exits the water. Your eye then traces the ray backward as if it had travelled straight all along, so the fish appears closer to the surface than it actually is. The apparent position is not where the fish is; it is where the eye’s straight-line reconstruction places the source of the ray.

One boundary case is worth noticing now, because it falls directly out of Snell’s law. When light tries to go from a higher-index medium into a lower-index medium, Snell’s law asks for a larger refracted angle. If the incident angle becomes too large, the equation would require

$$
\sin \theta_b > 1,
$$

which is impossible for a real angle. In that situation ordinary refraction cannot occur. The full discussion of this case is total internal reflection, which belongs later.

We started with the question of what happens when light reaches a boundary. To describe the geometry, we introduced the normal and measured all ray angles from it. Reflection then followed as the symmetric rule $\theta_r = \theta_a$. Refraction required the refractive indices of the two media, because changing medium changes the wave speed. Snell’s law,

$$
n_a \sin \theta_a = n_b \sin \theta_b,
$$

connects that speed change to the bending of the ray: higher index means bending toward the normal, lower index means bending away from the normal, and normal incidence gives no bending. This prepares the next step, where the same ray laws are reinterpreted more deeply using Huygens’s principle and wavefronts.
