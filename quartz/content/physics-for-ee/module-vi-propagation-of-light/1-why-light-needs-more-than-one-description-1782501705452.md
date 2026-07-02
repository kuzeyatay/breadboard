---
title: "1) Why light needs more than one description"
date: "2026-06-26T19:21:45.452Z"
source: "user-note"
knowledge_type: "user-note"
---

## Why light needs more than one description

When we first meet light in everyday life, it is tempting to ask for one final answer: *is light a particle or a wave?* But the course does not begin by asking that question abstractly. It begins with a more practical problem: light sometimes behaves as something that travels along paths, and sometimes as something that spreads, overlaps, and forms patterns. A mirror suggests a ray-like description. Refraction suggests that the direction of propagation changes at a boundary. Interference and diffraction, which appear later in this module, require a wave description because they depend on phase and superposition. So before deciding what light “really is,” we first ask which description explains the phenomenon in front of us.

For propagation, the wave description is the natural starting point. A wave has a wavelength $\lambda$, a frequency $f$, and a speed. In vacuum, light travels with speed

$$
c = 299{,}792{,}458\ \text{m/s} \approx 3.00 \times 10^8\ \text{m/s},
$$

so a periodic light wave satisfies

$$
c = \lambda f.
$$

Here, $c$ is the speed of light in vacuum, $\lambda$ is the wavelength, and $f$ is the frequency. The equation says that during one second, $f$ wave cycles pass a point, and each cycle occupies a length $\lambda$. The product $\lambda f$ is therefore the distance advanced per second. This is why wavelength and frequency are not just labels for color; they are part of the mechanism by which wave propagation is described. Once light is described this way, ideas such as wavefronts, rays, phase, and later superposition become available.

![pasted 1782539280251](/physics-for-ee/assets/pasted-1782539280251.png)
![pasted 1782539325395](/physics-for-ee/assets/pasted-1782539325395.png)
![pasted 1782539347807](/physics-for-ee/assets/pasted-1782539347807.png)

This wave picture also explains why Module VI first treats light mainly as something that propagates. A wavefront represents points of equal phase in the wave. A ray then indicates the local direction in which the wavefront moves. In a homogeneous isotropic medium, the rays are straight and perpendicular to the wavefronts, so drawing rays is not a separate theory of light; it is a simplified way of tracking wave propagation. That is why ray optics can be useful for reflection and refraction, while the deeper wave idea remains in the background.

However, propagation is not the only thing light does. Light also exchanges energy with matter. Here the pure classical wave picture becomes insufficient. A classical wave can spread its energy continuously through space, so one might expect matter to absorb that energy gradually. But experiments such as the photoelectric effect show that light can deliver energy in discrete packets. Electrons are emitted from a metal surface only when the light frequency is high enough; merely increasing the intensity of too-low-frequency light does not solve the problem. This forces a second description: light energy can be carried by photons.

For one photon,

$$
E = hf = \frac{hc}{\lambda}.
$$

This is the mathematical centerpiece of this subsection because it connects the wave description to the particle description. The symbol $E$ is the energy of one photon, $h$ is Planck’s constant, $f$ is the frequency of the light, $c$ is the speed of light in vacuum, and $\lambda$ is the wavelength in vacuum. The first form, $E = hf$, says that the energy of one photon is determined by the frequency. The second form, $E = hc/\lambda$, follows from the wave relation $c = \lambda f$, and says the same thing in wavelength language: shorter wavelength means higher photon energy.

This equation repairs an important misconception. Higher intensity does not mean that each photon has more energy. At a fixed frequency, each photon still has energy $hf$. A more intense beam contains more photons per second, so it can cause more light–matter interactions per second, but it does not increase the energy of each individual photon. To increase the energy per photon, the frequency must increase. Blue or violet light has a higher frequency than red light, so each blue or violet photon carries more energy than each red photon.

At this point it is also easy to make the opposite mistake: after introducing photons, one might think light is simply made of tiny classical particles after all. That is not the right conclusion. Ordinary particles do not naturally explain interference and diffraction, where overlapping alternatives create bright and dark patterns. The photon picture is needed when light is absorbed or emitted in discrete energy exchanges, but the wave picture is still needed when light propagates and forms patterns. The two descriptions are not interchangeable decorations; each answers a different kind of physical question.

For Module VI, the main question is usually: *how does light propagate?* For that, the wave description is the working model. It allows us to discuss wavefronts, rays, reflection, refraction, dispersion, polarization, scattering, interference, and diffraction. The particle description stays mostly in the background for now, because detailed photon calculations belong to the next module. Still, it is useful to know already why photons will become necessary: whenever the question becomes *how is light absorbed or emitted by matter?*, the packet-like relation $E = hf$ becomes unavoidable.

So the safest way to say it is this: light is not adequately described by only one classical picture. We started from the simple question “particle or wave?”, saw that propagation naturally requires wave ideas such as wavelength, frequency, wavefronts, and rays, then found that energy exchange with matter requires photons. That gives the guiding rule for the rest of this part of the course: use waves to understand how light moves and forms patterns, and use photons when light exchanges energy with matter.
