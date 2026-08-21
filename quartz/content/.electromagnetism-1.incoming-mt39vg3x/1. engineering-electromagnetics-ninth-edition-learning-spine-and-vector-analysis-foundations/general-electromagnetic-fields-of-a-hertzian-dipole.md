---
title: "1.308 General Electromagnetic Fields of a Hertzian Dipole"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 529", "Page 530", "Page 531", "Section 14.1.2"]
related: ["retarded-vector-potential-of-a-hertzian-dipole", "near-field-and-far-field-behavior", "hertzian-dipole-radiation-pattern", "magnetic-dipole-and-electromagnetic-duality"]
---

# 1.308 General Electromagnetic Fields of a Hertzian Dipole

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 529, Page 530, Page 531, Section 14.1.2

The complete Hertzian-dipole fields follow from two sequential applications of Maxwell's equations. First, the magnetic flux density and magnetic field are obtained from $\mathbf{B}_s=\mu\mathbf{H}_s=\nabla\times\mathbf{A}_s$. Taking the curl of the radial and polar potential components leaves only an azimuthal magnetic field $H_{\phi s}$. Second, in the source-free surrounding medium, Ampère's law becomes $\nabla\times\mathbf{H}_s=j\omega\epsilon\mathbf{E}_s$. The curl of the azimuthal magnetic field produces radial and polar electric components, $E_{rs}$ and $E_{\theta s}$, with no azimuthal electric component. The expressions contain combinations of $1/r$, $1/r^2$, and $1/r^3$, all multiplied by the outward phase factor $e^{-jkr}$. The $1/r$ terms become radiation fields at large distance, while the faster-decaying terms dominate or remain important near the source. The angular factors also differ: the radial electric field is proportional to $\cos\theta$, whereas the transverse electric and magnetic fields are proportional to $\sin\theta$. Intrinsic impedance $\eta=\sqrt{\mu/\epsilon}$ scales the electric fields relative to the magnetic field.

## Page-Grounded Details

#### Page 529

where the wavenumber in the lossless medium is $k = \omega/v = \omega\sqrt{\mu\epsilon}$. In phasor form, Eq. (3) becomes
$$
I_{s} = I_{0}~{}e^{-jkR}
$$
(4)

where the current amplitude, $I_{0}$, is assumed to be real (as it will be throughout this chapter). Incorporating (4) into (2), we find the phasor retarded potential:
$$
A_{s} = A_{zs} \, a_{z} = \frac{\mu I_{0} d}{4\pi R} e^{-jkR} a_{z}
$$
(5)

Using a mixed coordinate system for the moment, we now replace $R$ with the small $r$ of the spherical coordinate system and then determine which spherical components are represented by $A_{zs}$. Using the projections as illustrated in Figure 14.2, we find
$$
A_{rs} = A_{zs} \cos\theta
$$
(6a)
$$
A_{\theta s} = -A_{zs} \sin\theta
$$
(6b)

and therefore
$$
A_{rs} = \frac{\mu I_{0} d}{4\pi r} \cos\theta~{}e^{-jkr}
$$
(7a)
$$
A_{\theta s} = -\frac{\mu I_{0} d}{4\pi r} \sin\theta~{}e^{-jkr}
$$
(7b)

#### 14.1.2 Obtaining the General Electric and Magnetic Fields

