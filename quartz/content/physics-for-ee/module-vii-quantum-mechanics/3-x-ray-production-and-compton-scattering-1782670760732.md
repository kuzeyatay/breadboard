---
title: "3) X-ray production and Compton scattering"
date: "2026-06-28T18:19:20.732Z"
source: "user-note"
knowledge_type: "user-note"
---

## X-ray production and Compton scattering

The photoelectric effect showed that light can be **absorbed** as photons. A photon arrives with energy $E=hf$, gives that energy to an electron, and if the energy is large enough, the electron can escape from the material. That naturally raises the reverse question: if light can be absorbed in packets, can light also be **emitted** in packets? X-ray production gives one direct answer.

An X-ray tube begins with electrons, not photons. Electrons are accelerated through a large potential difference $V_{AC}$, typically on the order of $10^4\,\mathrm{V}$. Since an electron has charge magnitude $e$, the electric field gives each electron kinetic energy

$$
K=eV_{AC}.
$$

Here $K$ is the kinetic energy gained by the electron, $e$ is the elementary charge, and $V_{AC}$ is the accelerating voltage between cathode and anode. The notation $V_{AC}$ is just the voltage used to accelerate the electron before it hits the target. A larger voltage means a larger electron kinetic energy.

When these fast electrons hit the anode material, they are slowed down abruptly. Accelerated charges emit electromagnetic radiation, and a rapidly decelerated electron can emit very short-wavelength radiation: X-rays. This radiation is called **bremsstrahlung**, meaning braking radiation. In reality, the electron may lose its energy through several collisions and interactions, so the emitted X-rays form a continuous spectrum rather than a single wavelength.

The photon model becomes essential when we ask for the shortest possible wavelength in that spectrum. The most energetic possible X-ray photon is produced in the limiting case where one incoming electron is braked to a complete stop and all of its kinetic energy becomes one photon. That is the maximum-frequency, minimum-wavelength case:

$$
K = E_{\text{photon}}.
$$

Using $K=eV_{AC}$ and $E_{\text{photon}}=hf=hc/\lambda$, this gives

$$
eV_{AC}=hf_{\max}=\frac{hc}{\lambda_{\min}}.
$$

This is the first mathematical centerpiece of X-ray production. It is an energy-conservation statement. The accelerating voltage gives the electron an energy $eV_{AC}$. No emitted photon can have more energy than that, because the photon cannot receive more energy than the electron had. Therefore the X-ray spectrum has a maximum frequency $f_{\max}$ and a minimum wavelength $\lambda_{\min}$.

Solving for the minimum wavelength gives

$$
\lambda_{\min}=\frac{hc}{eV_{AC}}.
$$

This formula shows why increasing the accelerating voltage produces harder, shorter-wavelength X-rays. A larger $V_{AC}$ gives the electrons more kinetic energy, so a single photon can be emitted with more energy. Since $E=hc/\lambda$, more photon energy means smaller wavelength.

[Interactive visual: X-ray spectrum cutoff — the student changes $V_{AC}$ and observes the continuous X-ray spectrum shift so that $\lambda_{\min}=hc/(eV_{AC})$ becomes shorter when the voltage increases]

This also repairs a common wrong interpretation of the X-ray spectrum. Suppose the accelerating voltage stays fixed, but more electrons are emitted per second. Then more electrons hit the anode per second, so more X-ray photons are produced and the intensity of the spectrum increases. But the shortest wavelength does not change, because $\lambda_{\min}$ is set by the energy available to each electron:

$$
\lambda_{\min}=\frac{hc}{eV_{AC}}.
$$

Changing the number of electrons changes how much radiation is produced. Changing $V_{AC}$ changes the maximum possible photon energy.

This same idea explains why X-rays can produce medical contrast. X-ray photons can be absorbed by electrons in atoms. Materials containing atoms with many electrons tend to absorb X-rays more strongly than materials made mostly of lighter atoms. Bone contains elements such as phosphorus and calcium, while soft tissue contains mostly lighter elements such as hydrogen, carbon, and oxygen. Bone therefore absorbs more X-rays, while soft tissue transmits more, producing contrast in an X-ray image. The imaging example is not a separate law; it is an application of photon interactions with matter.

So far, photons have been treated mainly as carriers of energy. But X-ray scattering shows that this is still not enough. When X-rays hit matter, some radiation is scattered. A classical wave model can describe scattering as absorption and re-radiation of a wave, and that picture would suggest that the scattered radiation should have the same frequency and wavelength as the incident radiation. Compton scattering shows something different. When X-rays scatter from electrons, part of the scattered radiation has a lower frequency and therefore a longer wavelength than the incoming radiation.

