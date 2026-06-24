---
title: "15.7 Applications of Multiple Integrals: The Surface Area of a Graph"
date: "2026-06-15T15:04:31.061Z"
source: "user-note"
knowledge_type: "user-note"
---

## 15.7 Applications of Multiple Integrals: The Surface Area of a Graph

Multiple integrals are useful because they allow us to add up many small contributions spread over a region. In earlier sections, the contribution was often a small volume element. For example, the volume under a graph $z=f(x,y)$ over a region $D$ in the $xy$-plane is obtained by adding small columns whose approximate volume is “height times base area,” namely $f(x,y)\,dA$. Surface area is different. We are no longer measuring the volume below the graph; we are measuring the actual area of the tilted sheet itself. A small rectangle in the $xy$-plane usually becomes a tilted patch on the surface, and that tilted patch has larger area than its flat projection.

This is why surface area appears at this point in the course. We already know how to integrate over regions in the plane, and we already know that partial derivatives measure how a graph changes in the $x$- and $y$-directions. Surface area combines these ideas. The region of integration is still a two-dimensional region $D$ in the $xy$-plane, but the integrand must correct for the stretching caused by the slopes of the graph.

![pasted 1781589915197](/math-2/assets/pasted-1781589915197.png)

Let $D$ be a region in the $xy$-plane, and let $S$ be the graph of a function

$$
z=f(x,y), \qquad (x,y)\in D.
$$

The word graph means that each point $(x,y)$ in $D$ determines exactly one point on the surface, namely

$$
(x,y,f(x,y)).
$$

The region $D$ is called the projection domain because it is the shadow of the surface on the $xy$-plane. We assume that $f$ has continuous first partial derivatives on $D$, so that the surface is smooth enough to have well-defined tangent planes and no vertical tangent plane over the region being considered.

The first partial derivatives are

$$
f_x(x,y)=\frac{\partial f}{\partial x}(x,y),
\qquad
f_y(x,y)=\frac{\partial f}{\partial y}(x,y).
$$

Here $f_x$ measures the slope of the graph in the $x$-direction while $y$ is fixed, and $f_y$ measures the slope in the $y$-direction while $x$ is fixed. These slopes matter because surface area depends on how tilted the graph is, not directly on how high the graph is.

To see the correction factor, imagine zooming in on the graph near one point. A very small surface patch is nearly flat, so it behaves like a tiny parallelogram in the tangent plane. Moving in the $x$-direction along the graph gives the tangent vector

$$
\mathbf{r}_x=(1,0,f_x(x,y)),
$$

and moving in the $y$-direction gives the tangent vector

$$
\mathbf{r}_y=(0,1,f_y(x,y)).
$$

Their cross product is perpendicular to the surface:

$$
\mathbf{r}_x\times \mathbf{r}_y=(-f_x(x,y),-f_y(x,y),1).
$$

The direction of this vector is not important for area. Reversing it would give the opposite normal direction, but the same length. The length is

$$
\left|\mathbf{r}_x\times \mathbf{r}_y\right|
=
\sqrt{1+\bigl(f_x(x,y)\bigr)^2+\bigl(f_y(x,y)\bigr)^2}.
$$

This length is the local area-stretching factor. It tells us how much larger the tilted surface patch is than its projection in the $xy$-plane.

Therefore the surface area element is

$$
dS=\sqrt{1+\bigl(f_x(x,y)\bigr)^2+\bigl(f_y(x,y)\bigr)^2}\,dA.
$$

Here $dS$ is the true infinitesimal surface area on the graph, $dA$ is the infinitesimal area of the projected patch in the $xy$-plane, and the square-root factor measures the local stretching caused by the slopes of the graph.

The total surface area of the graph is

$$
A(S)=
\iint_D
\sqrt{1+\bigl(f_x(x,y)\bigr)^2+\bigl(f_y(x,y)\bigr)^2}\,dA.
$$

Using the planar gradient

$$
\nabla f(x,y)=\bigl(f_x(x,y),f_y(x,y)\bigr),
$$

the same formula can be written more compactly as

$$
A(S)=
\iint_D
\sqrt{1+|\nabla f(x,y)|^2}\,dA.
$$

In this formula,

$$
|\nabla f(x,y)|^2=f_x(x,y)^2+f_y(x,y)^2.
$$