From the preceding two components of the vector magnetic potential at $P$ we can now find $\mathbf{B}_{s}$ or $\mathbf{H}_{s}$ from the definition of $\mathbf{A}_{s}$,
$$
\mathbf{B}_{s} = \mu\mathbf{

[Truncated for analysis]

#### Page 530

Taking the indicated partial derivatives as specified by the curl operator in spherical coordinates, we can separate Eq. (8) into its three spherical components, of which only the $\phi$ component is nonzero:
$$
 H_{\phi s}=\frac{1}{\mu r}\,\frac{\partial}{\partial r}(r\,A_{\theta s})-\frac{1}{\mu r}\,\frac{\partial A_{rs}}{\partial\theta}\quad{(9)}
$$
Now, substituting $(7a)$ and $(7b)$ into $(9)$, we find the magnetic field:
$$
 H_{\phi s}=\frac{I_{0}\,d}{4\pi}\sin\theta\,e^{-jkr}\left(j\frac{k}{r}+\frac{1}{r^{2}}\right)\quad{(10)}
$$
The electric field that is associated with Eq. $(10)$ is found from one of Maxwell's equations-specifically the point form of Ampère's circuit law as applied to the surrounding region (where conduction and convection current are absent). In phasor form, this is Eq. $(23)$ in Chapter 11, except that in the present case we allow for a lossless medium having permittivity $\epsilon$:
$$
 \nabla\times\mathbf{H}_{s}=j\omega\epsilon\,\mathbf{E}_{s}\quad{(11)}
$$
Using $(11)$, we expand the curl in spherical coordinates, assuming the existence of only a $\phi$ component for $\mathbf{H}_{s}$. The resulting electric field components are

[Truncated for analysis]

#### Page 531
$$
 E_{rs}=\frac{I_{0}d}{2\pi r^{2}}\eta\left[1+\frac{1}{(kr)^{2}}\right]^{1/2}\cos\theta\exp\left[-j(kr-\delta_{r})\right]
$$
(15)
$$
 E_{\theta s}=\frac{I_{0}kd}{4\pi r}\eta\left[1-\frac{1}{(kr)^{2}}+\frac{1}{(kr)^{4}}\right]^{1/2}\sin\theta\exp\left[-j(kr-\delta_{\theta})\right]
$$
(16)

where the additional phase terms are
$$
 \delta_{\phi}=\tan^{-1}[kr]
$$
(17a)
$$
 \delta_{r}=\tan^{-1}[kr]-\frac{\pi}{2}
$$
(17b)

and
$$
 \delta_{\theta}=\tan^{-1}\left[kr\left(1-\frac{1}{(kr)^{2}}\right)\right]
$$
(18)

In (17) and (18), the principal value is always taken when evaluating the inverse tangent. This means that the phases as expressed in (17) and (18) will occur within the range $\pm\pi/2$ as kr varies between zero and infinity. Suppose a single frequency (k value) is chosen, and the fields are observed at a fixed instant in time. Consider observing the field along a path in the direction of increasing r, in which spatial oscillations will be seen as r varies. As a result of the phase terms in (17) and (18), the oscillation period will change with increasing r. We may demonstrate this by considering the $H_{\phi}$ component as a function of r under the following condition

[Truncated for analysis]

## Core Ideas

- The magnetic field is found from $\nabla\times\mathbf{A}_s$.
- Only the azimuthal magnetic component $H_{\phi s}$ is nonzero.
- The electric field follows from $\nabla\times\mathbf{H}_s=j\omega\epsilon\mathbf{E}_s$.
- The electric field has radial and polar components.
- The complete fields contain $1/r$, $1/r^2$, and $1/r^3$ dependencies.
- All components contain the outgoing phase factor $e^{-jkr}$.
- $E_{rs}$ varies as $\cos\theta$.
- $E_{\theta s}$ and $H_{\phi s}$ vary as $\sin\theta$.

## Source Anchors

- The magnetic field is
$$
H_{\phi s}=\frac{I_0d}{4\pi}\sin\theta\,e^{-jkr}\left(j\frac{k}{r}+\frac{1}{r^2}\right).
$$
- The radial electric field is
$$
E_{rs}=\frac{I_0d}{2\pi}\eta\cos\theta\,e^{-jkr}\left(\frac{1}{r^2}+\frac{1}{jkr^3}\right).
$$
- The polar electric field is
$$
E_{\theta s}=\frac{I_0d}{4\pi}\eta\sin\theta\,e^{-jkr}\left(\frac{jk}{r}+\frac{1}{r^2}+\frac{1}{jkr^3}\right).$$
- The intrinsic impedance is defined as $\eta=\sqrt{\mu/\epsilon}$.
- The source rewrites the fields in magnitude-phase form with additional phases $\delta_\phi$, $\delta_r$, and $\delta_\theta$.

## Related Pages

- [[retarded-vector-potential-of-a-hertzian-dipole|Retarded Vector Potential of a Hertzian Dipole]]
- [[near-field-and-far-field-behavior|Near-Field and Far-Field Behavior]]
- [[hertzian-dipole-radiation-pattern|Hertzian Dipole Radiation Pattern]]
- [[magnetic-dipole-and-electromagnetic-duality|Magnetic Dipole and Electromagnetic Duality]]

## Concept Dependencies

- enables: [[near-field-and-far-field-behavior|Near-Field and Far-Field Behavior]]
