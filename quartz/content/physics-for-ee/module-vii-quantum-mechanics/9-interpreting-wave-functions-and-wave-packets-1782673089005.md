---
title: "9) Interpreting wave functions and wave packets"
date: "2026-06-28T18:58:09.005Z"
source: "user-note"
knowledge_type: "user-note"
---

## Interpreting wave functions and wave packets

The free-particle Schrödinger equation gave us a rule for how a matter wave evolves:

$$
i\hbar\frac{\partial \Psi}{\partial t}
= -\frac{\hbar^2}{2m}
\frac{\partial^2\Psi}{\partial x^2}.
$$

But an equation of motion is only useful if we know what the object in the equation means. In Newtonian mechanics, the object being solved for is usually a position $x(t)$: where the particle is as a function of time. In quantum mechanics, the object being solved for is different. It is the wave function

$$
\Psi(x,t),
$$

which depends on position $x$ and time $t$. The wave function is not the vertical displacement of a string, the pressure in a sound wave, or a small piece of matter spread through space. It is a **probability amplitude**. It contains the information needed to predict probabilities for measurement outcomes.

This distinction matters because $\Psi(x,t)$ is generally complex. It can have a real part, an imaginary part, and a phase. The complex value itself is not directly measured as a physical displacement. Instead, the measurable position information comes from the absolute square of the wave function:

$$
|\Psi(x,t)|^2.
$$

For a complex wave function, the absolute square is

$$
|\Psi(x,t)|^2=\Psi^*(x,t)\Psi(x,t),
$$

where $\Psi^*(x,t)$ is the complex conjugate of $\Psi(x,t)$. This product is always real and nonnegative, so it can be used as a probability density.

This is the mathematical centerpiece of wave-function interpretation: in one dimension,

$$
|\Psi(x,t)|^2
$$

is the **probability density** for finding the particle near position $x$ at time $t$. The word density is essential. It does not mean that $|\Psi(x,t)|^2$ is the probability of finding the particle at exactly one mathematical point. A point has no width, so the useful probability is found over an interval. The probability of finding the particle between $x=a$ and $x=b$ at time $t$ is

$$
P(a<x<b)=\int_a^b |\Psi(x,t)|^2\,dx.
$$

The integral appears because probability density must be accumulated over a region. A larger area under the curve $|\Psi|^2$ means a larger probability of detecting the particle in that region.

[Interactive visual: wave function and probability density — the student changes the shape of $\Psi(x,t)$ and sees $|\Psi(x,t)|^2$ plotted underneath; selecting an interval $[a,b]$ shades the area $\int_a^b|\Psi|^2\,dx$ as the probability of finding the particle there]

If $|\Psi|^2$ is a probability density, then the total probability of finding the particle somewhere must be one. For a one-dimensional particle that can be anywhere on the $x$-axis, this gives the normalization condition

$$
\int_{-\infty}^{\infty}|\Psi(x,t)|^2\,dx=1.
$$

This is called **normalization**. It is not a cosmetic step after the physics is finished. It is what makes the wave function physically meaningful as a probability amplitude. If the total area under $|\Psi|^2$ were not one, the wave function would not correctly represent one particle distributed over possible positions.

This immediately clarifies the limitation of the plane wave used in the previous subsection. The simple free-particle solution

$$
\Psi(x,t)=A e^{i(kx-\omega t)}
$$

is useful because it has one definite wave number $k$. Since

$$
p=\hbar k,
$$

it represents a state with definite momentum. But its probability density is

$$
|\Psi(x,t)|^2
= |A e^{i(kx-\omega t)}|^2
= |A|^2.
$$

The density is the same everywhere. That means the particle is equally likely to be found anywhere along the entire $x$-axis. Over an infinite line,

$$
\int_{-\infty}^{\infty}|A|^2\,dx
$$

