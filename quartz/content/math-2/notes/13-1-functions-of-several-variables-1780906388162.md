---
title: "13.1 Functions of Several Variables"
date: "2026-06-08T08:13:08.162Z"
source: "user-note"
knowledge_type: "user-note"
---

# 13.1 Functions of Several Variables

Until now, the course has mainly used geometry to describe objects in space. A point in three-dimensional space was described by coordinates such as $(x,y,z)$. A surface could be described by an equation such as $x^2+y^2+z^2=9$. A curve could be described by a vector function $\mathbf r(t)$, where one parameter $t$ determines the position of a moving point. The next problem is different. Instead of only describing where a point is, we often want to attach a numerical quantity to each point. A point on a map may have a height above sea level. A point in a room may have a temperature. A point in a solid object may have a density. A point in space may have an electric potential. In all these examples, the input is a position, usually described by two or three coordinates, and the output is one real number.

This is the immediate reason for introducing functions of several variables. A one-variable function such as $y=f(x)$ assigns one output value to one input number $x$. A function of several variables assigns one output value to an input point. If the input point has two coordinates, we write the function as $f(x,y)$. If the input point has three coordinates, we write it as $f(x,y,z)$. More generally, if the input point has $d$ coordinates, we write

$$
f:\mathcal D\subseteq \mathbb R^d\to \mathbb R.
$$

Here $\mathcal D$ is the domain of the function. The domain is the set of input points for which the function is defined. The notation $\mathbb R^d$ means $d$-dimensional real coordinate space. Thus $\mathbb R^2$ is the plane, $\mathbb R^3$ is ordinary three-dimensional space, and $\mathbb R^d$ is the corresponding $d$-dimensional version. The notation $\to\mathbb R$ means that the output is a real number. If the input point is written as

$$
\mathbf x=(x_1,x_2,\ldots,x_d),
$$

then the value of the function at that point is written as

$$
f(\mathbf x)=f(x_1,x_2,\ldots,x_d).
$$

The bold symbol $\mathbf x$ emphasizes that the input is a point or position, not just a single coordinate.

The important distinction is between the input object and the output object. In this section, the input may have several coordinates, but the output is still a single scalar value. A scalar is an ordinary real number, such as a height, temperature, density, or volume. This is different from a vector function of one variable, such as $\mathbf r(t)$, where the input is one number $t$ and the output is a vector position. It is also different from a vector field, where each point is assigned a vector. Vector fields appear later. In the present section, the function has several input variables but only one output value.

A simple physical example is the volume of a circular cylinder. If a cylinder has radius $r$ and height $h$, its volume is

$$
V=\pi r^2h.
$$

If we call this volume function $f$, then

$$
f(r,h)=\pi r^2h.
$$

Here $r$ and $h$ are the independent variables, because they are the input quantities chosen freely, subject to the physical restrictions of the problem. The output $f(r,h)$, or $V$, is the dependent variable, because its value is determined by $r$ and $h$. Since a radius and a height cannot be negative in this physical situation, the natural domain is

$$
\mathcal D=\{(r,h)\in\mathbb R^2:r\ge 0,\ h\ge 0\}.
$$

The range is the set of output values that actually occur. In this example the range is $V\ge 0$, because a volume cannot be negative.

In pure mathematical problems, the domain may be given explicitly. If it is not given, the usual convention is to take the largest set of input points for which the formula makes sense as a real-valued formula. This is called the maximal domain of definition. The word maximal means that every point where the formula is valid should be included, and every point where the formula is invalid should be excluded.

To find a maximal domain, translate every operation in the formula into a condition on the variables. A denominator may not be zero. An even root, such as a square root, requires the expression under the root to be non-negative. A logarithm requires its argument to be strictly positive. An inverse sine or inverse cosine requires its argument to lie between $-1$ and $1$. All restrictions must hold at the same time, so the domain is the intersection of all the conditions.

For example, consider

$$
f(x,y)=\sqrt{9-x^2-y^2}.
$$

