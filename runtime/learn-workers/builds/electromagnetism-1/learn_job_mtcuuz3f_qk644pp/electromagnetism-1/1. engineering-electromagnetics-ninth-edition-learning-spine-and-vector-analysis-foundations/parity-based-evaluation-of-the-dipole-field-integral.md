---
title: "1.319 Parity-Based Evaluation of the Dipole Field Integral"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 543", "Page 544", "Section 14.4.2"]
related: ["finite-dipole-as-a-superposition-of-hertzian-dipoles", "dipole-e-plane-pattern-function", "radiation-intensity-directivity-and-radiation-resistance"]
---

# 1.319 Parity-Based Evaluation of the Dipole Field Integral

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 543, Page 544, Section 14.4.2

The finite-dipole field integral is simplified by exploiting symmetry. After writing $e^{jkz\cos\theta}$ as cosine plus $j$ times sine, the current factor $\sin[k(\ell-|z|)]$ is recognized as even in $z$. Its product with $\cos(kz\cos\theta)$ is also even, while its product with $\sin(kz\cos\theta)$ is odd. The odd contribution integrates to zero over the symmetric interval from $-\ell$ to $+\ell$. The remaining even integral can therefore be evaluated as twice the integral from $0$ to $\ell$. Product-to-sum identities then convert the product of sine and cosine into integrable sine terms. This procedure yields the angular numerator $\cos(k\ell\cos\theta)-\cos(k\ell)$ and a factor involving $\sin^2\theta$. Recombining this integral with the prefactor produces a separable far-zone field: a constant field amplitude, an angular pattern function, and the spherical propagation factor $e^{-jkr}/r$. The derivation illustrates why geometric symmetry is central to antenna integration and why the final field depends only on $\theta$ for a single vertical dipole.

## Page-Grounded Details

#### Page 543

Figure 14.7 A dipole antenna can be represented as a stack of Hertzian dipoles whose individual phasor currents are given by $I_{s}(z)$. One Hertzian dipole is shown at location $z$, and has length $dz$. When the observation point, $P$, lies in the far zone, distance lines $r$ and $r^{\prime}$ are approximately parallel, so they differ in length by $z\cos\theta$.

distance $r^{\prime}$ from the Hertzian at location $z$ and the distance $r$ from the origin to the same point as
$$
r^{\prime}\doteq r-z\cos\theta\quad{(54)}
$$
where, in the far field, $\theta^{\prime}\doteq\theta$, and distance lines $r^{\prime}$ and $r$ are approximately parallel. Eq. (53) is then modified to read
$$
d\,E_{\theta s}=j\frac{I_{s}(z)k\,dz}{4\pi r}\eta\,\sin\theta\,e^{-jk(r-z\cos\theta)}\quad{(55)}
$$
Notice that in obtaining (55) from (53) we have approximated $r^{\prime}\doteq r$ in the denominator, as the use of Eq. (54) will make little difference when considering amplitude variations with $z$ and $\theta$. The exponential term in (55) does include (54) because slight variations in $z$ or $\theta$ will greatly affect the phase.

Now, the total electric field at

[Truncated for analysis]

#### Page 544

integral as A, we write:
$$
E_{\theta s}(r, \theta)=A \int_{-\ell}^{\ell} \frac{\sin k(\ell - |z|)}{\text{even}} \underbrace{\cos(kz \cos \theta)}_{\text{even}}+j \frac{\sin k(\ell - |z|)}{\text{even}} \underbrace{\frac{\sin(kz \cos \theta)}{\text{odd}}} dz
$$
in which the even or odd parity of each term is indicated. The imaginary part of the integrand, consisting of the product of even and odd functions, yields a term with net odd parity; it thus integrates to zero over the symmetric limits of $-\ell$ to $\ell$. This leaves the real part, whose integral can be expressed over the positive $z$ range and then further simplified using trigonometric identities:
$$
\begin{align*}E_{\theta s}(r, \theta)&=2A \int_{0}^{\ell} \sin k(\ell - z) \cos(kz \cos \theta) dz\\&=A \int_{0}^{\ell} \sin [k(\ell - z) + kz \cos \theta] + \sin [k(\ell - z) - kz \cos \theta]dz\\&=A \int_{0}^{\ell} \sin [kz(\cos \theta - 1) + k\ell] - \sin [kz(\cos \theta + 1) - k\ell]dz\end{align*}
$$
The last integral is straightforward and evaluates as
$$
E_{\theta s}(r, \theta)=2A \left[ \frac{\cos(k\ell \cos \theta) - \cos(k\ell)}{k \sin^2 \theta} \right]
$$
Now, reincorporating the expression for A gives

[Truncated for analysis]

## Core Ideas

- The current distribution $\sin[k(\ell-|z|)]$ is even in $z$.
- The cosine term from Euler's identity is even, while the sine term is odd.
- The product of the even current and odd sine term integrates to zero over symmetric limits.
- The surviving integral is doubled and evaluated over $0\le z\le\ell$.
- Product-to-sum identities reduce the remaining product to elementary sine integrals.
- The evaluated integral contains $\cos(k\ell\cos\theta)-\cos(k\ell)$.
- The resulting field separates into amplitude, angular pattern, and radial propagation factors.

## Source Anchors

- Page 544 explicitly labels the current and cosine terms as even and the sine term as odd.
- Page 544 states that the imaginary, odd-parity part integrates to zero from $-\ell$ to $+\ell$.
- The surviving term is written as $2A\int_0^\ell\sin[k(\ell-z)]\cos(kz\cos\theta)\,dz$.
- The evaluated integral is $2A[\cos(k\ell\cos\theta)-\cos(k\ell)]/[k\sin^2\theta]$.
- The final field is $E_{\theta s}=j\frac{I_0\eta}{2\pi r}e^{-jkr}[\cos(k\ell\cos\theta)-\cos(k\ell)]/\sin\theta$.
- The field amplitude is identified as $E_0=jI_0\eta/(2\pi)$.

## Related Pages

- [[finite-dipole-as-a-superposition-of-hertzian-dipoles|Finite Dipole as a Superposition of Hertzian Dipoles]]
- [[dipole-e-plane-pattern-function|Dipole E-Plane Pattern Function]]
- [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]

## Concept Dependencies

- derives-from: [[dipole-e-plane-pattern-function|Dipole E-Plane Pattern Function]]
