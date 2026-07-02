---
title: "4) Refractive index, speed, wavelength, and frequency"
date: "2026-06-27T06:36:52.321Z"
source: "user-note"
knowledge_type: "user-note"
---

## Refractive index, speed, wavelength, and frequency

Once light is represented by wavefronts and rays, the next question is what a material does to that wave. In vacuum, light travels at

$$
c \approx 3.00\times 10^8\ \text{m/s}.
$$

But light does not travel at this same speed in water, glass, oil, or other transparent media. If ray diagrams are going to explain why light bends at an interface, we first need a way to measure how much a medium changes the propagation speed of light. That measure is the **refractive index**.

The refractive index $n$ of a material is defined by

$$
n=\frac{c}{v}.
$$

Here $c$ is the speed of light in vacuum, and $v$ is the speed of light in the material. This is the mathematical centerpiece of the subsection because it turns the optical effect of a material into one number. If $n=1$, light travels at the vacuum speed. If $n>1$, light travels more slowly in the material than in vacuum. Rewriting the same definition gives

$$
v=\frac{c}{n}.
$$

This form makes the physical meaning especially clear: a larger refractive index means a smaller light speed. So the refractive index is not a measure of “how much light” is inside the material, and it does not mean light is faster. It measures how strongly the medium slows the propagation of light compared with vacuum.

However, light is not only a ray; it is still a wave. So changing the speed cannot be the whole story. A periodic wave also has a frequency $f$, which tells how many cycles pass per second, and a wavelength $\lambda$, which tells the distance between corresponding points such as neighboring crests. These quantities are connected by

$$
v=\lambda f.
$$

This relation says that in one second, $f$ cycles pass, and each cycle occupies a length $\lambda$. The wave therefore advances a distance $\lambda f$ per second. The important detail is that $v$ and $\lambda$ must refer to the same medium. If the light is in water, then $v$ is the speed in water and $\lambda$ is the wavelength in water.

Now imagine a light wave reaching the boundary between vacuum and water. At first it may seem that everything could change: speed, wavelength, frequency, and direction. But the frequency has a special role. The frequency is set by the source of the light, and at the boundary the oscillation must match in time. The surface cannot be driven by the incoming wave at one frequency and emit the transmitted wave at a different frequency at the same time. Therefore, when light crosses from one medium into another, its **frequency remains unchanged**.

That one fact determines what happens to the wavelength. If the frequency stays fixed but the speed changes, then the wave relation

$$
v=\lambda f
$$

forces the wavelength to change. In a material with refractive index $n$, the speed is

$$
v=\frac{c}{n}.
$$

Since the frequency $f$ is unchanged, the wavelength in that material, denoted $\lambda_n$, is

$$
\lambda_n=\frac{v}{f}=\frac{c/n}{f}.
$$

In vacuum, the wavelength is

$$
\lambda=\frac{c}{f}.
$$

Combining the two expressions gives

$$
\lambda_n=\frac{\lambda}{n}.
$$

Here $\lambda$ is the wavelength in vacuum, and $\lambda_n$ is the wavelength inside a medium of refractive index $n$. For $n>1$, the wavelength in the material is shorter than the wavelength in vacuum. The wave has not changed its frequency; its wavefronts have become closer together because the wave is moving more slowly.

![pasted 1782542446364](/physics-for-ee/assets/pasted-1782542446364.png)

This is exactly the logic behind the common vacuum-to-water case. Vacuum has $n=1$, while water has approximately $n=1.33$. Inside water, the speed becomes

$$
v_{\text{water}}=\frac{c}{1.33},
$$

so the speed is lower than in vacuum. The frequency remains the same because it is fixed by the source and must match across the boundary. Therefore the wavelength becomes

$$
\lambda_{\text{water}}=\frac{\lambda_{\text{vacuum}}}{1.33}.
$$

So the correct statement is: when light enters water from vacuum, its frequency is unchanged, its speed decreases, and its wavelength decreases.

This also explains why refractive index is the preparation for refraction. A ray shows the direction in which wavefronts move. If light reaches a boundary at an angle, one part of the wavefront enters the new medium before another part does. If the new medium has a different refractive index, that first part changes speed earlier. The wavefront then turns, and because rays are perpendicular to wavefronts, the ray direction changes too. The precise law for that bending is Snell’s law, which belongs in the next subsection. For now, the important point is simpler: ray bending begins with a change in wave speed, and the refractive index tells us the size of that speed change.

The same reasoning also explains why two transparent materials can become difficult to distinguish optically if they have the same refractive index. If light passes from one material into another and $n$ does not change, then the speed does not change. If the frequency is unchanged as always, then the wavelength does not change either. The wavefronts continue almost as if there were no optical boundary. This is why glass can nearly disappear in a liquid with a matching refractive index: the light is not strongly redirected at the boundary.

One caveat will matter later. A material’s refractive index can depend on the color of the light. That means different colors can have slightly different speeds and wavelengths in the same material. This effect is called dispersion and is responsible for phenomena such as prisms and rainbows. In this subsection, however, we treat $n$ as a single value for the light under discussion, so that the basic connection between refractive index, speed, wavelength, and frequency remains clear.

We started with the question of what a material does to a light wave. The refractive index $n=c/v$ tells us how the material changes the wave speed. Because the light remains a wave, that speed change must be read together with $v=\lambda f$. Since the frequency is fixed by the source and remains unchanged at a boundary, a lower speed in a medium means a shorter wavelength. That is the chain that leads to $\lambda_n=\lambda/n$, and it prepares the next step: using the speed change at a boundary to understand why rays bend.