The square root is real only when the expression under it is non-negative. Therefore,

$$
9-x^2-y^2\ge 0.
$$

Rearranging gives

$$
x^2+y^2\le 9.
$$

Thus the maximal domain is

$$
\mathcal D=\{(x,y)\in\mathbb R^2:x^2+y^2\le 9\}.
$$

This is the closed disk of radius $3$ centred at the origin in the $xy$-plane. The domain is not the hemisphere itself. The domain is the set of allowed input points $(x,y)$. The graph, introduced below, is the surface obtained after attaching the height $z=f(x,y)$ above each domain point.

Another square-root example shows why the domain is not always a disk. Consider

$$
f(x,y)=\sqrt{1+y^2-x^2}.
$$

Again the expression under the square root must be non-negative:

$$
1+y^2-x^2\ge 0.
$$

Moving terms gives

$$
x^2-y^2\le 1.
$$

Therefore the maximal domain is

$$
\mathcal D=\{(x,y)\in\mathbb R^2:x^2-y^2\le 1\}.
$$

The boundary of this domain is the hyperbola

$$
x^2-y^2=1.
$$

The domain consists of the points on and between the two branches of this hyperbola, in the sense determined by the inequality $x^2-y^2\le 1$. This example is important because it prevents a common mistake: a square root condition does not automatically produce a circle or disk. The shape of the domain depends on the expression under the square root.

A logarithm example is more delicate. Consider

$$
g(x,y)=\ln\!\left(1-\sqrt{1-xy}\right).
$$

There are two restrictions. First, the square root requires

$$
1-xy\ge 0,
$$

so

$$
xy\le 1.
$$

Second, the logarithm requires its argument to be strictly positive:

$$
1-\sqrt{1-xy}>0.
$$

This inequality is equivalent to

$$
\sqrt{1-xy}<1.
$$

Since both sides are non-negative, squaring preserves the inequality:

$$
1-xy<1.
$$

Thus

$$
xy>0.
$$

Combining the two conditions gives

$$
0<xy\le 1.
$$

So the maximal domain is

$$
\mathcal D=\{(x,y)\in\mathbb R^2:0<xy\le 1\}.
$$

This domain lies in the first and third quadrants, because $xy>0$ means that $x$ and $y$ have the same sign. The coordinate axes are excluded, because there $xy=0$. The hyperbola branches $xy=1$ are included, because equality is allowed in $xy\le 1$. This example shows why domain questions must be handled step by step: the square root gives one condition, the logarithm gives another, and the final domain is where both conditions are true.

Another common lecture example is

$$
f(x,y)=\frac{\sin\!\left(\sqrt{x^2+y^2}\right)}{\sqrt{x^2+y^2}}.
$$

The numerator is defined for all $(x,y)$, and the square root $\sqrt{x^2+y^2}$ is also defined for all $(x,y)$. The only problem is the denominator. Since

$$
\sqrt{x^2+y^2}=0
$$

only at $(0,0)$, the formula is undefined only at the origin. Therefore the maximal domain is

$$
\mathcal D=\mathbb R^2\setminus\{(0,0)\}.
$$

It is tempting to say that the function “should” have a value at the origin because the expression behaves nicely near $(0,0)$. That question belongs to limits and continuity. In the present section, the domain of the given formula is determined only by where the formula itself is defined.

After finding a domain, one often has to classify it. The first useful word is interior point. A point $P$ in a domain $\mathcal D$ is an interior point if a small disk around $P$ lies completely inside $\mathcal D$. More precisely, there must be some radius $r>0$ such that every point whose distance from $P$ is less than $r$ is still in $\mathcal D$. The disk of radius $r$ around $P$ is often denoted by

$$
B_r(P).
$$

Here $B_r(P)$ means all points whose distance from $P$ is less than $r$.

A domain is open if every point of the domain is an interior point. Intuitively, an open domain contains none of its boundary edge. For example,

$$
\{(x,y):x^2+y^2<9\}
$$

is open, because every point inside the circle has a small disk around it that still remains inside the circle. The boundary circle $x^2+y^2=9$ is not included.

