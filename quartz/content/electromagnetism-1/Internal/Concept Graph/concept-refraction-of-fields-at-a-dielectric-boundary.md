---
title: "Refraction of Fields at a Dielectric Boundary"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "refraction-of-fields-at-a-dielectric-boundary"
locations: ["Page 150", "Section: Dielectric Boundary Conditions", "Figure 5.11"]
related: ["normal-and-tangential-field-decomposition", "fields-and-polarization-inside-a-teflon-slab", "series-and-parallel-multiple-dielectric-capacitors"]
---

## ConceptNode: Refraction of Fields at a Dielectric Boundary

Planning node for [[refraction-of-fields-at-a-dielectric-boundary|1.69 Refraction of Fields at a Dielectric Boundary]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 150, Section: Dielectric Boundary Conditions, Figure 5.11

At an interface between two perfect dielectrics with no free surface charge, the normal component of electric flux density is continuous while the tangential component of electric field intensity is continuous. Combining these boundary conditions determines how the field direction changes at the interface. If $\theta_1$ and $\theta_2$ are measured from the interface normal, division of the component equations gives $$\frac{\tan\theta_1}{\tan\theta_2}=\frac{\epsilon_1}{\epsilon_2}.$$ Thus, when $\epsilon_1>\epsilon_2$, the source concludes that $\theta_1>\theta_2$. The field is farther from the normal in the higher-permittivity region. In an isotropic dielectric, $\mathbf D=\epsilon\mathbf E$, so $\mathbf D$ and $\mathbf E$ have the same direction within each region even though their magnitudes scale differently. The magnitude relations show that $D$ is generally larger in the region of larger permittivity, except for a field purely normal to the interface. Conversely, $E$ is generally larger in the region of smaller permittivity, except for a field purely tangential to the interface. Figure 5.11 is source-central because it depicts the refracted field directions for $\epsilon_1>\epsilon_2$.

### Key planning details

- The dielectric interface is analyzed using normal $\mathbf D$ continuity and tangential $\mathbf E$ continuity.
- The angular relation is $\tan\theta_1/\tan\theta_2=\epsilon_1/\epsilon_2$.
- For $\epsilon_1>\epsilon_2$, the corresponding angles satisfy $\theta_1>\theta_2$.
- Within each isotropic dielectric, $\mathbf D$ and $\mathbf E$ point in the same direction.
- $D$ is generally larger in the higher-permittivity region.
- $E$ is generally larger in the lower-permittivity region.

### Source coverage

- Equation (40): $\epsilon_2D_1\sin\theta_1=\epsilon_1D_2\sin\theta_2$.
- Equation (41): $\tan\theta_1/\tan\theta_2=\epsilon_1/\epsilon_2$.
- Figure 5.11 assumes $\epsilon_1>\epsilon_2$ and therefore shows $\theta_1>\theta_2$.
- Equation (42): $$D_2=D_1\sqrt{\cos^2\theta_1+\left(\frac{\epsilon_2}{\epsilon_1}\right)^2\sin^2\theta_1}.$$
- Equation (43): $$E_2=E_1\sqrt{\sin^2\theta_1+\left(\frac{\epsilon_1}{\epsilon_2}\right)^2\cos^2\theta_1}.$$
- Visual opportunity S1.P150.F1: reconstruct Figure 5.11 with adjustable $\epsilon_1/\epsilon_2$ and incident angle.
