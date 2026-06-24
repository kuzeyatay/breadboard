---
title: "15.2 Iteration of Double Integrals in Cartesian Coordinates"
date: "2026-06-13T18:24:04.701Z"
source: "user-note"
knowledge_type: "user-note"
---

# 15.2 Iteration of Double Integrals in Cartesian Coordinates

A double integral is introduced because many quantities are spread over a two-dimensional region rather than along a one-dimensional interval. In one-variable calculus, an integral such as

$$
\int_a^b f(x)\,dx
$$

accumulates the values of a function along an interval on the $x$-axis. In multivariable calculus, the corresponding problem is to accumulate values of a function over a region in the plane. If $f(x,y)$ gives the height of a surface above the point $(x,y)$, then the double integral

$$
\iint_D f(x,y)\,dA
$$

measures the signed volume between the surface $z=f(x,y)$ and the region $D$ in the $xy$-plane. Here $D$ is the domain of integration, meaning the set of all points $(x,y)$ over which the accumulation is performed. The symbol $dA$ represents an infinitesimally small piece of area in the plane. If $f(x,y)$ is positive, each small area piece contributes a small positive volume. If $f(x,y)$ is negative, that part contributes signed volume below the $xy$-plane.

The previous section explains the meaning of the double integral by dividing $D$ into many small rectangles, approximating the function on each rectangle, and adding the small volumes. This gives the conceptual definition, but it is usually not how we calculate double integrals. Iteration solves the calculation problem. Instead of adding all tiny rectangles at once, we add them in an organized order: first along one-dimensional slices, and then across the remaining direction. The result is that a two-dimensional integral becomes two ordinary one-variable integrals performed one after the other.

The central idea is slicing. Imagine the solid under $z=f(x,y)$ and above $D$ as being cut into very thin sheets. First, for one fixed value of $x$, we integrate in the $y$-direction to find the area of one vertical sheet. Then we give that sheet an infinitesimal thickness $dx$ and add all such sheets from the left side of the region to the right side. Alternatively, we may fix $y$, integrate in the $x$-direction, and then add horizontal sheets from bottom to top. The double integral is the same accumulated quantity, but the calculation is organized in two possible directions.

A useful warning about terminology is needed here. Some sources name these regions using the labels $x$-simple and $y$-simple, but these labels can be remembered in opposite ways. To avoid making the method depend on terminology, this section uses the descriptive names **vertical-slice form** and **horizontal-slice form**. These names say directly how the region is being read.

![pasted 1781416443204](/math-2/assets/pasted-1781416443204.png)

A region $D$ is in **vertical-slice form** if every vertical line $x=\text{constant}$ intersects the region in one interval, possibly reduced to a single point. Such a region can be written as

$$
D=\{(x,y):a\le x\le b,\ c(x)\le y\le d(x)\}.
$$

In this description, $a$ and $b$ are constants giving the leftmost and rightmost $x$-values of the region. For each fixed $x$ between $a$ and $b$, the value of $y$ begins at the lower curve $y=c(x)$ and ends at the upper curve $y=d(x)$. The functions $c(x)$ and $d(x)$ are boundary functions. They may change as $x$ changes, which is exactly why the inner limits of integration are allowed to depend on $x$.

For a continuous function $f$ on such a region, the double integral can be computed as

$$
\iint_D f(x,y)\,dA=\int_a^b\int_{c(x)}^{d(x)} f(x,y)\,dy\,dx.
$$

The inner integral is

$$
\int_{c(x)}^{d(x)} f(x,y)\,dy.
$$

It is called the **inner integral** because it is evaluated first. During this integration, $y$ is the variable and $x$ is treated as a constant. Geometrically, it gives the signed area of one vertical sheet of the solid above the fixed $x$-value. After the inner integral has been evaluated, the result is a function of $x$. The outer integral

$$
\int_a^b(\cdots)\,dx
$$

then adds all these vertical sheet contributions from $x=a$ to $x=b$.

![pasted 1781416462703](/math-2/assets/pasted-1781416462703.png)

A region $D$ is in **horizontal-slice form** if every horizontal line $y=\text{constant}$ intersects the region in one interval, possibly reduced to a single point. Such a region can be written as

$$
D=\{(x,y):c\le y\le d,\ a(y)\le x\le b(y)\}.
$$

Here $c$ and $d$ are constants giving the lowest and highest $y$-values of the region. For each fixed $y$ between $c$ and $d$, the value of $x$ begins at the left boundary $x=a(y)$ and ends at the right boundary $x=b(y)$. The functions $a(y)$ and $b(y)$ are boundary functions, now written as functions of $y$ because the horizontal slice changes as $y$ changes.