A boundary point of a domain is a point where every small disk around it touches both the domain and the outside of the domain. A domain is closed if it contains all of its boundary points. For example,

$$
\{(x,y):x^2+y^2\le 9\}
$$

is closed, because the boundary circle $x^2+y^2=9$ is included. Closed does not mean “bounded” or “finite.” A region can extend infinitely far and still be closed if it contains all of its boundary points.

Some domains are neither open nor closed. For example,

$$
\{(x,y):0<x^2+y^2\le 9\}
$$

is neither open nor closed. It is not open, because it includes the outer boundary circle $x^2+y^2=9$. Points on that circle do not have small disks lying entirely inside the domain. It is not closed, because the origin $(0,0)$ is missing even though points of the domain can get arbitrarily close to it.

An isolated point of a domain is a point of the domain that stands alone. Formally, $P\in\mathcal D$ is isolated if there is some radius $r>0$ such that

$$
B_r(P)\cap\mathcal D=\{P\}.
$$

This means that a small disk around $P$ contains no other domain point except $P$ itself. Most regions described by inequalities do not have isolated points, because near any point in the region there are usually many other points of the region. But isolated points can appear in specially constructed domains, and exam questions may ask you to justify whether a given point is isolated. To show that a point is not isolated, it is enough to find other domain points arbitrarily close to it.

A connected domain is, informally, a domain consisting of one piece. For the kinds of plane regions used in this course, this means that any two points in the domain can be joined by a continuous path that stays inside the domain. For example, the disk $x^2+y^2\le 9$ is connected. The set

$$
\{(x,y):0<xy\le 1\}
$$

is not connected, because it has one part in the first quadrant and another separate part in the third quadrant. There is no path inside the domain connecting these two parts without crossing the axes, but the axes are excluded.

These classification words are not separate from domain finding. They are part of understanding the domain as a geometric object. For

$$
f(x,y)=\sqrt{1+y^2-x^2},
$$

the domain

$$
\mathcal D=\{(x,y):x^2-y^2\le 1\}
$$

is closed, because the boundary hyperbola $x^2-y^2=1$ is included. It is not open, because boundary points are included. It is connected, because the region is one continuous piece. The point $(1,0)$ lies on the boundary, since $1^2-0^2=1$, but it is not isolated: there are infinitely many domain points arbitrarily close to $(1,0)$, for example points slightly inside the inequality $x^2-y^2<1$.

A typical domain-classification example has the form

$$
f(x,y)=1-\sqrt{xy+x^2}.
$$

The square root requires

$$
xy+x^2\ge 0.
$$

Factoring gives

$$
x(y+x)\ge 0.
$$

Thus the boundary lines are $x=0$ and $y=-x$, and the domain consists of the regions where the product $x(y+x)$ is non-negative. Because the inequality is $\ge 0$, the boundary lines are included. Therefore the domain is closed. The origin $(0,0)$ is not isolated, because both boundary lines pass through it and contain other domain points arbitrarily close to it. This kind of reasoning is often more important than drawing a perfect sketch: the algebra tells you the boundary, and the inequality tells you which side or sides are included.

![pasted 1780907400747](/math-2/assets/pasted-1780907400747.png)

For a one-variable function $y=f(x)$, the graph is the set of points $(x,f(x))$ in the $xy$-plane. For a function of two variables, the graph is similar in idea but one dimension higher. If

$$
z=f(x,y),
$$

then the graph is the set

$$
\{(x,y,z)\in\mathbb R^3:z=f(x,y),\ (x,y)\in\mathcal D\}.
$$

Here $(x,y)$ is an input point in the domain, and $z=f(x,y)$ is the height attached to that point. The graph is usually a surface in three-dimensional space. Points where $f(x,y)>0$ lie above the $xy$-plane, and points where $f(x,y)<0$ lie below it.