This is still a double integral over the projection domain $D$. It is not a triple integral, and it is not a volume integral. The height $f(x,y)$ itself does not appear directly in the formula. Only the slopes $f_x$ and $f_y$ appear, because area is controlled by tilt.

This distinction is important. A surface can be very high but almost flat, in which case its surface area over a fixed projection domain is close to the area of that domain. Another surface can have small height values but large slopes, in which case its surface area can be much larger than its projection. For volume under a graph, height is the main quantity. For surface area of a graph, slope is the main quantity.

The standard procedure is therefore: first write the surface as a graph $z=f(x,y)$; then find the projection domain $D$; then compute $f_x$ and $f_y$; then choose suitable coordinates for $dA$; finally evaluate

$$
\iint_D\sqrt{1+f_x^2+f_y^2}\,dA.
$$

Most mistakes in this topic happen before the integration starts: choosing the wrong projection domain, forgetting the square root, forgetting the $1$, using the height $f$ instead of the slopes, or using $dx\,dy$ when polar coordinates require $r\,dr\,d\theta$.

As a first check, consider the plane

$$
z=2x+2y
$$

inside the cylinder

$$
x^2+y^2=1.
$$

The projection domain is the disk

$$
D=\{(x,y):x^2+y^2\leq 1\}.
$$

Here

$$
f_x=2,\qquad f_y=2.
$$

Thus the stretching factor is

$$
\sqrt{1+2^2+2^2}=\sqrt{9}=3.
$$

Therefore

$$
A(S)=\iint_D 3\,dA=3\operatorname{area}(D)=3\pi.
$$

This example shows the simplest meaning of the formula. A plane has constant slope, so every projected area element is stretched by the same constant factor.

For a curved graph, the stretching factor usually changes from point to point. Consider the surface

$$
z=x^2-y^2
$$

inside the cylinder

$$
x^2+y^2=a^2.
$$

The projection domain is the disk

$$
D=\{(x,y):x^2+y^2\leq a^2\}.
$$

The partial derivatives are

$$
f_x=2x,\qquad f_y=-2y.
$$

Hence

$$
1+f_x^2+f_y^2=1+4x^2+4y^2.
$$

Because both the domain and the integrand depend naturally on $x^2+y^2$, polar coordinates are appropriate:

$$
x=r\cos\theta,\qquad y=r\sin\theta,\qquad dA=r\,dr\,d\theta.
$$

The disk is described by

$$
0\leq r\leq a,\qquad 0\leq \theta\leq 2\pi.
$$

Therefore

$$
A(S)=
\int_0^{2\pi}\int_0^a
\sqrt{1+4r^2}\,r\,dr\,d\theta.
$$

Using

$$
u=1+4r^2,\qquad du=8r\,dr,
$$

we obtain

$$
\begin{aligned}
A(S)
&=2\pi\cdot \frac18\int_1^{1+4a^2}u^{1/2}\,du \\
&=\frac{\pi}{6}\left((1+4a^2)^{3/2}-1\right).
\end{aligned}
$$

The sign in $f_y=-2y$ does not affect the final stretching factor, because $f_y$ is squared. This is why the same computation also appears for similar paraboloid-type surfaces whose squared slopes have the same form.

The conical surface

$$
3z^2=x^2+y^2,\qquad 0\leq z\leq 2,
$$

is another useful example because it forces us to rewrite the surface as a graph. Since $z\geq 0$,

$$
z=\frac{1}{\sqrt3}\sqrt{x^2+y^2}.
$$

In polar coordinates this is

$$
z=\frac{r}{\sqrt3}.
$$

The condition $0\leq z\leq 2$ becomes

$$
0\leq \frac{r}{\sqrt3}\leq 2,
$$

so the projection domain is the disk

$$
0\leq r\leq 2\sqrt3,\qquad 0\leq\theta\leq 2\pi.
$$

Here the graph has radial form $z=g(r)$, where

$$
g(r)=\frac{r}{\sqrt3}.
$$

Its radial derivative is

$$
g'(r)=\frac1{\sqrt3}.
$$

For a radial graph $z=g(r)$, the surface area formula becomes

