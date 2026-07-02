---
title: "11) Finite wells and tunneling"
date: "2026-06-28T19:10:14.448Z"
source: "user-note"
knowledge_type: "user-note"
---

## Finite wells and tunneling

The infinite square well gave the cleanest example of quantum confinement. The walls were infinitely high, so the particle had zero probability of being outside the box, and the wave function had to vanish at the walls:

$$
\psi(0)=0,
\qquad
\psi(L)=0.
$$

Those boundary conditions forced standing waves, and the standing waves forced discrete energies. But infinitely high walls are an idealization. Real barriers have finite height. That means a particle may still be strongly confined, but the wave function is not forced to stop abruptly at the boundary. The moment the wall becomes finite, quantum mechanics predicts a new behavior: the wave function can penetrate into regions that would be classically forbidden.

The governing equation is still the time-independent Schrödinger equation,

$$
-\frac{\hbar^2}{2m}
\frac{d^2\psi(x)}{dx^2}
+
U(x)\psi(x)
=
E\psi(x),
$$

where $m$ is the particle mass, $U(x)$ is the potential energy, $E$ is the energy of the stationary state, and $\psi(x)$ is the spatial wave function. This equation tells us how the shape of the wave function responds to the potential-energy landscape. The key is to compare the particle’s total energy $E$ with the local potential energy $U(x)$.

In a region where

$$
E>U(x),
$$

the classical kinetic energy

$$
K=E-U(x)
$$

is positive. This is a classically allowed region. If $U(x)=U_0$ is constant there, the Schrödinger equation becomes

$$
-\frac{\hbar^2}{2m}
\frac{d^2\psi}{dx^2}
+
U_0\psi
=
E\psi.
$$

Rearranging gives

$$
\frac{d^2\psi}{dx^2}
=
-\frac{2m(E-U_0)}{\hbar^2}\psi.
$$

If we define

$$
k=\frac{\sqrt{2m(E-U_0)}}{\hbar},
$$

then the equation becomes

$$
\frac{d^2\psi}{dx^2}=-k^2\psi.
$$

The solutions are oscillating sine-and-cosine-like waves. This matches the intuition from the particle in a box: where the particle is classically allowed, the wave function oscillates.

But in a region where

$$
E<U(x),
$$

the classical kinetic energy $K=E-U(x)$ would be negative. A classical particle cannot exist there. If $U(x)=U_0$ is constant and $E<U_0$, the Schrödinger equation becomes

$$
-\frac{\hbar^2}{2m}
\frac{d^2\psi}{dx^2}
+
U_0\psi
=
E\psi.
$$

Now rearranging gives

$$
\frac{d^2\psi}{dx^2}
=
\frac{2m(U_0-E)}{\hbar^2}\psi.
$$

Define

$$
\kappa=
\frac{\sqrt{2m(U_0-E)}}{\hbar}.
$$

Then

$$
\frac{d^2\psi}{dx^2}=\kappa^2\psi.
$$

This equation does not give oscillating solutions. It gives exponential solutions:

$$
\psi(x)\propto e^{-\kappa x}
$$

or

$$
\psi(x)\propto e^{+\kappa x},
$$

depending on the direction and boundary conditions. In a barrier or outside a bound finite well, the physically relevant behavior is usually exponential decay. This is the mathematical centerpiece of finite wells and tunneling: in a classically forbidden region, the wave function does not instantly become zero; it changes from oscillatory to exponential.

[Interactive visual: oscillation versus exponential decay — the student changes $E$ relative to a constant potential $U_0$; the visual shows $\psi$ oscillating when $E>U_0$ and decaying exponentially when $E<U_0$]

This is the essential difference between an infinite wall and a finite wall. An infinite wall imposes an absolute condition: the wave function must vanish at the wall. A finite wall is different. At an ordinary finite potential boundary, the wave function remains continuous, and its slope is also continuous. Instead of being chopped off, the wave function bends into the barrier and decays.

Now apply this to a **finite square well**. Inside the well, the potential is low. For a bound particle, the energy is high enough compared with the inside potential that the wave function oscillates inside the well. Outside the well, the potential is higher than the particle energy, so the outside regions are classically forbidden. But because the walls are finite, the wave function does not become zero at the edges. It leaks into the outside regions as exponentially decaying tails.

[Interactive visual: finite well tails — the student changes the well depth and width; the visual compares an infinite-box wave function that stops at the walls with a finite-well wave function that oscillates inside and decays outside]

Those tails have direct physical meaning. Since

$$
|\psi(x)|^2
$$

is probability density, a nonzero wave-function tail means a nonzero probability of finding the particle slightly outside the classical well. The particle is still bound if the wave function decays to zero far away, but it is not perfectly confined to the inside region.

This repairs an important misconception. The particle is not outside the well because it secretly has enough energy to escape. For a bound state in a finite well, the particle energy is still below the outside potential level. Classically it could not be outside. The nonzero probability outside is a consequence of the wave nature of $\psi$, not extra hidden kinetic energy.