This definition explains why not every surface is the graph of a function $z=f(x,y)$. A function is only allowed to assign one output value to each input point. Therefore, for each fixed $(x,y)$, there may be at most one corresponding $z$-value. A full sphere fails this test in Cartesian coordinates, because most points $(x,y)$ inside the disk $x^2+y^2<9$ correspond to two points on the sphere: one with positive $z$ and one with negative $z$. The upper hemisphere alone can be written as

$$
z=\sqrt{9-x^2-y^2},
$$

and the lower hemisphere alone can be written as

$$
z=-\sqrt{9-x^2-y^2}.
$$

The whole sphere can be described by the equation

$$
x^2+y^2+z^2=9,
$$

but that equation is not the graph of a single Cartesian function $z=f(x,y)$. In spherical coordinates, the same sphere can be described simply by $R=3$. That is a coordinate description of the surface, not the same thing as saying that the sphere is the graph of one Cartesian function $z=f(x,y)$.

![pasted 1780907423980](/math-2/assets/pasted-1780907423980.png)

Consider the function

$$
f(x,y)=3\left(1-\frac{x}{2}-\frac{y}{4}\right),
$$

with domain

$$
0\le x\le 2,\qquad 0\le y\le 4-2x.
$$

The formula itself represents a plane, because it is linear in $x$ and $y$. However, the stated domain restricts the graph to a triangular part of that plane. The domain in the $xy$-plane is the triangle with vertices $(0,0)$, $(2,0)$, and $(0,4)$. The corresponding graph has vertices

$$
(0,0,3),\qquad (2,0,0),\qquad (0,4,0).
$$

This example separates the formula from the domain. The same formula, without the domain restriction, would describe the whole plane. With the domain restriction, it describes only a triangular plane surface.

![pasted 1780907558711](/math-2/assets/pasted-1780907558711.png)

For

$$
f(x,y)=\sqrt{9-x^2-y^2},
$$

the domain is the disk $x^2+y^2\le 9$, and the graph is the upper hemisphere of the sphere $x^2+y^2+z^2=9$. The square root forces $z\ge 0$, so only the upper half appears. This is a common place to confuse the domain and the graph. The domain is two-dimensional and lies flat in the $xy$-plane. The graph is a surface in three-dimensional space.

![pasted 1780907583471](/math-2/assets/pasted-1780907583471.png)

Graphs of functions of two variables can be difficult to draw by hand because a three-dimensional surface must be represented on a two-dimensional page. A useful strategy is to examine traces. A trace is an intersection of the graph with a coordinate plane or with a plane parallel to a coordinate plane. For example, setting $y=0$ gives the trace in the $xz$-plane, while setting $x=0$ gives the trace in the $yz$-plane. Traces are not new functions; they are slices of the graph that help reveal its shape.

A function of three variables, such as

$$
w=f(x,y,z),
$$

has input points $(x,y,z)\in\mathbb R^3$ and output value $w\in\mathbb R$. Its graph would consist of points

$$
(x,y,z,w)
$$

in $\mathbb R^4$. Such a graph exists mathematically, but it cannot be drawn as an ordinary three-dimensional picture. This is why functions of three variables are usually visualized by level surfaces rather than by their full graphs.

![pasted 1780907613881](/math-2/assets/pasted-1780907613881.png)

A second way to represent a function of two variables is by level curves. A level curve is the set of all input points $(x,y)$ where the function has one fixed value. If the fixed value is $C$, the level curve is described by

$$
f(x,y)=C.
$$

Here $C$ is a constant. The variables $x$ and $y$ are still allowed to vary, but only in such a way that the output remains equal to $C$. Geometrically, the level curve is obtained by cutting the graph $z=f(x,y)$ with the horizontal plane $z=C$, then projecting the intersection down onto the $xy$-plane.

The topographic-map interpretation is the best intuition. A map of a mountain usually does not draw the whole mountain as a three-dimensional surface. Instead, it draws curves along which the height is constant. If two contour lines correspond to heights differing by $40$ metres, then closely spaced contour lines indicate a steep region, because a large change in height occurs over a small horizontal distance. Widely spaced contour lines indicate a gentler region. The same idea applies to level curves of any scalar function.

