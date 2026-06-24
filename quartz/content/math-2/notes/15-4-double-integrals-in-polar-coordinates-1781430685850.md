---
title: "15.4 Double Integrals in Polar Coordinates"
date: "2026-06-14T09:51:25.850Z"
source: "user-note"
knowledge_type: "user-note"
---

# 15.4 Double Integrals in Polar Coordinates

Double integrals allow us to add up a quantity over a two-dimensional region. In Cartesian coordinates, this means dividing the region into very small rectangles whose sides are parallel to the $x$- and $y$-axes. That is natural when the region is bounded by vertical and horizontal curves, but it becomes awkward when the region is circular. A disk such as

$$
x^2+y^2\leq 1
$$

has a very simple geometric meaning: it consists of all points whose distance from the origin is at most $1$. In Cartesian coordinates, however, the same disk must be described by square-root bounds such as

$$
-1\leq x\leq 1,\qquad -\sqrt{1-x^2}\leq y\leq \sqrt{1-x^2}.
$$

Polar coordinates solve this immediate problem. They describe points by distance and direction instead of horizontal and vertical displacement. This makes circular regions, annuli, sectors, and many radially symmetric integrands much easier to integrate.

This section comes after double integrals in Cartesian coordinates because the meaning of the integral is already known. We are not creating a new kind of integral. We are learning how to express the same accumulated quantity using coordinates that better fit the geometry of the region. The central question is therefore: when we replace $x$ and $y$ by $r$ and $\theta$, how must the region, the integrand, and the small area element change?

![pasted 1781430992616](/math-2/assets/pasted-1781430992616.png)

A point in the plane can be described by Cartesian coordinates $(x,y)$, where $x$ gives horizontal position and $y$ gives vertical position. The same point can also be described by polar coordinates $(r,\theta)$. The number $r$ is the distance from the point to the origin, so in the standard convention used for these integrals,

$$
r\geq 0.
$$

The angle $\theta$ is measured from the positive $x$-axis to the ray from the origin to the point, with positive angles measured counterclockwise.

The conversion from polar to Cartesian coordinates is

$$
x=r\cos\theta,\qquad y=r\sin\theta.
$$

Here $r\cos\theta$ is the horizontal component of the radius $r$, and $r\sin\theta$ is the vertical component. Conversely, the distance from the origin is determined by

$$
r^2=x^2+y^2.
$$

The angle satisfies

$$
\tan\theta=\frac{y}{x},
$$

but this equation must be used carefully. Tangent alone does not determine the quadrant, so the signs of $x$ and $y$ must still be checked. For example, the same value of $\tan\theta$ can occur for angles differing by $\pi$. In integral bounds, the correct angle interval must come from the actual region, not only from the equation $\tan\theta=y/x$.

The condition $r\geq 0$ is also important. In polar integration, $r$ is treated as a distance. Thus, from $r^2\leq 1$, we obtain

$$
0\leq r\leq 1,
$$

not $-1\leq r\leq 1$. The direction is already represented by the angle $\theta$. Allowing $r$ to be negative would describe points in a different polar convention and is not the convention used for setting up these double integrals.

![pasted 1781431014366](/math-2/assets/pasted-1781431014366.png)

In Cartesian coordinates, a very small area element is approximately a rectangle. If its width is $dx$ and its height is $dy$, then its area is

$$
dA=dx\,dy.
$$

In polar coordinates, the natural small region is not a rectangle with horizontal and vertical sides. It is a thin sector bounded by two nearby circles, with radii $r$ and $r+dr$, and two nearby rays, with angles $\theta$ and $\theta+d\theta$. Its radial thickness is $dr$. Its angular side has approximate length $r\,d\theta$, because an arc of radius $r$ and small angle $d\theta$ has length radius times angle.

Therefore the polar area element is

$$
dA=r\,dr\,d\theta.
$$

