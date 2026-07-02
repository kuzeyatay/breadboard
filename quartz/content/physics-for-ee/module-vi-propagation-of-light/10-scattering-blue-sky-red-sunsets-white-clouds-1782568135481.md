---
title: "10) Scattering: blue sky, red sunsets, white clouds"
date: "2026-06-27T13:48:55.481Z"
source: "user-note"
knowledge_type: "user-note"
---

## Scattering: blue sky, red sunsets, white clouds

After dispersion and polarization, we have seen several ways in which light can be redirected or filtered. A prism redirects different wavelengths by refraction. A polarizer selects one electric-field direction. But the atmosphere does not behave like one clean prism, mirror, or polarizing filter. Sunlight passes through air molecules, dust, droplets, and other small particles. Even when there is no visible optical surface, some of the light can still be sent into new directions. This redirection is called **scattering**.

Scattering means that incoming light interacts with matter and part of that light is re-radiated or redirected in directions different from the original beam. In a simple picture, the electric field of the incoming light makes charges in atoms or molecules oscillate. Those oscillating charges then emit light in various directions. This is different from specular reflection at a smooth surface, where one incident ray gives one clean reflected ray. Scattering takes light that was originally travelling in one direction and redistributes part of it into many directions.

This immediately explains why the daytime sky is bright instead of black. If Earth had no atmosphere, sunlight would travel almost straight from the Sun to the ground, and the rest of the sky would look dark, like space. But air molecules scatter part of the sunlight sideways. When you look away from the Sun into the sky, the light entering your eye is largely sunlight that was originally travelling in another direction and was scattered toward you by the atmosphere.

The key question is why this scattered light has a color. Air molecules are much smaller than the wavelength of visible light. For such small scatterers, the scattering is described by **Rayleigh scattering**, whose central wavelength dependence is

$$
S \propto \frac{1}{\lambda^4}.
$$

Here $S$ represents the scattering strength, and $\lambda$ is the wavelength of the light. This is the mathematical centerpiece of the subsection. It says that shorter wavelengths are scattered much more strongly than longer wavelengths. The fourth power matters: even a moderate difference in wavelength becomes a large difference in scattering.

To see how strong the effect is, compare violet light and red light. Violet light has a wavelength of about

$$
\lambda_{\text{violet}} \approx 380\,\text{nm},
$$

while red light has a wavelength of about

$$
\lambda_{\text{red}} \approx 750\,\text{nm}.
$$

Using the Rayleigh dependence,

$$
\frac{S_{\text{violet}}}{S_{\text{red}}}
= \left(\frac{\lambda_{\text{red}}}{\lambda_{\text{violet}}}\right)^4
= \left(\frac{750}{380}\right)^4
\approx 15.
$$

So violet light is scattered roughly fifteen times more strongly than red light. Blue light is also scattered much more strongly than red. This is why the atmosphere preferentially removes short-wavelength light from the direct solar beam and sends it into many other directions.

[Interactive visual: Rayleigh scattering versus wavelength — slide the wavelength from red to violet and watch the scattering strength scale as $1/\lambda^4$; this teaches why shorter wavelengths dominate molecular scattering.]

Now the blue sky follows naturally. Sunlight contains a continuous range of visible wavelengths. As sunlight travels through the atmosphere, air molecules scatter the shorter wavelengths more strongly than the longer wavelengths. Some of that scattered short-wavelength light is redirected toward your eye from all directions in the sky. The sky therefore appears bright and dominated by short-wavelength light.

A natural objection is: if violet is scattered even more strongly than blue, why is the sky not violet? The reason is that perceived color is not determined by the scattering formula alone. It also depends on the spectrum of sunlight reaching the atmosphere and on the sensitivity of the human eye. Our eyes are not equally sensitive to all visible wavelengths, and in this situation the mixture of scattered short-wavelength light is perceived mainly as blue rather than violet. The physical scattering is strongest toward the short-wavelength end; the perceived color is blue.

The same Rayleigh scattering also explains red sunsets, but now we focus on the light that reaches your eye directly from the Sun. When the Sun is high in the sky, sunlight travels through a relatively short thickness of atmosphere. When the Sun is near the horizon, the path through the atmosphere is much longer. Over this longer path, much more blue and violet light is scattered out of the direct beam before the sunlight reaches you. The remaining direct light is depleted of short wavelengths and is dominated by longer wavelengths, so the Sun and nearby sky look orange or red.

[Interactive visual: atmospheric path length at sunset — lower the Sun toward the horizon and watch the path through the atmosphere lengthen; this teaches why more blue/violet light is removed from the direct beam at sunset.]

This also repairs a common misconception. The Sun itself is not becoming red at sunset. The color change is caused by the atmosphere between the Sun and the observer. Shorter wavelengths are scattered away from the direct line of sight, while longer wavelengths survive that long path more effectively. The red or orange sunset is therefore the complementary result of the same process that makes the daytime sky blue.

Clouds create a useful contrast. If air molecules are small enough to produce strong wavelength-selective Rayleigh scattering, what changes in a cloud? A cloud consists of many water droplets, and these droplets are much larger than individual air molecules. Because the droplets are larger and denser scatterers, they scatter visible light strongly. But across the visible range, their scattering is much less selective than Rayleigh scattering by tiny molecules. Red, green, blue, and violet light are all redirected efficiently.

That is why ordinary clouds look white. White sunlight enters the cloud, and the water droplets scatter many visible wavelengths in many directions. Since no visible wavelength is removed much more strongly than the others, the mixture reaching your eye remains approximately white. A cloud is not white because water droplets create white light; it is white because they scatter the incoming sunlight in a nearly nonselective way across the visible spectrum.

This distinction also separates scattering from dispersion. Dispersion explains color separation by wavelength-dependent refraction: different wavelengths follow different refracted paths because $n$ depends on wavelength. Scattering explains color effects by wavelength-dependent redirection from particles or molecules. A rainbow is mainly a dispersion/refraction phenomenon in water droplets. A blue sky and red sunset are mainly scattering phenomena in the atmosphere. White clouds are scattering too, but with larger droplets that redirect visible wavelengths more nearly equally.

So scattering explains atmospheric color by asking how matter redirects light. We started with sunlight passing through an atmosphere that is not a smooth optical surface. Air molecules scatter light into new directions, and for very small scatterers Rayleigh scattering gives $S \propto 1/\lambda^4$. That strong wavelength dependence sends much more short-wavelength light into the sky, which we perceive mainly as blue. Along the longer path at sunset, the same process removes short wavelengths from the direct solar beam, leaving red and orange light. In clouds, larger droplets scatter all visible wavelengths more nearly equally, producing white. This prepares the next step: interference, where the key effect is no longer redirection by particles, but reinforcement and cancellation when waves overlap.