Level curves with different labels cannot cross. The reason is simple. If two different level curves $f(x,y)=C_1$ and $f(x,y)=C_2$, with $C_1\ne C_2$, crossed at the same point, then the same input point would have to produce two different output values. That is impossible for a function. However, one level set can consist of several separate pieces. For example, a hyperbola may have two branches, both belonging to the same level value.

This gives a useful test for whether a proposed family of curves could be the level curves of a function. Suppose someone claims that the curves

$$
y=(x-C)^2
$$

are level curves of some function, where $C$ varies. Take two different values, such as $C=0$ and $C=1$. The corresponding curves are

$$
y=x^2
$$

and

$$
y=(x-1)^2.
$$

They intersect when

$$
x^2=(x-1)^2.
$$

Expanding gives

$$
x^2=x^2-2x+1,
$$

so

$$
x=\frac12.
$$

At this point,

$$
y=\left(\frac12\right)^2=\frac14.
$$

Thus two curves from the family intersect at $(1/2,1/4)$. They cannot be different level curves of a single function on a region containing that point, because the same input point would then have two different function values. Therefore a valid family of level curves must have the non-intersection property: different level values may not assign different outputs to the same input point.

![pasted 1780907663538](/math-2/assets/pasted-1780907663538.png)

For

$$
f(x,y)=x^2+y^2,
$$

the level curve at height $C$ is

$$
x^2+y^2=C.
$$

When $C>0$, this is a circle centred at the origin with radius $\sqrt C$. When $C=0$, it is only the single point $(0,0)$. The graph of $f$ is a circular paraboloid opening upward. As $C$ increases, the circles get larger. Thus the family of level curves records how the height changes as one moves away from the origin.

The same circular shapes can correspond to different surfaces if the labels are different. For example,

$$
g(x,y)=\sqrt{x^2+y^2}
$$

also has circular level curves, because

$$
\sqrt{x^2+y^2}=C
$$

is equivalent to

$$
x^2+y^2=C^2.
$$

But the graph of $g$ is a cone, not a paraboloid. This distinction prevents a common misunderstanding: the shapes of level curves alone do not fully determine the graph unless the level values and their spacing are known. The labels matter.

![pasted 1780907693055](/math-2/assets/pasted-1780907693055.png)

For the triangular plane example

$$
f(x,y)=3\left(1-\frac{x}{2}-\frac{y}{4}\right),
$$

a level curve satisfies

$$
3\left(1-\frac{x}{2}-\frac{y}{4}\right)=C.
$$

Solving for the line condition gives

$$
\frac{x}{2}+\frac{y}{4}=1-\frac{C}{3}.
$$

Thus the level curves are line segments inside the triangular domain. Because the graph is a plane, equally spaced output values produce equally spaced parallel level lines. This is the level-curve signature of constant steepness.

For the upper hemisphere

$$
f(x,y)=\sqrt{9-x^2-y^2},
$$

a level curve satisfies

$$
\sqrt{9-x^2-y^2}=C.
$$

Since the square root is non-negative, level values must satisfy $0\le C\le 3$. Squaring gives

$$
x^2+y^2=9-C^2.
$$

So the level curves are concentric circles. When $C=3$, the level curve is the centre point $(0,0)$, corresponding to the top of the hemisphere. When $C=0$, the level curve is the boundary circle $x^2+y^2=9$, corresponding to the equator of the sphere. If the level values $C$ are equally spaced, the circles bunch closer together near the boundary, reflecting the fact that the hemisphere becomes steeper near its edge.

![pasted 1780907718385](/math-2/assets/pasted-1780907718385.png)

Another important example is

$$
f(x,y)=x^2-y^2.
$$

The level curves are

$$
x^2-y^2=C.
$$

For $C=0$, this becomes

$$
x^2-y^2=0.
$$

Factoring gives

$$
(x-y)(x+y)=0,
$$

so the zero level set consists of the two lines

