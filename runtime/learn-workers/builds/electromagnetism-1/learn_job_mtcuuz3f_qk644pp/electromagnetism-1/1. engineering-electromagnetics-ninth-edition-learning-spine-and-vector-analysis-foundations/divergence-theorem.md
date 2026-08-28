---
title: "1.67 Divergence Theorem"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 81", "Page 82", "Figure 3.7", "Example 3.5"]
related: ["gauss-law-in-integral-form", "differential-volume-derivation-of-divergence", "maxwells-first-equation", "divergence-as-local-flux-outflow", "gauss-law-and-divergence-problem-solving-methods"]
---

# 1.67 Divergence Theorem

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 81, Page 82, Figure 3.7, Example 3.5

The divergence theorem equates the outward flux of a vector field through a closed surface with the volume integral of its divergence throughout the enclosed region. For electric flux density, it is $\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_V\nabla\cdot\mathbf{D}\,dv$. More generally, the theorem applies to any sufficiently differentiable vector field. Its physical basis can be understood by partitioning a volume into many small cells. Flux leaving one internal cell enters a neighboring cell, so contributions across shared internal boundaries cancel. Only flux crossing the outer boundary remains. For electrostatics, substituting $\nabla\cdot\mathbf{D}=\rho_v$ shows that the theorem reproduces Gauss's law. It also provides a choice between a double surface integral and a triple volume integral, allowing the easier calculation to be selected. Example 3.5 verifies both sides for $\mathbf{D}=2xy\mathbf{a}_x+x^2\mathbf{a}_y$ over a rectangular parallelepiped. The direct surface calculation and the integral of $\nabla\cdot\mathbf{D}=2y$ both yield $12$, which also represents $12$ C of enclosed charge.

## Page-Grounded Details

#### Page 81

#### 3.5.3 Divergence Theorem

We close the treatment of divergence by presenting a theorem that brings the discus-sion full circle, the divergence theorem. This theorem applies to any vector field for which the appropriate partial derivatives exist, although it is easiest for us to develop it for the electric flux density. We have actually obtained it already and now have little more to do than point it out and name it, for starting from Gauss's law, we have
$$
\oint_{S}\mathbf{D}\cdot d\mathbf{S}=Q=\int_{\rm vol}\rho_{v}~{}dv=\int_{\rm vol}\nabla\cdot\mathbf{D}~{}dv
$$
The first and last expressions constitute the divergence theorem,
$$
\oint_{S}\mathbf{D}\cdot d\mathbf{S}=\int_{\rm vol}\nabla\cdot\mathbf{D}~{}dv\quad{(17)}
$$
which may be stated as follows:

*The integral of the normal component of any vector field over a closed surface is equal to the integral of the divergence of this vector field throughout the volume enclosed by the closed surface.*

The divergence theorem is also known as Gauss's theorem, and in fact Gauss's law as we have used it is nothing more than an application of the divergence theorem to electrostatics. Again, we emphasize that the theorem is tru

[Truncated for analysis]

#### Page 82

Division of the volume into a number of small compartments of differential size and consideration of one cell show that the flux diverging from such a cell enters, or converges on, the adjacent cells unless the cell contains a portion of the outer surface. In summary, the divergence of the flux density throughout a volume leads, then, to the same result as determining the net flux crossing the enclosing surface.

#### Example 3.5

Evaluate both sides of the divergence theorem for the field $\mathbf{D}=2xy\mathbf{a}_{x}+x^{2}\mathbf{a}_{y}\,\mathrm{C/m^{2}}$ and the rectangular parellepiped formed by the planes $x=0$ and 1, $y=0$ and 2, and $z=0$ and 3.

Solution.Evaluating the surface integral first, we note that $\mathbf{D}$ is parallel to the surfaces at $z=0$ and $z=3$, so $\mathbf{D}\cdot d\mathbf{S}=0$ there. For the remaining four surfaces we have
$$ \begin{align*}\oint_{S}\mathbf{D}\cdot d\mathbf{S}&=\int_{0}^{3}\int_{0}^{2}\left(\mathbf{D}\right)_{x=0}\cdot(-dy\,dz\,\mathbf{a}_{x})+\int_{0}^{3}\int_{0}^{2}\left(\mathbf{D}\right)_{x=1}\cdot(dydz\,\mathbf{a}_{x})\\ &\quad+\int_{0}^{3}\int_{0}^{1}\left(\mathbf{D}\right)_{y=0}\cdot(-dx\,dz\,\mathbf{a}_{y})+\int

[Truncated for analysis]

## Core Ideas

- The theorem is $\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_V\nabla\cdot\mathbf{D}\,dv$.
- The surface must be the closed boundary of the integration volume.
- Internal flux contributions cancel between adjacent differential cells.
- Only flux through the outer boundary remains.
- The theorem applies to vector fields beyond electric flux density.
- Gauss's law follows by using $\nabla\cdot\mathbf{D}=\rho_v$.
- The theorem converts between a surface integral and a volume integral.
- Either side may be chosen according to computational convenience.

## Source Anchors

- Page 81 derives $\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_V\nabla\cdot\mathbf{D}\,dv$.
- Page 81 states that the surface integral of the normal component equals the volume integral of divergence.
- S1.P81.F1 illustrates the closed surface and enclosed volume used by the theorem.
- Page 82 explains cancellation of flux between neighboring differential compartments.
- Example 3.5 on Page 82 evaluates both sides for a rectangular parallelepiped and obtains $12$.
- Problem D3.9 on Page 82 asks for both sides over a cylindrical-coordinate region.

## Related Pages

- [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- [[differential-volume-derivation-of-divergence|Differential-Volume Derivation of Divergence]]
- [[maxwells-first-equation|Maxwell's First Equation]]
- [[divergence-as-local-flux-outflow|Divergence as Local Flux Outflow]]
- [[gauss-law-and-divergence-problem-solving-methods|Gauss-Law and Divergence Problem-Solving Methods]]

## Concept Dependencies

- depends-on: [[maxwells-first-equation|Maxwell's First Equation]]
- related: [[gauss-law-in-integral-form|Gauss's Law in Integral Form]]
- enables: [[gauss-law-and-divergence-problem-solving-methods|Gauss-Law and Divergence Problem-Solving Methods]]