$$
A(S)=\int_{\theta=\alpha}^{\beta}\int_{r=r_1}^{r_2}
\sqrt{1+\bigl(g'(r)\bigr)^2}\,r\,dr\,d\theta.
$$

Thus for the cone,

$$
\begin{aligned}
A(S)
&=\int_0^{2\pi}\int_0^{2\sqrt3}
\sqrt{1+\frac13}\,r\,dr\,d\theta \\
&=\int_0^{2\pi}\int_0^{2\sqrt3}
\frac{2}{\sqrt3}\,r\,dr\,d\theta.
\end{aligned}
$$

Evaluating gives

$$
\begin{aligned}
A(S)
&=\frac{2}{\sqrt3}\cdot 2\pi\cdot \frac{(2\sqrt3)^2}{2} \\
&=\frac{24\pi}{\sqrt3}.
\end{aligned}
$$

This is a good example of why the projection domain must come from the graph representation. The cone is not integrated over $0\leq z\leq 2$ directly in this formula; it is integrated over its shadow in the $xy$-plane.

Not every surface-area problem is best handled in polar coordinates. Consider

$$
z=\sqrt{x}
$$

over the region

$$
0\leq x\leq 1,\qquad 0\leq y\leq \sqrt{x}.
$$

Here

$$
f_x=\frac{1}{2\sqrt{x}},
\qquad
f_y=0.
$$

The surface area is

$$
A(S)=
\int_0^1\int_0^{\sqrt{x}}
\sqrt{1+\frac{1}{4x}}\,dy\,dx.
$$

The integrand does not depend on $y$, so the inner integration simply multiplies by the length $\sqrt{x}$:

$$
A(S)=
\int_0^1
\sqrt{x}\sqrt{1+\frac{1}{4x}}\,dx.
$$

Since

$$
\sqrt{x}\sqrt{1+\frac{1}{4x}}=\frac12\sqrt{4x+1},
$$

we get

$$
\begin{aligned}
A(S)
&=\frac12\int_0^1\sqrt{4x+1}\,dx \\
&=\frac{5\sqrt5-1}{12}.
\end{aligned}
$$

This example is important because the projection domain is not circular. Surface-area problems do not automatically mean polar coordinates. The coordinate choice should be guided by the region and the integrand.

A useful conceptual comparison is given by the two surfaces

$$
z=2xy
$$

and

$$
z=x^2+y^2
$$

over the same vertical cylinder, meaning over the same projection domain $D$ in the $xy$-plane. For $z=2xy$,

$$
f_x=2y,\qquad f_y=2x,
$$

so

$$
1+f_x^2+f_y^2=1+4x^2+4y^2.
$$

For $z=x^2+y^2$,

$$
f_x=2x,\qquad f_y=2y,
$$

so again

$$
1+f_x^2+f_y^2=1+4x^2+4y^2.
$$

If the projection domain $D$ is the same, then the two surface-area integrals are identical. Therefore the two surface areas are equal. This is an exam-relevant distinction: surface area is determined by the slope pattern and the projection domain, not by the height function alone.

Sometimes the correct answer is mainly a correct setup, especially when the resulting integral is not elementary. Consider the paraboloid

$$
z=\frac12(x^2+y^2)
$$

above the square

$$
-1\leq x\leq 1,\qquad -1\leq y\leq 1.
$$

Here

$$
f_x=x,\qquad f_y=y,
$$

so

$$
A(S)=
\int_{-1}^{1}\int_{-1}^{1}
\sqrt{1+x^2+y^2}\,dy\,dx.
$$

Because the square and integrand are symmetric, one may use polar coordinates in the first quadrant and multiply by $4$. In the first quadrant of the square, the boundary changes at $\theta=\pi/4$, so

$$
A(S)=
8\int_0^{\pi/4}\int_0^{\sec\theta}
\sqrt{1+r^2}\,r\,dr\,d\theta.
$$

Evaluating the inner integral gives

$$
A(S)=
\frac83\int_0^{\pi/4}
(1+\sec^2\theta)^{3/2}\,d\theta
-
\frac{2\pi}{3}.
$$

This remaining integral is normally evaluated numerically. The important lesson is that a clean and correct setup can be the main mathematical work. Do not force an exact antiderivative where the course expects a numerical evaluation.

![pasted 1781589959451](/math-2/assets/pasted-1781589959451.png)

The canopy example shows that recognizing geometry can be more efficient than blindly applying the formula. The canopy is the part of the upper sphere

$$
x^2+y^2+z^2=2
$$

that lies above the square

$$
-1\leq x\leq 1,\qquad -1\leq y\leq 1.
$$

As a graph, the upper sphere is

$$
z=\sqrt{2-x^2-y^2}.
$$

The direct graph formula would give

$$
A(S)=
\int_{-1}^{1}\int_{-1}^{1}
\sqrt{1+\frac{x^2}{2-x^2-y^2}+\frac{y^2}{2-x^2-y^2}}\,dy\,dx.
$$

This integral is correct, but it is not the best route to an exact answer.

The sphere has radius

$$
R=\sqrt2.
$$

The area of the upper hemisphere is

$$
2\pi R^2=4\pi.
$$

The part above the square is obtained by removing four identical missing side pieces. Each missing side piece is half of a spherical cap cut from the sphere by a plane at distance $1$ from the origin, such as $x=1$. A full spherical cap of radius $R$ and height $h$ has area

$$
2\pi Rh.
$$

Here

$$
h=R-1=\sqrt2-1.
$$

So one full cap has area

$$
2\pi\sqrt2(\sqrt2-1),
$$

and the half-cap lying on the upper hemisphere has area

$$
\pi\sqrt2(\sqrt2-1).
$$

There are four such half-caps, so the canopy area is

$$
\begin{aligned}
A(S)
&=4\pi-4\pi\sqrt2(\sqrt2-1) \\
&=4\pi(\sqrt2-1).
\end{aligned}
$$

This example does not replace the graph formula. Instead, it teaches a decision principle: the graph formula gives the correct integral, but geometry can sometimes simplify the exact evaluation.

Past exam-style surface-area questions may also require a shifted projection domain. Consider the surface

$$
S=\{(x,y,z)\in\mathbb{R}^3:x^2-2x+y^2=z^2,\ 0\leq z\leq 1\}.
$$

The first step is to complete the square:

$$
x^2-2x+y^2=z^2
$$

becomes

$$
(x-1)^2+y^2=1+z^2.
$$

Since $z\geq 0$, this can be written as the graph

$$
z=\sqrt{(x-1)^2+y^2-1}.
$$

The projection domain is not a disk centered at the origin. It is an annulus centered at $(1,0)$:

$$
1\leq (x-1)^2+y^2\leq 2.
$$

Use shifted polar coordinates

$$
x=1+\rho\cos\theta,\qquad y=\rho\sin\theta.
$$

Then

$$
1\leq \rho\leq \sqrt2,\qquad 0\leq\theta\leq 2\pi,
$$

and

$$
z=\sqrt{\rho^2-1}.
$$

Let

$$
t=\sqrt{\rho^2-1}.
$$

Then $t$ runs from $0$ to $1$. For the radial graph $z=\sqrt{\rho^2-1}$, the surface-area integral simplifies to

$$
A(S)=2\pi\int_0^1\sqrt{1+2t^2}\,dt.
$$

The important correction is the completion of the square. The expression

$$
x^2-2x+y^2
$$

must become

$$
(x-1)^2+y^2-1,
$$

so the surface equation becomes

$$
(x-1)^2+y^2=1+z^2.
$$

Forgetting the extra $1$ gives the wrong projection domain.

Finally, surface area can become improper when the graph or its derivatives become singular. A standard warning example is

$$
z=\frac1r
$$

over the punctured disk

$$
0<r<1.
$$

The volume under the graph is

$$
\int_0^{2\pi}\int_0^1 \frac1r\,r\,dr\,d\theta=2\pi,
$$

which is finite. But the surface area uses slope. Since

$$
f'(r)=-\frac1{r^2},
$$

the radial surface-area integral is

$$
2\pi\int_0^1 r\sqrt{1+\frac1{r^4}}\,dr.
$$

Near $r=0$, the integrand behaves like

$$
r\cdot \frac1{r^2}=\frac1r,
$$

and

$$
\int_0^1\frac1r\,dr
$$

diverges. Thus the volume is finite, but the surface area is infinite. This example reinforces the central message of the section: volume depends on height, while surface area depends on slope.

The surface area of a graph is therefore an application of multiple integrals where the quantity being added is not height times base area, but true tilted area. The projection domain $D$ tells us where to integrate, the partial derivatives $f_x$ and $f_y$ tell us how steep the graph is, and the factor

$$
\sqrt{1+f_x^2+f_y^2}
$$

converts projected area $dA$ into surface area $dS$. The main exam skill is to identify the graph and projection domain correctly, choose coordinates that match the geometry, and avoid confusing surface area with volume or flux.