$$
y=x
\qquad\text{and}\qquad
y=-x.
$$

For positive and negative values of $C$, the level curves are hyperbolas with different orientations. The graph is a saddle-shaped surface called a hyperbolic paraboloid. At the origin, the surface rises in one direction and falls in another. At this point in the course, the important observation is visual: the level curves already reveal that the surface does not behave like a hilltop or a bowl.

Level curves can also reveal local peaks or valleys visually. If a point is surrounded by closed level curves whose labels increase as one moves inward, the point behaves like a peak. If the labels decrease as one moves inward, it behaves like a valley. This is only a visual description at this stage. The derivative-based classification of maxima, minima, and saddle points belongs to later sections. Here, the goal is simply to learn how constant-value curves encode the shape of the graph.

![pasted 1780907740903](/math-2/assets/pasted-1780907740903.png)

Level curves are also useful when the graph is described indirectly. Suppose $z=g(x,y)$ is defined by

$$
z\ge 0,\qquad x^2+(y-z)^2=2z^2.
$$

To find a level curve, set $z=C$, where $C\ge 0$. Substituting gives

$$
x^2+(y-C)^2=2C^2.
$$

This is a circle centred at $(0,C)$ with radius $\sqrt{2}\,C$. As $C$ changes, the level circles move and expand. From this family of level curves, one can recognize that the graph is an oblique cone. The main lesson is that level curves are not merely a drawing technique; they are a way of translating a three-dimensional surface into a two-dimensional family of equations.

For functions of three variables, the analogue of a level curve is a level surface. If

$$
f:\mathcal D\subseteq\mathbb R^3\to\mathbb R,
$$

then a level surface is given by

$$
f(x,y,z)=C.
$$

Now the input variables are $x$, $y$, and $z$, and the equation describes a surface in ordinary three-dimensional space. This is especially useful because the full graph of $w=f(x,y,z)$ would live in four-dimensional space, which cannot be drawn directly.

For example, if

$$
f(x,y,z)=x^2+y^2+z^2,
$$

then the level surfaces are

$$
x^2+y^2+z^2=C.
$$

For $C>0$, these are spheres centred at the origin with radius $\sqrt C$. Thus the function assigns to each point the square of its distance from the origin, and each level surface consists of points at the same distance from the origin. For $C=0$, the level surface collapses to the single point $(0,0,0)$. For $C<0$, there is no level surface, because $x^2+y^2+z^2$ cannot be negative.

![pasted 1780907781857](/math-2/assets/pasted-1780907781857.png)

If

$$
f(x,y,z)=x^2-z,
$$

then the level surface $f(x,y,z)=C$ is

$$
x^2-z=C.
$$

Solving for $z$ gives

$$
z=x^2-C.
$$

The variable $y$ does not appear. This means that once a point $(x,z)$ satisfies the equation in the $xz$-plane, the coordinate $y$ can be any real number. Therefore the level surfaces are parabolic cylinders extending parallel to the $y$-axis. This example reinforces the meaning of a missing variable: if a variable does not appear in the equation, the set extends freely in that variable’s direction.

Computer graphics can help visualize these objects, but they do not replace the mathematical description. A plotting program can draw a graph $z=f(x,y)$, contour curves $f(x,y)=C$, or implicit surfaces $f(x,y,z)=C$. However, the program still needs a domain, ranges for the variables, and enough information to decide which part of the object is being drawn. For course problems, the essential skill is not pressing the plotting command; it is knowing what the domain is, what the graph represents, and how level curves or level surfaces encode the same function.

The central idea of this section is that a function of several variables is a scalar-valued rule on a geometric domain. The domain tells us where the rule is valid. The graph turns a two-variable function into a surface by using the output as height. Level curves and level surfaces describe where the output is constant, often giving a clearer picture than the graph itself. Domain classification adds another layer: one must know whether boundary points are included, whether the domain is open or closed, whether it is one connected piece, and whether any points are isolated. These ideas form the language needed before asking how such functions change, because one must first understand where the function exists and how its values are arranged geometrically.