For a continuous function $f$ on such a region,

$$
\iint_D f(x,y)\,dA=\int_c^d\int_{a(y)}^{b(y)} f(x,y)\,dx\,dy.
$$

Now the inner integral is evaluated with respect to $x$, so $y$ is treated as constant. The result is a function of $y$, and the outer integral adds the horizontal sheet contributions from $y=c$ to $y=d$.

![pasted 1781416494490](/math-2/assets/pasted-1781416494490.png)

The theorem justifying this method is the iteration theorem for double integrals, often associated with Fubini’s theorem. In the form needed here, it says that if $f$ is continuous on a bounded region that can be described by vertical slices or horizontal slices, then the double integral can be evaluated by the corresponding iterated integral. If the same region can be described in both ways, then both orders of integration give the same final number:

$$
\int_a^b\int_{c(x)}^{d(x)} f(x,y)\,dy\,dx=\int_c^d\int_{a(y)}^{b(y)} f(x,y)\,dx\,dy,
$$

provided both iterated integrals describe the same region $D$ and the same integrand $f(x,y)$.

This equality is powerful, but it is also easy to misuse. It does not mean that one may simply switch $dx$ and $dy$ while leaving the limits unchanged. The equality means that the same two-dimensional region may be swept out by vertical slices or by horizontal slices. When the slicing direction changes, the bounds must usually be rebuilt from the geometry of the region.

The notation $dA$, $dx\,dy$, and $dy\,dx$ also needs to be interpreted carefully. In a non-iterated double integral,

$$
\iint_D f(x,y)\,dA,
\qquad
\iint_D f(x,y)\,dx\,dy,
\qquad
\iint_D f(x,y)\,dy\,dx
$$

all mean that $f$ is being integrated over area in the plane. Once the integral is written as an iterated integral, however, the order of the differentials tells us which variable is integrated first. In

$$
\int_a^b\int_{c(x)}^{d(x)} f(x,y)\,dy\,dx,
$$

the $dy$ belongs to the inner integral, so $y$ changes first while $x$ is fixed. In

$$
\int_c^d\int_{a(y)}^{b(y)} f(x,y)\,dx\,dy,
$$

the $dx$ belongs to the inner integral, so $x$ changes first while $y$ is fixed. In Cartesian coordinates, $dA$ is represented by $dx\,dy$ or $dy\,dx$. In later coordinate systems the area element may change, so in this section there is no extra factor: the whole issue is the order and the bounds.

The simplest case is a rectangle with sides parallel to the coordinate axes. Suppose

$$
Q=\{(x,y):0\le x\le 1,\ 1\le y\le 2\}
$$

and

$$
f(x,y)=4-x-y.
$$

The double integral

$$
\iint_Q (4-x-y)\,dA
$$

represents the signed volume under the plane $z=4-x-y$ and above the rectangle $Q$. Since $Q$ is a rectangle, both variables have constant bounds. We may integrate first with respect to $x$:

$$
\iint_Q (4-x-y)\,dA=\int_1^2\int_0^1 (4-x-y)\,dx\,dy.
$$

The inner integral is

$$
\int_0^1(4-x-y)\,dx=\left[4x-\frac{x^2}{2}-xy\right]_0^1=\frac{7}{2}-y.
$$

Therefore

$$
\int_1^2\left(\frac{7}{2}-y\right)\,dy=\left[\frac{7y}{2}-\frac{y^2}{2}\right]_1^2=2.
$$

The same calculation can be done by integrating first with respect to $y$:

$$
\iint_Q (4-x-y)\,dA=\int_0^1\int_1^2 (4-x-y)\,dy\,dx.
$$

The inner integral is

$$
\int_1^2(4-x-y)\,dy=\left[4y-xy-\frac{y^2}{2}\right]_1^2=\frac{5}{2}-x.
$$

Then

$$
\int_0^1\left(\frac{5}{2}-x\right)\,dx=\left[\frac{5x}{2}-\frac{x^2}{2}\right]_0^1=2.
$$

It is reassuring but not surprising that both orders give the same answer. In a rectangle, the bounds are constant, so changing the order is mechanically simple. This is not true for most non-rectangular regions.

![pasted 1781416533571](/math-2/assets/pasted-1781416533571.png)

![pasted 1781416555859](/math-2/assets/pasted-1781416555859.png)

Consider the triangle $T$ with vertices

$$
(0,0),\qquad (1,0),\qquad (1,1).
$$

