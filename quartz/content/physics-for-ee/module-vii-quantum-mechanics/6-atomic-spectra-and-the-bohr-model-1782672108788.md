---
title: "6) Atomic spectra and the Bohr model"
date: "2026-06-28T18:41:48.788Z"
source: "user-note"
knowledge_type: "user-note"
---

## Atomic spectra and the Bohr model

Matter waves give us a new way to think about electrons, but the need for this new picture becomes especially clear when we look at atoms. If a gas is heated or excited electrically, it can emit light. When that light is passed through a prism or diffraction grating, the result is not a continuous rainbow. Instead, the gas emits only certain sharp colors, called **spectral lines**. Hydrogen, for example, emits particular wavelengths rather than every possible wavelength.

This is immediately significant because photon energy is tied to wavelength:

$$
E_{\text{photon}}=hf=\frac{hc}{\lambda}.
$$

Here $E_{\text{photon}}$ is the photon energy, $h$ is Planck’s constant, $f$ is the photon frequency, $c$ is the speed of light in vacuum, and $\lambda$ is the photon wavelength in vacuum. A line spectrum therefore means that the atom emits only certain photon energies. If photons are emitted when the atom changes its internal energy, then the atom itself cannot have arbitrary energies. It must have a discrete set of allowed energy levels.

[Interactive visual: gas spectrum to energy levels — the student compares a continuous spectrum with a line spectrum; selecting a spectral line shows the photon energy $E=hc/\lambda$ and the atomic energy gap that produced it]

Absorption gives the same message from the opposite direction. If white light passes through a gas, certain wavelengths are missing afterward. The gas has absorbed only photons with particular energies. In the simple level model, an atom absorbs a photon only when the photon energy matches the gap between an occupied lower level and an allowed higher level:

$$
hf=E_{\text{higher}}-E_{\text{lower}}.
$$

This repairs a common wrong intuition. For an atomic transition, a photon does not merely need to have “enough” energy. It must have the right energy. If the energy gap is $2.5\,\mathrm{eV}$, then the photon energy for that transition must be $2.5\,\mathrm{eV}$. A larger photon energy does not automatically excite the same transition, because the atom does not accept arbitrary leftover energy in this simple picture.

The next question is why the atom has discrete levels at all. Before the quantum picture, one possible model was Thomson’s model: the atom was imagined as a positively charged sphere with electrons embedded in it. That model could make absorption sound like resonance, where electrons oscillate and absorb light at certain natural frequencies. But Rutherford’s scattering experiment showed that the atom is not built that way. The positive charge is concentrated in a tiny, dense nucleus, much smaller than the atom itself, and the electrons are outside this nucleus.

The nuclear atom creates a severe classical problem. The negatively charged electron is attracted to the positively charged nucleus. If the electron simply moved in an ordinary circular orbit, it would be an accelerating charge. Classical electromagnetism says that accelerating charges radiate electromagnetic waves, and radiation carries energy away. So a classical orbiting electron should lose energy, spiral inward, and collapse into the nucleus. As it spiralled inward, its orbital frequency and emitted radiation would change continuously. Stable atoms and sharp spectral lines would both be unexplained.

Bohr’s model repairs this by adding quantum restrictions to the nuclear atom. It is not the final modern model; later, circular orbits will be replaced by wave functions and probability densities. But Bohr’s model is the first simple model that connects matter waves, quantized angular momentum, stable atomic states, and hydrogen spectral lines.

Bohr’s first key idea is that not every orbit is allowed. The electron in hydrogen may occupy only certain circular orbits, labelled by a positive integer $n$. The allowed orbits satisfy the angular-momentum condition

$$
L=m v_n r_n=n\hbar,
\qquad n=1,2,3,\ldots
$$

where $L$ is the electron’s angular momentum, $m$ is the electron mass, $v_n$ is the electron speed in the $n$-th orbit, $r_n$ is the radius of that orbit, and

$$
\hbar=\frac{h}{2\pi}
$$

is the reduced Planck constant. There is no $n=0$ orbit in this model; the integer $n$ starts at 1.

This angular-momentum rule may look artificial until it is connected to matter waves. If the electron has De Broglie wavelength

$$
\lambda=\frac{h}{p},
$$

then a stable circular orbit can be imagined as a wave that fits around the circumference. For the wave to match itself after one full loop, the circumference must contain an integer number of wavelengths:

$$
n\lambda=2\pi r_n.
$$

Using $p=h/\lambda$, this becomes

$$
p r_n=\frac{nh}{2\pi}=n\hbar.
$$

For a nonrelativistic electron, $p=mv_n$, so

$$
m v_n r_n=n\hbar.
$$

The allowed orbits are therefore standing-wave-like conditions around the nucleus. An orbit that does not fit an integer number of matter wavelengths does not form an allowed stable state in this model.

[Interactive visual: standing matter wave around an atom — the student changes $n$ and sees when an integer number of electron wavelengths fits around the circumference $2\pi r_n$, producing $n\lambda=2\pi r_n$]