does not converge unless $A=0$, which would describe no particle at all. So a single infinite plane wave is not a realistic localized particle. It is an idealized state with definite momentum but completely indefinite position.

This is not a defect in the Schrödinger equation. It is exactly the tradeoff expected from the uncertainty principle. A single $k$-value gives a precise momentum, but the corresponding wave extends everywhere. To make a particle localized in space, we must give up the idea of using only one $k$-value.

A localized quantum particle is represented by a **wave packet**. A wave packet is built by superposing several waves with different wave numbers. Schematically, we can write

$$
\Psi(x,t)
= A_1e^{i(k_1x-\omega_1t)}
+ A_2e^{i(k_2x-\omega_2t)}
+ A_3e^{i(k_3x-\omega_3t)}
+ \cdots.
$$

Each term is a plane-wave component with its own wave number $k_j$, angular frequency $\omega_j$, and complex amplitude $A_j$. The components interfere. In some regions, their phases line up and the amplitude becomes large. In other regions, they cancel and the amplitude becomes small. The result can be a wave function concentrated in a finite region of space.

[Interactive visual: building a wave packet — the student adds plane waves with nearby $k$-values and watches them interfere to form a localized envelope; the visual shows that localization requires a spread of wave numbers]

This gives a more concrete meaning to the uncertainty relation. If a packet is broad in space, it can be made from a narrow range of $k$-values, so its momentum is relatively well defined. If a packet is narrow in space, it requires many different $k$-values, so it contains a wider range of momenta. Since momentum and wave number are related by

$$
p=\hbar k,
$$

a spread in $k$ is a spread in momentum. The more tightly the particle is localized, the less sharply its momentum is defined. This is the wave-packet version of

$$
\Delta x\,\Delta p\geq \frac{\hbar}{2},
$$

where $\Delta x$ measures the spatial width of the packet and $\Delta p$ measures the spread in momentum.

[Interactive visual: wave-packet uncertainty — the student narrows the spatial packet and sees its $k$-spectrum broaden; the visual connects packet width $\Delta x$, wave-number spread $\Delta k$, and momentum spread $\Delta p=\hbar\Delta k$]

This also prevents another common wrong picture. A wave packet is not a little cloud of material smeared through space like smoke. The particle is still detected as a localized event when its position is measured. The wave function gives the probability distribution for where that event may occur. Where $|\Psi|^2$ is large, detection is more likely. Where $|\Psi|^2$ is zero, detection will not occur. Before measurement, quantum mechanics does not describe the particle as following one hidden classical trajectory inside the packet.

The packet can also change shape with time. For a free nonrelativistic particle, the plane-wave components obey the dispersion relation

$$
\omega=\frac{\hbar k^2}{2m}.
$$

Because $\omega$ depends on $k^2$, different $k$-components evolve at different rates. A localized free-particle packet can therefore spread as time passes. This is another sign that a quantum particle is not just a classical point particle with an unknown position. Localization requires a range of momenta, and that range affects the later motion of the probability distribution.

The full complex wave function also contains more information than the probability density at one instant. Two wave functions can have the same $|\Psi|^2$ but different phases. Those phases may affect later interference and time evolution. So $|\Psi|^2$ tells us the position probability density at a given time, but $\Psi$ itself contains the amplitude and phase information needed to predict what happens next.

The interpretation of wave functions therefore turns the abstract matter wave into a prediction rule. We began with the question of what $\Psi(x,t)$ means. The answer is that $\Psi$ is a complex probability amplitude, and its absolute square

$$
|\Psi|^2=\Psi^*\Psi
$$

is a probability density. Integrating that density over an interval gives the probability of detecting the particle there, and normalization makes the total probability equal to one. A single plane wave has definite momentum but no localization, so localized particles require wave packets built from many $k$-components. That packet structure naturally connects localization to momentum uncertainty. This prepares the next subsection: using the probability interpretation together with the time-independent Schrödinger equation to find allowed stationary states in potentials.
