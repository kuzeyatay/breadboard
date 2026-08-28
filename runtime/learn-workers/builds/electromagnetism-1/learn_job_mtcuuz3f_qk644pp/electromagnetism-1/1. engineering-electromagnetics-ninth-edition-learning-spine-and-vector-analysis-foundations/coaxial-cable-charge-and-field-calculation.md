---
title: "1.60 Coaxial Cable Charge and Field Calculation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 72", "Example 3.2"]
related: ["coaxial-cable-field-and-electrostatic-shielding", "infinite-uniform-line-charge-field", "fields-from-layered-charge-distributions", "gauss-law-and-divergence-problem-solving-methods"]
---

# 1.60 Coaxial Cable Charge and Field Calculation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 72, Example 3.2

Example 3.2 provides a reusable procedure for converting total conductor charge into surface charge density and then into fields. For a coaxial cable of length $L$, inner radius $a$, outer radius $b$, and inner-conductor charge $Q$, the inner surface charge density is $\rho_{S,\mathrm{inner}}=Q/(2\pi aL)$. The inner surface of the outer conductor carries charge $-Q$, so $\rho_{S,\mathrm{outer}}=-Q/(2\pi bL)$. Between the conductors, the flux density is $D_\rho=a\rho_{S,\mathrm{inner}}/\rho$, and in air the electric field is $E_\rho=D_\rho/\epsilon_0$. For the example values $L=0.5$ m, $a=1$ mm, $b=4$ mm, and $Q=30$ nC, the densities are $9.55\,\mu\mathrm{C/m^2}$ and $-2.39\,\mu\mathrm{C/m^2}$. The fields are $D_\rho=9.55/\rho\,\mathrm{nC/m^2}$ and $E_\rho=1079/\rho\,\mathrm{V/m}$ when $\rho$ is expressed consistently in meters. Both fields apply only for $1<\rho<4$ mm and vanish outside that interval in the idealized conductor model.

## Page-Grounded Details

#### Page 72

An identical result would be obtained for $\rho<a$. Thus the coaxial cable or capacitor has no external field (we have proved that the outer conductor is a "shield"), and there is no field within the center conductor.

Our result is also useful for a finite length of coaxial cable, open at both ends, provided the length L is many times greater than the radius b so that the nonsymmetrical conditions at the two ends do not appreciably affect the solution. Such a device is also termed a coaxial capacitor. Both the coaxial cable and the coaxial capacitor will appear frequently in the work that follows.

#### EXAMPLE 3.2

Let us select a 50-cm length of coaxial cable having an inner radius of 1 mm and an outer radius of 4 mm. The space between conductors is assumed to be filled with air. The total charge on the inner conductor is 30 nC. We wish to know the charge density on each conductor, and the E and D fields.

Solution. We begin by finding the surface charge density on the inner cylinder,
$$
\rho_{S,\text{innercyl}}=\frac{Q_{\text{innercyl}}}{2\pi aL}=\frac{30\times 10^{-9}}{2\pi(10^{-3})(0.5)}=9.55\,\mu\text{C/m}^{2}
$$
The negative charge density on the inner surface of the ou

[Truncated for analysis]

## Core Ideas

- Compute cylindrical surface area as $2\pi rL$.
- Divide total charge by conductor surface area to obtain $\rho_S$.
- Assign equal and opposite total charge to the outer conductor's inner surface.
- Use $D_\rho=a\rho_{S,\mathrm{inner}}/\rho$ between conductors.
- Use $E_\rho=D_\rho/\epsilon_0$ in air.
- State the radial interval in which each field expression applies.
- Check units carefully when radii are supplied in millimeters.

## Source Anchors

- Page 72 specifies $L=50$ cm, $a=1$ mm, $b=4$ mm, and inner charge $30$ nC.
- Page 72 obtains $\rho_{S,\mathrm{inner}}=9.55\,\mu\mathrm{C/m^2}$.
- Page 72 obtains $\rho_{S,\mathrm{outer}}=-2.39\,\mu\mathrm{C/m^2}$.
- Page 72 gives $D_\rho=9.55/\rho\,\mathrm{nC/m^2}$ and $E_\rho=1079/\rho\,\mathrm{V/m}$.
- Page 72 limits the nonzero fields to $1<\rho<4$ mm.

## Related Pages

- [[coaxial-cable-field-and-electrostatic-shielding|Coaxial Cable Field and Electrostatic Shielding]]
- [[infinite-uniform-line-charge-field|Infinite Uniform Line Charge Field]]
- [[fields-from-layered-charge-distributions|Fields from Layered Charge Distributions]]
- [[gauss-law-and-divergence-problem-solving-methods|Gauss-Law and Divergence Problem-Solving Methods]]

## Concept Dependencies

- example-of: [[coaxial-cable-field-and-electrostatic-shielding|Coaxial Cable Field and Electrostatic Shielding]]
- example-of: [[gauss-law-and-divergence-problem-solving-methods|Gauss-Law and Divergence Problem-Solving Methods]]