Its slanted boundary is the line $y=x$. We want to evaluate

$$
\iint_T xy\,dA.
$$

First describe $T$ using vertical slices. The $x$-values run from $0$ to $1$. For each fixed $x$, the vertical slice begins at the lower boundary $y=0$ and ends at the slanted boundary $y=x$. Therefore

$$
T=\{(x,y):0\le x\le 1,\ 0\le y\le x\}.
$$

Thus

$$
\iint_T xy\,dA=\int_0^1\int_0^x xy\,dy\,dx.
$$

In the inner integral, $x$ is constant and $y$ is the integration variable:

$$
\int_0^x xy\,dy=x\left[\frac{y^2}{2}\right]_0^x=\frac{x^3}{2}.
$$

The outer integral gives

$$
\int_0^1 \frac{x^3}{2}\,dx=\left[\frac{x^4}{8}\right]_0^1=\frac{1}{8}.
$$

Now describe the same triangle using horizontal slices. The $y$-values run from $0$ to $1$. For each fixed $y$, the horizontal slice begins at the slanted line $x=y$ and ends at the vertical line $x=1$. Therefore

$$
T=\{(x,y):0\le y\le 1,\ y\le x\le 1\}.
$$

This gives

$$
\iint_T xy\,dA=\int_0^1\int_y^1 xy\,dx\,dy.
$$

In the inner integral, $y$ is constant and $x$ is the integration variable:

$$
\int_y^1 xy\,dx=y\left[\frac{x^2}{2}\right]_y^1=\frac{y}{2}(1-y^2).
$$

Then

$$
\int_0^1 \frac{y}{2}(1-y^2)\,dy=\int_0^1\left(\frac{y}{2}-\frac{y^3}{2}\right)\,dy=\left[\frac{y^2}{4}-\frac{y^4}{8}\right]_0^1=\frac{1}{8}.
$$

The important lesson is not only that both answers match. The important lesson is how the bounds changed. The vertical description $0\le y\le x$ became the horizontal description $y\le x\le 1$. Changing order is a geometric operation, not a symbol swap.

A reliable procedure for setting up a Cartesian double integral is therefore to begin with the region. If using vertical slices, first find the full interval of $x$-values covered by the region. Then, for a typical fixed $x$, read the lower and upper $y$-boundaries. If using horizontal slices, first find the full interval of $y$-values covered by the region. Then, for a typical fixed $y$, read the left and right $x$-boundaries. The drawing is not decorative. It is the mechanism that determines the limits.

This becomes especially important when one order of integration is much easier than the other. Consider

$$
I=\int_0^1\int_{\sqrt{x}}^1 e^{y^3}\,dy\,dx.
$$

The inner integral asks for an antiderivative of $e^{y^3}$ with respect to $y$. There is no elementary antiderivative for this function, so the given order is not useful for direct calculation. This does not mean that the double integral cannot be evaluated. It means that the order should be reconsidered.

The bounds say that

$$
0\le x\le 1,\qquad \sqrt{x}\le y\le 1.
$$

The curve $y=\sqrt{x}$ is equivalent, in the first quadrant, to $x=y^2$. The original inequalities describe the region above the curve $y=\sqrt{x}$, below the line $y=1$, and between $x=0$ and $x=1$. In horizontal-slice form, $y$ runs from $0$ to $1$, and for each fixed $y$, $x$ runs from $0$ to $y^2$. Thus

$$
D=\{(x,y):0\le y\le 1,\ 0\le x\le y^2\}.
$$

![pasted 1781416601863](/math-2/assets/pasted-1781416601863.png)

Changing the order gives

$$
I=\int_0^1\int_0^{y^2} e^{y^3}\,dx\,dy.
$$

Now the inner integral is with respect to $x$. Since $e^{y^3}$ does not depend on $x$, it is constant during the inner integration:

$$
\int_0^{y^2} e^{y^3}\,dx=y^2e^{y^3}.
$$

Therefore

$$
I=\int_0^1 y^2e^{y^3}\,dy.
$$

Using the substitution

$$
u=y^3,\qquad du=3y^2\,dy,
$$

we obtain

$$
I=\frac{1}{3}\int_0^1 e^u\,du=\frac{e-1}{3}.
$$

This example shows the practical reason for changing order: the geometry of the region can be used to avoid an impossible or inconvenient antiderivative.

A similar lecture-style example is

$$
\int_0^{\pi/2}\int_y^{\pi/2}\frac{\sin x}{x}\,dx\,dy.
$$

The inner integral, as written, asks for an antiderivative of $\sin x/x$ with respect to $x$, which is not elementary. The bounds describe