Here $dA$ is a small area in the $xy$-plane, $dr$ is a small change in radius, and $d\theta$ is a small change in angle. The factor $r$ appears because the same angular change covers a larger arc farther from the origin. Near the origin, a small angular opening covers a short arc; far from the origin, it covers a longer arc. This is why $dA$ is not simply $dr\,d\theta$.

The formula

$$
dA=r\,dr\,d\theta
$$

is the most important computational fact in this section. Forgetting the factor $r$ changes the value of the integral, because it treats angular rectangles in the $r\theta$-plane as if they had the same physical area everywhere in the $xy$-plane. They do not.

The same area factor can be derived more formally using a Jacobian determinant. A Jacobian determinant measures how much a coordinate transformation stretches or shrinks area locally. For the polar transformation

$$
x=r\cos\theta,\qquad y=r\sin\theta,
$$

we view $x$ and $y$ as functions of the new variables $r$ and $\theta$. The Jacobian matrix is

$$
\frac{\partial(x,y)}{\partial(r,\theta)}
=
\begin{pmatrix}
\dfrac{\partial x}{\partial r} & \dfrac{\partial x}{\partial \theta} \\
\dfrac{\partial y}{\partial r} & \dfrac{\partial y}{\partial \theta}
\end{pmatrix}
=
\begin{pmatrix}
\cos\theta & -r\sin\theta \\
\sin\theta & r\cos\theta
\end{pmatrix}.
$$

The determinant is

$$
\det\frac{\partial(x,y)}{\partial(r,\theta)}
= r\cos^2\theta+r\sin^2\theta
= r.
$$

Since $r\geq 0$, the absolute value of the determinant is also $r$. Thus the Jacobian calculation gives

$$
dx\,dy=dA=r\,dr\,d\theta.
$$

The geometric explanation tells us why the formula makes sense. The Jacobian explanation tells us how this fits into the more general method of changing variables.

Now suppose $D$ is a region in the $xy$-plane and $f(x,y)$ is a function defined on that region. To convert the double integral

$$
\iint_D f(x,y)\,dA
$$

to polar coordinates, three things must be changed. First, every $x$ must be replaced by $r\cos\theta$. Second, every $y$ must be replaced by $r\sin\theta$. Third, the area element $dA$ must be replaced by $r\,dr\,d\theta$. If $D'$ denotes the corresponding region in the $r\theta$-plane, then