Bohr’s second key idea is that these allowed orbits are stable. This is the direct break with classical electromagnetism. In classical physics, an accelerating electron in circular motion should radiate continuously. In the Bohr model, an electron in an allowed orbit does not radiate while it remains in that orbit. This is a postulate, not something derived from classical mechanics. It is inserted because atoms are stable and their spectra are discrete.

To turn the allowed-orbit idea into a calculation, Bohr still uses one classical ingredient: circular force balance. The Coulomb attraction between the proton and electron supplies the centripetal force:

$$
\frac{e^2}{4\pi\varepsilon_0 r_n^2}=\frac{m v_n^2}{r_n}.
$$

Here $e$ is the elementary charge and $\varepsilon_0$ is the permittivity of vacuum. The left side is the electric attraction; the right side is the centripetal force needed for circular motion. This equation alone would allow many possible radii. The quantization condition

$$
m v_n r_n=n\hbar
$$

selects only certain ones.

Combining these two relations gives the allowed orbit radii

$$
r_n=n^2a_0,
$$

where $a_0$ is the Bohr radius. The detailed expression for $a_0$ is less important here than the structure of the result: the radius grows like $n^2$. Higher allowed states are farther from the nucleus.

The energy of the electron in one of these allowed states is the sum of kinetic energy and electric potential energy:

$$
E_n=K_n+U_n.
$$

The kinetic energy is positive, while the electric potential energy is negative because the electron is bound to the nucleus. In the Bohr model for hydrogen, the total energy becomes

$$
E_n=-\frac{hcR}{n^2},
\qquad n=1,2,3,\ldots
$$

where $R$ is the Rydberg constant,

$$
R=1.097\times10^7\,\mathrm{m^{-1}}.
$$

This is the mathematical centerpiece of the Bohr model. Hydrogen has discrete total energies proportional to $-1/n^2$. The negative sign means the electron is bound. The value $E=0$ corresponds to the electron being free, infinitely far from the nucleus.

This formula has an important sign trap. When $n$ increases, $1/n^2$ decreases, so

$$
E_n=-\frac{hcR}{n^2}
$$

becomes less negative. Less negative means higher total energy. Therefore the $n=2$ state has higher total energy than the $n=1$ state. But the kinetic energy behaves differently: in the Bohr model,

$$
K_n\propto \frac{1}{n^2}.
$$

So an electron in a higher orbit has lower kinetic energy but higher total energy. That is not a contradiction, because total energy includes the negative potential energy. Higher $n$ means the electron is less tightly bound.

[Interactive visual: Bohr energy ladder — the student changes $n$ and sees $r_n$, $K_n$, and $E_n$; the visual emphasizes that $E_n$ rises toward zero while $K_n$ decreases]

Now the line spectrum can finally be explained. Bohr’s third key idea is that light is emitted or absorbed only when the electron jumps between allowed energy levels. If an electron drops from an upper level $E_U$ to a lower level $E_L$, the atom loses energy, and that energy is emitted as one photon:

$$
hf=E_U-E_L.
$$

Here $E_U$ is the higher initial energy and $E_L$ is the lower final energy. Since the allowed energies are discrete, the possible differences $E_U-E_L$ are also discrete. Therefore the emitted photon energies are discrete, and the spectrum consists of lines.

Using

$$
E_n=-\frac{hcR}{n^2},
$$

with an upper level $n_U$ and a lower level $n_L$, where $n_U>n_L$, the emitted photon energy becomes

$$
hf=hcR\left(\frac{1}{n_L^2}-\frac{1}{n_U^2}\right).
$$

Since $f=c/\lambda$, this gives the Rydberg formula:

$$
\frac{1}{\lambda}=R\left(\frac{1}{n_L^2}-\frac{1}{n_U^2}\right).
$$

Here $\lambda$ is the emitted photon wavelength, $n_U$ is the upper quantum number, and $n_L$ is the lower quantum number. The order in the parentheses matters. Because $n_U>n_L$, the term $1/n_L^2$ is larger than $1/n_U^2$, so the right-hand side is positive.

[Interactive visual: hydrogen transition calculator — the student chooses $n_U$ and $n_L$; the visual shows the electron transition, computes $1/\lambda=R(1/n_L^2-1/n_U^2)$, and places the emitted photon on a spectral line diagram]

Absorption is the reverse transition. An electron in a lower state can move to a higher state only if the incoming photon has exactly the required energy:

$$
hf=E_U-E_L.
$$

This is why absorption spectra contain dark lines at the same wavelengths that the gas can emit. The atom removes photons whose energies match its allowed energy gaps.

The Bohr model therefore turns the puzzle of spectral lines into a chain of quantum restrictions. Gases emit and absorb only certain wavelengths because atoms have only certain allowed energy levels. Those levels arise in Bohr’s model from matter-wave fitting and angular-momentum quantization. The stable-orbit postulate prevents the classical collapse of the atom. Transitions between allowed levels emit or absorb photons whose energies equal level differences, producing the Rydberg formula for hydrogen. The next subsection builds on this same transition idea: if atoms can emit photons when electrons move between quantized levels, then controlled transitions can produce lasers, and quantized energy exchange also becomes essential for understanding blackbody radiation.