$$
0\le y\le \frac{\pi}{2},\qquad y\le x\le \frac{\pi}{2}.
$$

This is the triangular region below the line $y=x$ and inside the square $0\le x,y\le \pi/2$. If we describe the same region using vertical slices, then $x$ runs from $0$ to $\pi/2$, and for each fixed $x$, $y$ runs from $0$ to $x$. Therefore

$$
\int_0^{\pi/2}\int_y^{\pi/2}\frac{\sin x}{x}\,dx\,dy=\int_0^{\pi/2}\int_0^x\frac{\sin x}{x}\,dy\,dx.
$$

Now the inner integral is with respect to $y$, so $\sin x/x$ is constant:

$$
\int_0^x\frac{\sin x}{x}\,dy=\frac{\sin x}{x}[y]_0^x=\sin x.
$$

Thus the original integral becomes

$$
\int_0^{\pi/2}\sin x\,dx=[-\cos x]_0^{\pi/2}=1.
$$

This example is especially useful because the change of order does not merely simplify the work; it changes the calculation from a non-elementary antiderivative into a basic trigonometric integral.

However, “choosing the right order” does not always mean reversing the order. Sometimes the order already given is the better one. Consider

$$
\int_0^1\int_{\sqrt{y}}^1 xe^{x^2}\,dx\,dy.
$$

The bounds describe

$$
0\le y\le 1,\qquad \sqrt{y}\le x\le 1.
$$

Since $\sqrt{y}\le x$ and $x\ge 0$, this is equivalent to $y\le x^2$. The same region can also be written as

$$
0\le x\le 1,\qquad 0\le y\le x^2.
$$

But before changing anything, inspect the integrand. The given inner integral is

$$
\int_{\sqrt{y}}^1 xe^{x^2}\,dx.
$$

This is directly manageable because the derivative of $x^2$ is $2x$. Using $u=x^2$, or recognizing the pattern immediately, gives

$$
\int_{\sqrt{y}}^1 xe^{x^2}\,dx=\frac{1}{2}\left[e^{x^2}\right]_{\sqrt{y}}^1=\frac{1}{2}(e-e^y).
$$

The remaining integral is

$$
\int_0^1 \frac{1}{2}(e-e^y)\,dy=\frac{1}{2}\left[ey-e^y\right]_0^1=\frac{1}{2}.
$$

The lesson is that the best order depends on both the region and the integrand. First draw or understand the region; then inspect which inner integral is actually doable.

A particularly important special case is area. If the integrand is $1$, then the double integral counts area:

$$
\operatorname{Area}(D)=\iint_D 1\,dA.
$$

This works because each small area element contributes $1\cdot dA=dA$, and adding all area elements gives the total area of $D$.

Consider the region $R$ bounded below by the parabola

$$
y=x^2
$$

and above by the line

$$
y=x+2.
$$

To find the area using a double integral, first find the intersection points. These occur when

$$
x^2=x+2.
$$

Rearranging gives

$$
x^2-x-2=0,
$$

so

$$
(x-2)(x+1)=0.
$$

Hence the curves intersect at

$$
x=-1
\qquad\text{and}\qquad
x=2.
$$

Between these two values, the line $y=x+2$ lies above the parabola $y=x^2$. Therefore the region has vertical-slice form

$$
R=\{(x,y):-1\le x\le 2,\ x^2\le y\le x+2\}.
$$

The area is

$$
\operatorname{Area}(R)=\int_{-1}^{2}\int_{x^2}^{x+2}1\,dy\,dx.
$$

The inner integral measures the vertical length of one slice:

$$
\int_{x^2}^{x+2}1\,dy=x+2-x^2.
$$

Thus

$$
\operatorname{Area}(R)=\int_{-1}^{2}(x+2-x^2)\,dx.
$$

Evaluating,

$$
\int_{-1}^{2}(x+2-x^2)\,dx=\left[\frac{x^2}{2}+2x-\frac{x^3}{3}\right]_{-1}^{2}.
$$

At $x=2$, this expression gives

$$
\frac{4}{2}+4-\frac{8}{3}=2+4-\frac{8}{3}=\frac{10}{3}.
$$

At $x=-1$, it gives

$$
\frac{1}{2}-2+\frac{1}{3}=-\frac{7}{6}.
$$

Therefore

$$
\operatorname{Area}(R)=\frac{10}{3}-\left(-\frac{7}{6}\right)=\frac{20}{6}+\frac{7}{6}=\frac{27}{6}=\frac{9}{2}.
$$

