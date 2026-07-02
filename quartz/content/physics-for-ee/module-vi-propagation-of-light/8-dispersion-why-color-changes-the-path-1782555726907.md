---
title: "8) Dispersion: why color changes the path"
date: "2026-06-27T10:22:06.907Z"
source: "user-note"
knowledge_type: "user-note"
---

## Dispersion: why color changes the path

Until now, we have usually treated a transparent material as if it had one refractive index $n$. That simplification was useful: it allowed us to understand speed changes, Snell’s law, Huygens’s principle, and total internal reflection without worrying about color. But white light through a prism shows that this cannot be the full story. If a single refractive index described the material for all visible light, then all colors in the white beam would bend together. Instead, the beam spreads into a spectrum. The path of light must therefore depend on color.

This color dependence is called **dispersion**. In optics, dispersion means that the refractive index of a material depends on the frequency or wavelength of the light. Instead of treating the refractive index as one fixed number,

$$
n
$$

we must write it as a function:

$$
n = n(f)
$$

or equivalently,

$$
n = n(\lambda_0)
$$

Here $f$ is the frequency of the light, and $\lambda_0$ is the wavelength the light would have in vacuum. The subscript $0$ is useful because wavelength changes when light enters a material, while frequency remains fixed at the boundary. So when we use wavelength to label color, the clean label is usually the vacuum wavelength $\lambda_0$.

This is the mathematical centerpiece of the subsection: dispersion means that the refractive index is a function of color. Once that is true, the speed of light in the material also depends on color, because

$$
v = \frac{c}{n}
$$

More precisely,

$$
v(\lambda_0) = \frac{c}{n(\lambda_0)}
$$

So if two colors have different refractive indices in the same material, they also have different speeds in that material. This does not mean that the material changes the frequency of the light. The frequency is still fixed by the source and remains unchanged at the boundary. What changes inside the material is the speed and therefore the wavelength.

The path changes because Snell’s law contains the refractive index. For one color crossing from medium $a$ into medium $b$, Snell’s law becomes

$$
n_a(\lambda_0)\sin\theta_a = n_b(\lambda_0)\sin\theta_b(\lambda_0)
$$

The incident angle $\theta_a$ may be the same for all colors in the incoming white beam, but if $n_b(\lambda_0)$ is different for different colors, then the refracted angle $\theta_b(\lambda_0)$ is different too. Dispersion is therefore not a mysterious extra bending effect. It is Snell’s law applied separately to each wavelength.

![pasted 1782556049748](/physics-for-ee/assets/pasted-1782556049748.png)

For ordinary visible dispersion in glass or water, violet light has a slightly larger refractive index than red light. Since larger $n$ means smaller speed, violet light travels slightly more slowly in the material than red light. When light enters the higher-index material from air, the color with the larger $n$ bends more toward the normal. Violet therefore bends more than red in this usual visible case.

This repairs a common misconception. Red light does not bend more than violet in ordinary glass or water dispersion. Red has the smaller refractive index, so it bends less. Violet has the larger refractive index, so it bends more. The exact final direction after a prism depends on both entry and exit surfaces, but the local rule remains the same: at a given boundary, the color with the larger refractive index is refracted more strongly.

A prism makes this visible because it gives the colors two angled surfaces at which to separate. White light enters the prism, and the different colors refract by slightly different amounts. They then reach the second surface in different directions and refract again as they leave. The result is a spread-out spectrum. The prism is not creating the colors from nothing; the incoming white light already contains a continuous range of visible wavelengths. The prism separates that continuous range because $n$ depends on wavelength.

![pasted 1782556140935](/physics-for-ee/assets/pasted-1782556140935.png)

![pasted 1782556167766](/physics-for-ee/assets/pasted-1782556167766.png)

This point also helps avoid another misleading picture. The visible spectrum is not physically made of a few isolated color bands. The familiar words red, orange, yellow, green, blue, and violet are human labels for regions of a continuous range of wavelengths. A prism spreads that range continuously. The banded appearance comes partly from how our eyes and language group the continuous spectrum.

Rainbows use the same principle, but the geometry is different. A water droplet acts somewhat like a tiny refracting and reflecting optical element. For the **primary rainbow**, sunlight refracts as it enters the droplet, reflects once inside, and refracts again as it leaves. The two refractions are where dispersion separates the colors: red and violet do not follow exactly the same path because water gives them slightly different refractive indices.

The droplet geometry determines which separated rays reach the observer. In a primary rainbow, red light reaches the eye from droplets at a slightly different angle than violet light, so red appears on the outside of the arc and violet on the inside. The colors seen in the sky are not all coming from one single droplet in one place; each visible color comes from droplets positioned so that that color is sent toward the observer.

A secondary rainbow follows the same dispersion logic but includes an extra internal reflection inside the droplet. That extra reflection reverses the color order compared with the primary rainbow and makes the secondary bow fainter. Other atmospheric color patterns, such as pale fogbows or halos from ice crystals, also involve wavelength-dependent optical paths, although their detailed geometry is different. The shared idea is still dispersion: different wavelengths follow different paths because the refractive index depends on wavelength.

It is important to keep dispersion separate from scattering. Dispersion is color separation by wavelength-dependent refraction: different colors bend by different amounts while passing through a medium or droplet. Scattering, which comes later, explains effects such as the blue sky and red sunsets through wavelength-dependent redirection of light by small particles or molecules. Both involve wavelength, but they are not the same mechanism.

So dispersion is where the single-$n$ model becomes too simple. We started with Snell’s law for one refractive index, then noticed that white light can split into colors. That forced us to replace $n$ by $n(f)$ or $n(\lambda_0)$. Since both the speed $v = c/n$ and the refracted angle in Snell’s law depend on $n$, different colors travel and bend differently in the same material. This explains why prisms spread white light and why rainbows have ordered colors. The next step is to move from wavelength-dependent paths to polarization, where the crucial property is not the color of the wave but the direction of its electric field.
