---
title: "General Electromagnetic Fields of a Hertzian Dipole"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "general-electromagnetic-fields-of-a-hertzian-dipole"
locations: ["Page 529", "Page 530", "Page 531", "Section 14.1.2"]
related: ["retarded-vector-potential-of-a-hertzian-dipole", "near-field-and-far-field-behavior", "hertzian-dipole-radiation-pattern", "magnetic-dipole-and-electromagnetic-duality"]
---

## ConceptNode: General Electromagnetic Fields of a Hertzian Dipole

Planning node for [[general-electromagnetic-fields-of-a-hertzian-dipole|1.308 General Electromagnetic Fields of a Hertzian Dipole]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 529, Page 530, Page 531, Section 14.1.2

The complete Hertzian-dipole fields follow from two sequential applications of Maxwell's equations. First, the magnetic flux density and magnetic field are obtained from $\mathbf{B}_s=\mu\mathbf{H}_s=\nabla\times\mathbf{A}_s$. Taking the curl of the radial and polar potential components leaves only an azimuthal magnetic field $H_{\phi s}$. Second, in the source-free surrounding medium, Ampère's law becomes $\nabla\times\mathbf{H}_s=j\omega\epsilon\mathbf{E}_s$. The curl of the azimuthal magnetic field produces radial and polar electric components, $E_{rs}$ and $E_{\theta s}$, with no azimuthal electric component. The expressions contain combinations of $1/r$, $1/r^2$, and $1/r^3$, all multiplied by the outward phase factor $e^{-jkr}$. The $1/r$ terms become radiation fields at large distance, while the faster-decaying terms dominate or remain important near the source. The angular factors also differ: the radial electric field is proportional to $\cos\theta$, whereas the transverse electric and magnetic fields are proportional to $\sin\theta$. Intrinsic impedance $\eta=\sqrt{\mu/\epsilon}$ scales the electric fields relative to the magnetic field.

### Key planning details

- The magnetic field is found from $\nabla\times\mathbf{A}_s$.
- Only the azimuthal magnetic component $H_{\phi s}$ is nonzero.
- The electric field follows from $\nabla\times\mathbf{H}_s=j\omega\epsilon\mathbf{E}_s$.
- The electric field has radial and polar components.
- The complete fields contain $1/r$, $1/r^2$, and $1/r^3$ dependencies.
- All components contain the outgoing phase factor $e^{-jkr}$.
- $E_{rs}$ varies as $\cos\theta$.
- $E_{\theta s}$ and $H_{\phi s}$ vary as $\sin\theta$.

### Source coverage

- The magnetic field is $$H_{\phi s}=\frac{I_0d}{4\pi}\sin\theta\,e^{-jkr}\left(j\frac{k}{r}+\frac{1}{r^2}\right).$$
- The radial electric field is $$E_{rs}=\frac{I_0d}{2\pi}\eta\cos\theta\,e^{-jkr}\left(\frac{1}{r^2}+\frac{1}{jkr^3}\right).$$
- The polar electric field is $$E_{\theta s}=\frac{I_0d}{4\pi}\eta\sin\theta\,e^{-jkr}\left(\frac{jk}{r}+\frac{1}{r^2}+\frac{1}{jkr^3}\right).$$
- The intrinsic impedance is defined as $\eta=\sqrt{\mu/\epsilon}$.
- The source rewrites the fields in magnitude-phase form with additional phases $\delta_\phi$, $\delta_r$, and $\delta_\theta$.