This example shows why drawing the region and identifying the top and bottom curves is part of the mathematical work. If the upper and lower curves are reversed, the answer would have the wrong sign.

Some regions cannot be described conveniently by one set of vertical or horizontal slices. A region is called **regular** if it can be divided into finitely many pieces, each of which can be described by vertical slices or horizontal slices. The word “finitely” means that only a finite number of ordinary iterated integrals is needed. If

$$
D=D_1\cup D_2\cup \cdots \cup D_k
$$

where the pieces do not overlap except possibly along boundary curves, then additivity gives

$$
\iint_D f(x,y)\,dA=\sum_{i=1}^k \iint_{D_i} f(x,y)\,dA.
$$

The boundary curves along which the pieces touch have zero area, so splitting along such curves does not change the value of the integral. This is useful when one single formula for the bounds would be awkward or impossible.

Changing order is not only a computational trick; it can also prove identities. Let $F$ and $G$ be antiderivatives of $f$ and $g$, respectively, so

$$
F'(x)=f(x),
\qquad
G'(x)=g(x).
$$

Consider the triangular region

$$
T=\{(x,y):a\le y\le x\le b\}.
$$

Integrate the product $f(x)g(y)$ over $T$. Using vertical slices, $x$ runs from $a$ to $b$, and for each $x$, $y$ runs from $a$ to $x$. Therefore

$$
\iint_T f(x)g(y)\,dA=\int_a^b\int_a^x f(x)g(y)\,dy\,dx.
$$

Since $f(x)$ is constant during the inner $y$-integration,

$$
\int_a^x f(x)g(y)\,dy=f(x)[G(y)]_a^x=f(x)(G(x)-G(a)).
$$

Thus

$$
\iint_T f(x)g(y)\,dA=\int_a^b f(x)G(x)\,dx-G(a)\int_a^b f(x)\,dx.
$$

Since

$$
\int_a^b f(x)\,dx=F(b)-F(a),
$$

this becomes

$$
\iint_T f(x)g(y)\,dA=\int_a^b f(x)G(x)\,dx-G(a)(F(b)-F(a)).
$$

Now compute the same double integral using horizontal slices. The variable $y$ runs from $a$ to $b$, and for each fixed $y$, $x$ runs from $y$ to $b$. Hence

$$
\iint_T f(x)g(y)\,dA=\int_a^b\int_y^b f(x)g(y)\,dx\,dy.
$$

Since $g(y)$ is constant during the inner $x$-integration,

$$
\int_y^b f(x)g(y)\,dx=g(y)[F(x)]_y^b=g(y)(F(b)-F(y)).
$$

Therefore

$$
\iint_T f(x)g(y)\,dA=F(b)\int_a^b g(y)\,dy-\int_a^b g(y)F(y)\,dy.
$$

Since

$$
\int_a^b g(y)\,dy=G(b)-G(a),
$$

we get

$$
\iint_T f(x)g(y)\,dA=F(b)(G(b)-G(a))-\int_a^b g(y)F(y)\,dy.
$$

Both expressions are equal because they are two computations of the same double integral. Equating them and simplifying gives

$$
\int_a^b f(x)G(x)\,dx=F(b)G(b)-F(a)G(a)-\int_a^b g(x)F(x)\,dx.
$$

This is the integration-by-parts formula in definite-integral form. The point is not that double integrals are needed every time one integrates by parts. The point is that changing the order of integration can reveal why an identity is true: the same two-dimensional accumulation can be sliced in two different ways.

The main practical distinction in this section is between a double integral as a mathematical object and an iterated integral as a calculation method. The double integral

$$
\iint_D f(x,y)\,dA
$$

means accumulation over the two-dimensional region $D$. An iterated integral such as

$$
\int_a^b\int_{c(x)}^{d(x)} f(x,y)\,dy\,dx
$$

is one way of computing that accumulation by slices. The region determines the bounds, the inner differential determines which variable is integrated first, and the iteration theorem justifies either valid slicing direction when the function is continuous and the region admits both descriptions.

Most mistakes in this topic do not come from the one-variable integration itself. They come from describing the region incorrectly, treating the inner variable as if it were still free after integration, reversing the order without redrawing the domain, or forgetting that the upper and lower boundaries change when the slicing direction changes. The safest method is always the same: draw the region, choose a slicing direction, read the outer range, read the inner bounds from a typical slice, and only then perform the integrations. Iteration of double integrals in Cartesian coordinates is therefore the bridge between the geometric meaning of a double integral and the practical ability to compute areas, volumes, and accumulated quantities over plane regions.