$$
\iint_D f(x,y)\,dA
=
\iint_{D'} f(r\cos\theta,r\sin\theta)\,r\,dr\,d\theta.
$$

The region $D'$ is not the same object as $D$. The set $D$ is a set of points $(x,y)$ in the physical plane. The set $D'$ is a set of coordinate pairs $(r,\theta)$ that describe those same points. This distinction prevents a common mistake: one must transform the bounds as well as the formula being integrated.

![pasted 1781431036186](/math-2/assets/pasted-1781431036186.png)

Consider the volume under the paraboloid

$$
z=1-x^2-y^2
$$

above the $xy$-plane. The surface meets the $xy$-plane when $z=0$, so

$$
1-x^2-y^2=0.
$$

Thus the base region is the unit disk

$$
x^2+y^2\leq 1.
$$

In Cartesian coordinates, the volume is

$$
V=
\int_{-1}^{1}
\int_{-\sqrt{1-x^2}}^{\sqrt{1-x^2}}
(1-x^2-y^2)\,dy\,dx.
$$

This is correct, but the circular base creates square-root bounds. In polar coordinates, the base is simply

$$
0\leq r\leq 1,\qquad 0\leq\theta\leq 2\pi.
$$

Also,

$$
x^2+y^2=r^2,
$$

so the height becomes

$$
1-x^2-y^2=1-r^2.
$$

Therefore

$$
V=
\int_0^{2\pi}\int_0^1 (1-r^2)\,r\,dr\,d\theta.
$$

The factor $1-r^2$ is the height of the solid, while the factor $r$ comes from the area element. Evaluating the integral gives

$$
\int_0^1 (1-r^2)r\,dr
= \int_0^1 (r-r^3)\,dr
= \left[\frac{r^2}{2}-\frac{r^4}{4}\right]_0^1
= \frac14.
$$

Hence

$$
V=
\int_0^{2\pi}\frac14\,d\theta
= \frac{\pi}{2}.
$$

This example shows the basic advantage of polar coordinates: the circular boundary becomes a constant radius, and the expression $x^2+y^2$ becomes $r^2$.

The safest way to set up polar bounds is to imagine a ray starting at the origin and rotating through the region. The angle bounds describe how far the ray rotates. For each fixed angle $\theta$, the radial bounds describe where the ray enters and exits the region. This is the polar version of vertical or horizontal slicing in Cartesian coordinates.

A circle centered at the origin usually gives a constant radial bound, such as $r=a$. A ray from the origin usually gives a constant angular bound, such as $\theta=\pi/4$. A circle not centered at the origin may give a radial bound depending on $\theta$, such as $r=2\sin\theta$ or $r=2\cos\theta$.

![pasted 1781431050089](/math-2/assets/pasted-1781431050089.png)

Let $R$ be the part of the annulus

$$
0<a^2\leq x^2+y^2\leq b^2
$$

that lies in the first quadrant and below the line $y=x$, where $a$ and $b$ are positive constants with $a\leq b$. The annular condition says that the distance from the origin lies between $a$ and $b$, so

$$
a\leq r\leq b.
$$

The first quadrant gives

$$
0\leq\theta\leq \frac{\pi}{2}.
$$

The line $y=x$ makes angle $\pi/4$ with the positive $x$-axis. Being below this line in the first quadrant means

$$
0\leq\theta\leq\frac{\pi}{4}.
$$

Therefore the region is described by

$$
0\leq\theta\leq\frac{\pi}{4},\qquad a\leq r\leq b.
$$

Now evaluate

$$
I=\iint_R \frac{y^2}{x^2}\,dA.
$$

The integrand becomes

$$
\frac{y^2}{x^2}
=
\frac{r^2\sin^2\theta}{r^2\cos^2\theta}
=
\tan^2\theta.
$$

Including the polar area element gives

$$
I=
\int_0^{\pi/4}\int_a^b \tan^2\theta\,r\,dr\,d\theta.
$$

Since $\tan^2\theta$ does not depend on $r$,

$$
I=
\left(\int_a^b r\,dr\right)
\left(\int_0^{\pi/4}\tan^2\theta\,d\theta\right).
$$

The radial integral is

$$
\int_a^b r\,dr=\frac12(b^2-a^2),
$$

and

$$
\int_0^{\pi/4}\tan^2\theta\,d\theta
= \int_0^{\pi/4}(\sec^2\theta-1)\,d\theta
= \left[\tan\theta-\theta\right]_0^{\pi/4}
= 1-\frac{\pi}{4}.
$$

Thus

$$
I=
\frac12(b^2-a^2)\left(1-\frac{\pi}{4}\right)
=
\frac{4-\pi}{8}(b^2-a^2).
$$

This example contains two important lessons. First, the line $y=x$ should be recognized as an angular boundary, not forced into Cartesian slicing. Second, even when the original integrand simplifies to a function of $\theta$ alone, the integral still contains the factor $r$ from $dA$.

![pasted 1781431075546](/math-2/assets/pasted-1781431075546.png)

A standard polar region is bounded by the rays

$$
\theta=\alpha,\qquad \theta=\beta
$$

and by a curve

$$
r=f(\theta),
$$

where $f(\theta)\geq 0$ on the interval $[\alpha,\beta]$. For a fixed angle $\theta$, the radius begins at the origin and ends at the curve, so

$$
0\leq r\leq f(\theta).
$$

The area of the region is the double integral of $1$ over the region:

$$
A=\iint_R 1\,dA.
$$

Using polar coordinates,

$$
A=
\int_\alpha^\beta
\int_0^{f(\theta)}
r\,dr\,d\theta.
$$

The inner integral is

$$
\int_0^{f(\theta)}r\,dr
= \left[\frac12r^2\right]_0^{f(\theta)}
= \frac12(f(\theta))^2.
$$

Therefore

$$
A=
\frac12\int_\alpha^\beta (f(\theta))^2\,d\theta.
$$

This formula is not separate from double integration. It is just the double integral of $1$, with the polar area factor $r$ integrated with respect to $r$.

Not every useful polar region is centered at the origin. A very important example is the disk

$$
x^2+y^2\leq 2y.
$$

At first this looks less polar than $x^2+y^2\leq 1$, because the right-hand side contains $y$. But substituting

$$
x=r\cos\theta,\qquad y=r\sin\theta
$$

gives

$$
r^2\leq 2r\sin\theta.
$$

Since $r\geq 0$, the origin $r=0$ is included. For $r>0$, we may divide by $r$, giving

$$
r\leq 2\sin\theta.
$$

Because $r$ must be nonnegative, we need

$$
2\sin\theta\geq 0.
$$

Thus $\theta$ must satisfy

$$
0\leq\theta\leq\pi.
$$

So the disk is described by

$$
0\leq\theta\leq\pi,\qquad 0\leq r\leq 2\sin\theta.
$$

This is a key bound-setting pattern. The radial upper bound depends on $\theta$, so the natural order is

$$
\int_0^\pi\int_0^{2\sin\theta}(\cdots)\,dr\,d\theta.
$$

This does not mean anything has gone wrong. It simply means that different rays from the origin travel different distances through the disk.

The related circle

$$
x^2+y^2\leq 2x
$$

is handled in exactly the same way. Substituting polar coordinates gives

$$
r^2\leq 2r\cos\theta.
$$

For $r>0$,

$$
r\leq 2\cos\theta.
$$

Because $r\geq 0$, we require

$$
\cos\theta\geq 0.
$$

Thus the full disk is described by

$$
-\frac{\pi}{2}\leq\theta\leq \frac{\pi}{2},
\qquad
0\leq r\leq 2\cos\theta.
$$

If we additionally require $y\geq 0$, then

$$
r\sin\theta\geq 0.
$$

Since $r\geq 0$, this means $\sin\theta\geq 0$. Combining this with $\cos\theta\geq 0$, we obtain

$$
0\leq\theta\leq\frac{\pi}{2}.
$$

So the upper half of the disk $x^2+y^2\leq 2x$ is described by

$$
0\leq\theta\leq\frac{\pi}{2},
\qquad
0\leq r\leq 2\cos\theta.
$$

This pattern is especially important because the same geometry appears in cylindrical-coordinate volume problems. In cylindrical coordinates,

$$
x=r\cos\theta,\qquad y=r\sin\theta,\qquad z=z,
$$

and the volume element is

$$
dV=r\,dr\,d\theta\,dz.
$$

The circular inequality $x^2+y^2\leq 2x$ still gives $0\leq r\leq 2\cos\theta$, but now there are also $z$-bounds. For example, if a solid lies inside the sphere

$$
x^2+y^2+z^2\leq 4,
$$

then in cylindrical coordinates this becomes

$$
r^2+z^2\leq 4,
$$

so

$$
-\sqrt{4-r^2}\leq z\leq \sqrt{4-r^2}.
$$

The polar work in the $xy$-plane is therefore the base of the cylindrical-coordinate setup. The only new ingredient in the three-dimensional version is the vertical $z$-direction.

Now consider the integral

$$
\iint_D xy\,dA
$$

over the region

$$
D=\{(x,y): x\leq y,\ 1\leq x^2+y^2\leq 2\}.
$$

The radial condition becomes

$$
1\leq r^2\leq 2,
$$

so

$$
1\leq r\leq \sqrt2.
$$

The inequality $x\leq y$ becomes

$$
r\cos\theta\leq r\sin\theta.
$$

Since $r>0$ in this annulus, we divide by $r$ and obtain

$$
\cos\theta\leq \sin\theta.
$$

On the interval $0\leq\theta<2\pi$, this is true for

$$
\frac{\pi}{4}\leq\theta\leq\frac{5\pi}{4}.
$$

Also,

$$
xy=(r\cos\theta)(r\sin\theta)=r^2\cos\theta\sin\theta.
$$

Including $dA=r\,dr\,d\theta$, the integral becomes

$$
\iint_D xy\,dA
=
\int_{\pi/4}^{5\pi/4}
\int_1^{\sqrt2}
r^3\cos\theta\sin\theta\,dr\,d\theta.
$$

This example shows why angular bounds must come from the actual inequality. The condition $x\leq y$ describes a half-plane, not merely a first-quadrant wedge. If one automatically chose $0\leq\theta\leq\pi/4$, one would integrate over the wrong region.

Polar coordinates are useful not only when the domain is circular, but also when the integrand is radial. A radial expression is one that depends on $x$ and $y$ through $x^2+y^2$. Since

$$
x^2+y^2=r^2,
$$

functions such as

$$
e^{-(x^2+y^2)}
$$

become

$$
e^{-r^2}.
$$

For example, over the whole plane,

$$
\iint_{\mathbb{R}^2}e^{-(x^2+y^2)}\,dA
=
\int_0^{2\pi}\int_0^\infty e^{-r^2}r\,dr\,d\theta.
$$

This is an improper double integral because the radial bound extends to infinity. The factor $r$ is again essential. It also makes the substitution

$$
u=r^2,\qquad du=2r\,dr
$$

natural. This is a typical reason polar coordinates are chosen: not only the domain, but also the integrand and the differential may fit together better in polar form.

Polar coordinates are a special case of a more general change of variables. Suppose new variables $u$ and $v$ are used, and the Cartesian coordinates are given by

$$
x=x(u,v),\qquad y=y(u,v).
$$

Here $u$ and $v$ are the new coordinates, while $x(u,v)$ and $y(u,v)$ tell us where the point is in the original $xy$-plane. If a region $S$ in the $uv$-plane is transformed into a region $D$ in the $xy$-plane, then

$$
\iint_D f(x,y)\,dx\,dy
=
\iint_S
f(x(u,v),y(u,v))
\left|
\frac{\partial(x,y)}{\partial(u,v)}
\right|
\,du\,dv.
$$

The determinant

$$
\frac{\partial(x,y)}{\partial(u,v)}
$$

is the Jacobian determinant of the transformation. Its absolute value gives the local area-scaling factor. In polar coordinates, $u=r$, $v=\theta$, and the determinant is $r$.

Sometimes a transformation is given in the reverse direction. Instead of being given $x$ and $y$ as functions of $u$ and $v$, one may be given

$$
u=u(x,y),\qquad v=v(x,y).
$$

In that case, the determinant

$$
\frac{\partial(u,v)}{\partial(x,y)}
$$

measures the scaling from the $xy$-plane to the $uv$-plane. But in the integral, we need the scaling from the $uv$-plane back to the $xy$-plane. Therefore, when the inverse transformation is used,

$$
\left|
\frac{\partial(x,y)}{\partial(u,v)}
\right|
=
\frac{1}{
\left|
\dfrac{\partial(u,v)}{\partial(x,y)}
\right|
}.
$$

This reciprocal relationship is a common source of errors. The determinant in the integral must match the direction in which the area element is being transformed.

A useful non-polar example is the elliptic disk

$$
\frac{x^2}{a^2}+\frac{y^2}{b^2}\leq 1,
$$

where $a>0$ and $b>0$. Ordinary polar coordinates are not ideal, because the boundary is not a circle centered at the origin with one fixed radius. Instead, we use scaled polar coordinates:

$$
x=a\rho\cos\theta,\qquad y=b\rho\sin\theta.
$$

Here $\rho$ is a new radial parameter satisfying $0\leq \rho\leq 1$. It is not the same as the ordinary distance $r=\sqrt{x^2+y^2}$ unless $a=b$. Substituting into the ellipse equation gives

$$
\frac{a^2\rho^2\cos^2\theta}{a^2}
+
\frac{b^2\rho^2\sin^2\theta}{b^2}
\leq 1,
$$

so

$$
\rho^2(\cos^2\theta+\sin^2\theta)\leq 1.
$$

Thus

$$
0\leq\rho\leq 1,\qquad 0\leq\theta\leq 2\pi.
$$

The Jacobian determinant is

$$
\det
\begin{pmatrix}
a\cos\theta & -a\rho\sin\theta \\
b\sin\theta & b\rho\cos\theta
\end{pmatrix}
=
ab\rho.
$$

Therefore the area of the ellipse is

$$
A=
\int_0^{2\pi}\int_0^1 ab\rho\,d\rho\,d\theta
=
ab\left[\frac{\rho^2}{2}\right]_0^1(2\pi)
=
\pi ab.
$$

This example separates two ideas that can otherwise become confused. In ordinary polar coordinates, $r$ is the actual distance from the origin. In scaled polar coordinates for an ellipse, $\rho$ is a coordinate parameter that turns the ellipse into a unit disk in the new coordinate plane. The Jacobian determinant corrects the area scaling.

![pasted 1781431127001](/math-2/assets/pasted-1781431127001.png)

A final application shows how polar bounds become part of a three-dimensional setup. Suppose a solid lies inside both the sphere

$$
x^2+y^2+z^2=4a^2
$$

and the cylinder

$$
x^2+y^2=2ay,
$$

where $a>0$. In the $xy$-plane, the cylinder boundary becomes

$$
r^2=2ar\sin\theta.
$$

For $r>0$, this gives

$$
r=2a\sin\theta.
$$

In the first octant, the angle range is

$$
0\leq\theta\leq\frac{\pi}{2},
$$

and the radial bounds are

$$
0\leq r\leq 2a\sin\theta.
$$

The sphere becomes

$$
r^2+z^2=4a^2,
$$

so the upper surface is

$$
z=\sqrt{4a^2-r^2}.
$$

If we describe the first-octant part as a height above its base in the $xy$-plane, its volume is

$$
\int_0^{\pi/2}
\int_0^{2a\sin\theta}
\sqrt{4a^2-r^2}\,r\,dr\,d\theta.
$$

The factor $\sqrt{4a^2-r^2}$ is the height, and the factor $r$ is the polar area factor. If the full solid is obtained by symmetry from four equal parts, the result is multiplied by $4$. This example belongs at the boundary between polar double integrals and triple integrals: the base is handled by polar coordinates, while the height comes from the three-dimensional surface.

When deciding whether to use polar coordinates, begin with the region. Polar coordinates are usually appropriate when the region is a disk, annulus, sector, shifted circle, or any region naturally described by distance from the origin and angle. They are also useful when the integrand contains $x^2+y^2$, because that becomes $r^2$. They may be less useful when the region is naturally rectangular or bounded by simple Cartesian graphs, unless the integrand strongly suggests a polar substitution.

The most common mistakes are predictable. The first is forgetting the area factor $r$. The second is treating $r$ as though it can freely be negative, instead of using $r\geq 0$ and allowing $\theta$ to describe direction. The third is using $\tan\theta=y/x$ without checking the quadrant. The fourth is converting the integrand but not the domain. The fifth is dividing by $r$ without thinking: if the origin belongs to the region, then $r=0$ must still be included, even though inequalities are often simplified by dividing by $r$ for $r>0$. The sixth is using the wrong Jacobian direction when a transformation is given as $u=u(x,y)$, $v=v(x,y)$ instead of $x=x(u,v)$, $y=y(u,v)$.

The central idea of this section is that a double integral still represents accumulation over area. Polar coordinates merely describe that area differently. The function must be rewritten using $x=r\cos\theta$ and $y=r\sin\theta$, the region must be rewritten in terms of $r$ and $\theta$, and the area element must become $r\,dr\,d\theta$. Once these three changes are made consistently, circular and radial problems become much more natural than they are in Cartesian coordinates.