Finite wells also change the energy levels. In the infinite box, every positive integer

$$
n=1,2,3,\ldots
$$

gave an allowed bound state. There were infinitely many possible levels. In a finite well, only a finite number of bound states can exist. A shallow or narrow well may support only a few bound states. A deeper or wider well can support more. The energies are still discrete, because the wave function must satisfy boundary conditions, but the allowed wave shapes now include exponential tails outside the well. Because the wave spreads beyond the classical width of the well, the confinement is effectively less severe than in an infinite box of the same width, so the corresponding bound-state energies are lower.

The same exponential penetration becomes even more dramatic when the potential is a barrier rather than a well. Suppose a particle approaches a rectangular barrier of height $U_0$ and width $L$, with energy

$$
E<U_0.
$$

Classically, the particle cannot cross. It does not have enough energy to be in the barrier region, so it should reflect. Quantum mechanically, the incident wave reaches the barrier and becomes an exponentially decaying wave inside it. If the barrier has finite width, the wave function may still be nonzero at the far side. Once it reaches the region beyond the barrier, it can become an oscillating transmitted wave again. This is **quantum tunneling**.

[Interactive visual: tunneling through a finite barrier — the student changes $U_0$, $E$, and $L$; the visual shows an incident oscillating wave, exponential decay inside the barrier, and a smaller transmitted wave beyond it]

The probability of transmission is described by the **transmission coefficient** $T$. The probability of reflection is described by the **reflection coefficient** $R$. For a simple barrier with no absorption,

$$
R+T=1.
$$

When $E<U_0$, the transmission probability is often approximated by

$$
T\approx G e^{-2\kappa L},
$$

where $L$ is the barrier width,

$$
\kappa=
\frac{\sqrt{2m(U_0-E)}}{\hbar},
$$

and $G$ is a prefactor that depends on the detailed matching of the wave function at the barrier boundaries. The exponential factor is the main message. Tunneling becomes much less likely when the barrier is wider, when the barrier is higher above the particle energy, or when the particle mass is larger.

The factor of $2$ in the exponent comes from the difference between amplitude and probability. Inside the forbidden region, the wave-function amplitude decays roughly like

$$
e^{-\kappa x}.
$$

After crossing a barrier of width $L$, the amplitude has been reduced roughly by

$$
e^{-\kappa L}.
$$

But probability depends on the absolute square of the amplitude. Squaring gives

$$
\left(e^{-\kappa L}\right)^2=e^{-2\kappa L}.
$$

That is why the transmission probability contains the factor $e^{-2\kappa L}$, not merely $e^{-\kappa L}$.

[Interactive visual: exponential sensitivity of tunneling — the student doubles $L$, increases $U_0-E$, or changes $m$; the visual shows $T\approx Ge^{-2\kappa L}$ dropping rapidly because the dependence is exponential]

This is the cleanest way to avoid the most common wrong picture of tunneling. Tunneling does not mean the particle borrows energy to climb over the barrier. The particle energy remains $E$, below $U_0$. It does not go over the barrier in the classical sense. The wave function penetrates into the classically forbidden region, decays there, and if the barrier is thin enough, leaves a nonzero amplitude on the far side. When a position measurement is made later, there is a nonzero probability that the particle is detected beyond the barrier.

The word “forbidden” therefore needs care. A classically forbidden region is forbidden because $E-U<0$, so a classical kinetic energy would be negative. Quantum mechanically, this does not force $\psi$ to be zero. It changes the type of solution: oscillating where $E>U$, exponential where $E<U$. The probability density in the forbidden region may be small, but it is not automatically zero.

Tunneling is not just a mathematical curiosity. It matters whenever quantum particles encounter thin barriers. In electronics, tunneling can occur through very thin insulating layers or junctions. In alpha decay, a particle can escape a nucleus by tunneling through a barrier. In scanning tunneling microscopy, the tunneling current changes extremely strongly with tip-sample distance because the transmission depends exponentially on barrier width. The same factor,

$$
e^{-2\kappa L},
$$

explains why tiny changes in distance can produce large changes in tunneling probability.

The whole subsection is therefore one consequence of replacing infinite walls by finite potentials. In the infinite box, the wave function was forced to zero at the walls. In a finite well, the wave function penetrates beyond the classical boundary and decays, producing bound states with exponential tails and only a finite number of allowed levels. In a finite barrier, the same exponential penetration allows a nonzero transmitted wave, giving tunneling with approximate transmission

$$
T\approx Ge^{-2\kappa L}.
$$

We began with the idealized box, asked what changes when the barriers become finite, and found that the Schrödinger equation changes the wave function from oscillatory to exponential whenever $E<U$. That single rule explains finite-well leakage, tunneling, and the extreme sensitivity of transmission to barrier width. The next subsection applies the same stationary-state logic to a smoother confining potential: the quantum harmonic oscillator.
