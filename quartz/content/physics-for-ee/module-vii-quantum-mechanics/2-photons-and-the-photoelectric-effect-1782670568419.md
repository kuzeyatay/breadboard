---
title: "2) Photons and the photoelectric effect"
date: "2026-06-28T18:16:08.419Z"
source: "user-note"
knowledge_type: "user-note"
---

## Photons and the photoelectric effect

A metal contains electrons, but those electrons are not automatically free to leave the surface. If light shines on the metal, electrons can sometimes be emitted. This phenomenon is called the **photoelectric effect**, and the emitted electrons are called **photoelectrons**. At first, this sounds like something ordinary wave physics should explain: light is an electromagnetic wave, the wave carries energy, and that energy might shake electrons loose from the metal.

The classical wave expectation would be that intensity is the decisive quantity. A brighter light wave carries more energy per second, so it seems reasonable to expect that making the light intense enough should eventually eject electrons, regardless of the color of the light. But the experiment does not behave that way. For a given metal, light below a certain frequency does not emit electrons, even if the light is made very intense. Light above that frequency can emit electrons, even if the beam is weak. The variable that decides whether emission is possible is therefore not simply brightness. It is the energy available in each microscopic light–electron interaction.

That is the point where the photon model becomes necessary. Light exchanges energy with matter in packets called **photons**, and the energy of one photon is

$$
E_{\text{photon}} = hf = \frac{hc}{\lambda}.
$$

Here $E_{\text{photon}}$ is the energy of one photon, $h$ is Planck’s constant, $f$ is the light frequency, $c$ is the speed of light in vacuum, and $\lambda$ is the wavelength of the light in vacuum. The second form follows from $c = f\lambda$, so $f = c / \lambda$. The formula says that color is not just a visual property of light. Frequency determines the energy per photon: higher frequency means larger photon energy, and shorter wavelength means larger photon energy.

This immediately separates two quantities that are often confused. Increasing the intensity of the light means sending more photons per second. Increasing the frequency means making each photon more energetic. The photoelectric effect depends on both, but in different ways. Intensity affects how many electrons may be emitted per second once emission is possible. Frequency determines whether each photon has enough energy to release an electron at all.

[Interactive visual: intensity versus frequency — the student changes light intensity and light frequency separately; the visual shows that intensity changes the number of arriving photons, while frequency changes the energy $E = hf$ of each photon]

To turn this into an energy model, we need to account for the fact that an electron must escape the metal surface. The minimum energy needed to remove an electron from a particular metal surface is called the **work function**, written $\phi$. It is an energy cost. A photon can eject an electron only if its energy is at least large enough to pay this cost:

$$
hf \geq \phi.
$$

If

$$
hf < \phi,
$$

then no photoelectron is emitted in this simple model, because one photon does not provide enough energy for one electron to escape. This is why a very intense beam of low-frequency light still fails: it contains many photons, but each photon is individually too weak.

The boundary case gives the **threshold frequency**. At threshold, the photon has just enough energy to remove the electron, with no kinetic energy left over:

$$
hf_0 = \phi.
$$

So

$$
f_0 = \frac{\phi}{h}.
$$

Light with $f < f_0$ cannot emit photoelectrons from that surface. Light with $f \geq f_0$ can. The same threshold can be written in terms of wavelength. Since $f = c / \lambda$, the threshold wavelength is

$$
\lambda_0 = \frac{hc}{\phi}.
$$

This is a maximum wavelength, not a minimum wavelength. Longer wavelength means lower frequency and lower photon energy. Therefore wavelengths larger than $\lambda_0$ do not eject electrons, while sufficiently short wavelengths can.

Once the photon energy is above threshold, the extra energy does not disappear. The photon brings in energy $hf$. The electron spends $\phi$ escaping from the surface. The leftover energy can become kinetic energy of the emitted electron. For the fastest emitted electrons, the energy balance is

$$
K_{\max} = hf - \phi = \frac{hc}{\lambda} - \phi.
$$