To explain that, a photon must carry not only energy but also momentum. The starting point is again the photon energy relation

$$
E=hf.
$$

For a particle with mass $m$ and momentum $p$, relativity gives the energy-momentum relation

$$
E^2=(mc^2)^2+(pc)^2.
$$

For a photon, the rest mass is zero, so $m=0$. The relation becomes

$$
E^2=(pc)^2,
$$

so

$$
E=pc.
$$

Combining this with $E=hf$,

$$
pc=hf.
$$

Therefore the momentum of a photon is

$$
p=\frac{hf}{c}.
$$

Since $f=c/\lambda$, this can also be written as

$$
p=\frac{h}{\lambda}.
$$

The photon momentum points in the direction of propagation. This is the second mathematical centerpiece of the subsection, because Compton scattering cannot be understood as an energy exchange alone. It must be treated as a collision in which both energy and momentum are conserved.

[Interactive visual: photon momentum — the student changes photon wavelength and sees the momentum $p=h/\lambda$ arrow grow for shorter wavelength, emphasizing that a massless photon can still carry momentum]

In Compton scattering, an incoming photon hits an electron that is initially at rest. After the collision, the photon leaves at an angle $\phi$ relative to its original direction, and the electron recoils. The photon has transferred some energy and momentum to the electron. Since the scattered photon has less energy than before, its frequency is lower. Since $E=hc/\lambda$, lower energy means longer wavelength. So the scattered wavelength $\lambda'$ is larger than the incident wavelength $\lambda$.

The quantitative result is

$$
\lambda'-\lambda=\frac{h}{m_ec}(1-\cos\phi).
$$

Here $\lambda$ is the incident photon wavelength, $\lambda'$ is the scattered photon wavelength, $m_e$ is the electron mass, $c$ is the speed of light, and $\phi$ is the scattering angle of the photon. The factor

$$
\frac{h}{m_ec}
$$

has units of length and is called the Compton wavelength of the electron. The formula comes from applying conservation of energy and conservation of momentum to the photon-electron collision. The derivation is not needed here, but the structure of the formula is important.

First, the shift depends on the scattering angle. If $\phi=0^\circ$, then the photon continues forward, $\cos\phi=1$, and

$$
\lambda'-\lambda=0.
$$

There is no wavelength shift in that forward-scattering limit. If $\phi=180^\circ$, then the photon scatters straight backward, $\cos\phi=-1$, and the shift is largest:

$$
\lambda'-\lambda=\frac{2h}{m_ec}.
$$

Second, the formula always gives $\lambda'\geq \lambda$, because $1-\cos\phi\geq 0$. The scattered photon does not gain energy in this setup. It loses energy to the recoiling electron, so its wavelength becomes longer. Saying “less energy and momentum” should therefore lead to **longer** wavelength, not shorter wavelength. That is a common place to make a sign mistake: photon energy is inversely proportional to wavelength.

[Interactive visual: Compton collision — the student changes the scattering angle $\phi$ and observes the recoiling electron, the scattered photon direction, and the wavelength shift $\lambda'-\lambda=\frac{h}{m_ec}(1-\cos\phi)$]

The contrast with ordinary wave scattering is the central lesson. In the wave-only picture, scattering can be imagined as the wave driving electrons to oscillate and re-radiate at the same frequency. In Compton scattering, the photon behaves like a collision partner. It arrives with energy $hf$ and momentum $h/\lambda$, gives some of both to the electron, and leaves with lower energy and longer wavelength. This does not mean light has stopped being wave-like in all situations. It means that scattering at this microscopic level requires the particle side of the photon model.

X-ray production and Compton scattering therefore extend the photon idea in two directions. X-ray production shows that electron kinetic energy can be converted into emitted photons, with the cutoff wavelength set by $eV_{AC}=hc/\lambda_{\min}$. Compton scattering shows that photons carry momentum as well as energy, with $p=h/\lambda$, and that a photon-electron collision changes the photon wavelength according to $\lambda'-\lambda=\frac{h}{m_ec}(1-\cos\phi)$. We started from photon absorption in the photoelectric effect, then saw photon emission in X-ray production, and finally saw photon momentum in scattering. That prepares the next step: if light can behave like particles, we must ask whether particles such as electrons can also behave like waves.