This is the mathematical centerpiece of the photoelectric effect. It is not a new force law; it is an energy budget. Incoming photon energy equals escape cost plus maximum leftover kinetic energy. If the emitted electron has mass $m_e$ and maximum speed $v_{\max}$, then

$$
K_{\max} = \frac{1}{2}m_e v_{\max}^2,
$$

so the photoelectric energy balance can also be written as

$$
\frac{1}{2}m_e v_{\max}^2 = hf - \phi.
$$

The word **maximum** is essential. Not every photoelectron leaves with this energy. Some electrons may lose energy before escaping or may come from less favorable positions inside the material. The equation gives the upper limit: no emitted electron can have more kinetic energy than $hf - \phi$.

[Interactive visual: photoelectric energy budget — the student adjusts $f$ and $\phi$; the visual shows photon energy $hf$, escape cost $\phi$, and leftover kinetic energy $K_{\max} = hf - \phi$]

The next practical question is how this maximum kinetic energy can be measured. We cannot usually watch one electron leave the metal and directly read off its speed. Instead, the experiment uses an electric potential to slow the emitted electrons down. A metal cathode is illuminated so that it emits photoelectrons, and an anode is placed nearby to collect them. If the anode attracts the electrons, a current flows. If the anode is made negative enough relative to the cathode, it repels the electrons. At a certain retarding voltage, even the fastest electrons are just stopped, and the current becomes zero.

The magnitude of this retarding voltage is called the **stopping potential**, written $V_0$. An electron with charge magnitude $e$ loses kinetic energy $eV_0$ while moving against this stopping potential. At the stopping point, this exactly equals the maximum kinetic energy:

$$
eV_0 = K_{\max}.
$$

Combining this measurement relation with the photon energy balance gives

$$
eV_0 = hf - \phi.
$$

Solving for $V_0$,

$$
V_0 = \frac{h}{e}f - \frac{\phi}{e}.
$$

This equation explains the central graph of the photoelectric effect. If the stopping potential $V_0$ is plotted vertically and the light frequency $f$ horizontally, the graph is a straight line. Its slope is

$$
\frac{h}{e},
$$

and its horizontal intercept is

$$
f_0 = \frac{\phi}{h}.
$$

The slope comes from the universal conversion between photon frequency and electron stopping voltage. The intercept comes from the material’s work function. Therefore changing the metal shifts the threshold frequency, but it does not change the ideal slope of the $V_0$-versus-$f$ graph.

![pasted 1782676263213](/physics-for-ee/assets/pasted-1782676263213.png)

This graph is also the cleanest way to repair a common mistaken reading of the experiment. If the frequency is fixed above threshold and the intensity is increased, the current can increase because more photoelectrons are emitted per second. But the stopping potential does not increase, because the maximum kinetic energy of each electron is still determined by

$$
K_{\max} = hf - \phi.
$$

A brighter beam gives more photons, not more energy per photon. A higher-frequency beam gives more energy per photon, and therefore a larger stopping potential.

Because the energies involved are very small in joules, photoelectric-effect problems often use the **electron volt**. One electron volt is the energy gained by an electron when it moves through a potential difference of $1\,\mathrm{V}$:

$$
1\,\mathrm{eV} = e(1\,\mathrm{V}) = 1.6022 \times 10^{-19}\,\mathrm{J}.
$$

This unit fits naturally with stopping potentials. If the stopping potential is $0.181\,\mathrm{V}$, then the maximum kinetic energy is $0.181\,\mathrm{eV}$, because $K_{\max} = eV_0$. The numerical value is the same when electron energy in electron volts is matched to a voltage acting on a single electron.

The photoelectric effect therefore begins as a failure of classical wave intuition and ends as a precise measurement model. The failure is that intensity alone cannot explain electron emission. The new concept is the photon, whose energy is $hf$. The mechanism is an energy budget: the photon must first pay the work function $\phi$, and only the leftover energy becomes electron kinetic energy. The measurement is the stopping potential, which turns that kinetic energy into the straight-line relation $V_0 = (h/e)f - \phi/e$. This prepares the next step: if photons carry energy in discrete packets, then we must also ask whether they carry momentum, which leads to X-ray production and Compton scattering.
