---
title: "13.3 Partial Derivatives"
date: "2026-06-09T06:19:02.685Z"
source: "user-note"
knowledge_type: "user-note"
---

# 13.3 Partial Derivatives

In single-variable calculus, differentiation answers one basic question: if the input changes by a very small amount, how fast does the output change? For a function $y=f(x)$, there is only one independent input, so there is only one basic direction in which the input can change. In multivariable calculus, the situation is different. A scalar-valued function such as $z=f(x,y)$ depends on two independent inputs. The output may change because $x$ changes, because $y$ changes, or because both change at once.

The first step is to measure these changes separately. Instead of trying to understand every possible direction of change immediately, we begin with the simplest controlled experiment: change one coordinate while keeping the other coordinates fixed. This produces a partial derivative. The word “partial” means that only part of the input is allowed to vary.

This section comes after functions of several variables, domains, graphs, level curves, limits, and continuity. Those earlier ideas tell us what a scalar field is, where it is defined, and how it behaves near a point. Partial derivatives add local rate of change to that picture. They tell us how a surface rises or falls when we move in one coordinate direction at a time. This information is enough to construct tangent planes and normal lines to graphs of functions.

A function of two variables is a rule
$$
f:D\subseteq \mathbb{R}^2\to \mathbb{R}
$$
that assigns a real number $f(x,y)$ to each point $(x,y)$ in its domain $D$. If we write
$$
z=f(x,y),
$$
then $x$ and $y$ are independent input variables, and $z$ is the output. Geometrically, the graph of $f$ is the surface
$$
\{(x,y,z)\in \mathbb{R}^3:z=f(x,y)\}.
$$
If $f$ is a height function, then $f(x,y)$ is the height above the point $(x,y)$ in the $xy$-plane. If $f$ is a temperature function, then $f(x,y)$ is the temperature at the position $(x,y)$. In both interpretations, it is natural to ask how the output changes when we move in the $x$-direction or in the $y$-direction.

To isolate change in the $x$-direction, fix the value of $y$. Suppose we are interested in the point $(a,b)$. Keeping $y=b$ fixed means that we only look at points of the form $(x,b)$. Along this horizontal line in the domain, the two-variable function becomes an ordinary one-variable function:
$$
g(x)=f(x,b).
$$
The derivative of $g$ at $x=a$ is called the partial derivative of $f$ with respect to $x$ at $(a,b)$.

Formally,
$$
f_x(a,b)=\frac{\partial f}{\partial x}(a,b)
=\lim_{h\to 0}\frac{f(a+h,b)-f(a,b)}{h},
$$
provided this limit exists. Here $h$ is a small change in the $x$-coordinate, while $b$ is kept fixed. The numerator $f(a+h,b)-f(a,b)$ is the change in the output caused by moving from $(a,b)$ to $(a+h,b)$. Dividing by $h$ gives an average rate of change in the $x$-direction, and taking the limit gives the instantaneous rate of change in that direction.

To isolate change in the $y$-direction, fix $x=a$. The partial derivative of $f$ with respect to $y$ at $(a,b)$ is
$$
f_y(a,b)=\frac{\partial f}{\partial y}(a,b)
=\lim_{k\to 0}\frac{f(a,b+k)-f(a,b)}{k},
$$
provided this limit exists. Here $k$ is a small change in the $y$-coordinate, while $a$ is kept fixed. This derivative measures the instantaneous rate of change of the output when we move in the positive $y$-direction through $(a,b)$.

The practical rule is simple: when computing $\partial f/\partial x$, treat $y$ as a constant; when computing $\partial f/\partial y$, treat $x$ as a constant. This is not a new differentiation rule. It is the ordinary one-variable derivative applied to a slice of a multivariable function.

For example, let
$$
f(x,y)=x^2\sin y.
$$
To compute $f_x(x,y)$, treat $y$ as constant. Since $\sin y$ is then a constant multiplier,
$$
f_x(x,y)=2x\sin y.
$$
To compute $f_y(x,y)$, treat $x$ as constant. Since $x^2$ is then a constant multiplier,
$$
f_y(x,y)=x^2\cos y.
$$
These two derivatives answer different questions. The derivative $f_x$ describes how the output changes when $x$ changes and $y$ is fixed. The derivative $f_y$ describes how the output changes when $y$ changes and $x$ is fixed.

Several notations are used for partial derivatives. If $z=f(x,y)$, then the partial derivative with respect to $x$ may be written as
$$
\frac{\partial z}{\partial x},
\qquad
\frac{\partial f}{\partial x}(x,y),
\qquad
f_x(x,y),
\qquad
f_1(x,y),
\qquad
D_1f(x,y).
$$
The partial derivative with respect to $y$ may be written as
$$
\frac{\partial z}{\partial y},
\qquad
\frac{\partial f}{\partial y}(x,y),
\qquad
f_y(x,y),
\qquad
f_2(x,y),
\qquad
D_2f(x,y).
$$
The notation $f_1$ means “differentiate with respect to the first input variable,” and $f_2$ means “differentiate with respect to the second input variable.” These subscripts should not be confused with vector components. If $f$ is a scalar-valued function, then $f_1$ is not the first component of $f$; it is the derivative of $f$ with respect to its first input.

![pasted 1780986445522](/math-2/assets/pasted-1780986445522.png)

Geometrically, a partial derivative is the slope of a curve obtained by slicing the surface. Fixing $y=b$ cuts the surface $z=f(x,y)$ by the vertical plane $y=b$. The intersection is the curve
$$
z=f(x,b).
$$
At the point $(a,b,f(a,b))$, the slope of this curve is $f_x(a,b)$. Similarly, fixing $x=a$ cuts the surface by the vertical plane $x=a$. The intersection is the curve
$$
z=f(a,y),
$$
and its slope at $y=b$ is $f_y(a,b)$.

This interpretation explains the signs of partial derivatives. If $f_x(a,b)>0$, then the surface rises as we move in the positive $x$-direction while keeping $y=b$. If $f_x(a,b)<0$, then the surface falls in that direction. If $f_x(a,b)=0$, then the $x$-slice has a horizontal tangent at that point. The same interpretation applies to $f_y(a,b)$, but in the $y$-direction.

For a concrete computation, consider
$$
f(x,y)=x^2+xy+y^2.
$$
To compute $f_x$, treat $y$ as constant:
$$
f_x(x,y)=2x+y.
$$
The term $x^2$ differentiates to $2x$, the term $xy$ differentiates to $y$, and the term $y^2$ differentiates to $0$ because $y$ is fixed. To compute $f_y$, treat $x$ as constant:
$$
f_y(x,y)=x+2y.
$$
At $(2,3)$,
$$
f_x(2,3)=2(2)+3=7,
$$
and
$$
f_y(2,3)=2+2(3)=8.
$$
Thus, at $(2,3)$, the instantaneous rate of change in the $x$-direction is $7$, while the instantaneous rate of change in the $y$-direction is $8$.

Partial derivatives also apply to functions with more than two variables. If
$$
f=f(x_1,x_2,\ldots,x_d)
$$
is a function of $d$ independent variables, then the partial derivative with respect to $x_i$ is obtained by varying $x_i$ and holding all other variables fixed:
$$
\frac{\partial f}{\partial x_i}(x_1,\ldots,x_d)
=
\lim_{\Delta x_i\to 0}
\frac{
f(x_1,\ldots,x_i+\Delta x_i,\ldots,x_d)
-
f(x_1,\ldots,x_i,\ldots,x_d)
}{
\Delta x_i
},
$$
if this limit exists. Here $\Delta x_i$ is a small change in the $i$-th coordinate. Every other coordinate is kept fixed. The idea is exactly the same as in two variables, but there are more possible coordinates to choose from.

For example, let
$$
F(x,y,z)=\frac{2xy}{1+xz+yz}.
$$
To compute the partial derivative with respect to $z$, treat $x$ and $y$ as constants. The numerator $2xy$ is constant with respect to $z$, while the denominator $1+xz+yz$ changes with $z$. Since
$$
\frac{\partial}{\partial z}(1+xz+yz)=x+y,
$$
we get
$$
\frac{\partial F}{\partial z}
=
-\frac{2xy(x+y)}{(1+xz+yz)^2}.
$$
This derivative measures how $F$ changes if only the $z$-coordinate changes.

When a formula is valid near the point, partial derivatives can usually be computed using ordinary differentiation rules. But special care is needed for piecewise-defined functions, especially at a point where the formula changes. At such a point, one must use the limit definition directly. It is not valid to differentiate the formula used away from the point and then substitute the special point unless that formula also describes the function at and near the point in the required coordinate direction.

For example, define
$$
f(x,y)=
\begin{cases}
\dfrac{x^3-y^3}{x^2+y^2}, & (x,y)\neq (0,0),\\[6pt]
0, & (x,y)=(0,0).
\end{cases}
$$
To compute $f_x(0,0)$, use the definition:
$$
f_x(0,0)
=
\lim_{h\to 0}\frac{f(h,0)-f(0,0)}{h}.
$$
For $h\neq 0$,
$$
f(h,0)=\frac{h^3}{h^2}=h.
$$
Therefore,
$$
f_x(0,0)
=
\lim_{h\to 0}\frac{h-0}{h}
=1.
$$
Similarly,
$$
f_y(0,0)
=
\lim_{k\to 0}\frac{f(0,k)-f(0,0)}{k}.
$$
For $k\neq 0$,
$$
f(0,k)=\frac{-k^3}{k^2}=-k.
$$
Thus,
$$
f_y(0,0)
=
\lim_{k\to 0}\frac{-k-0}{k}
=-1.
$$
The important lesson is not the particular numbers $1$ and $-1$. The important lesson is the method: at a special point of a piecewise definition, compute the partial derivatives directly from the difference quotient.

There is another important warning. In one-variable calculus, differentiability at a point implies continuity at that point. In several variables, the existence of first partial derivatives at a point does not by itself guarantee continuity at that point. The reason is that partial derivatives only test movement along coordinate directions. For a function $f(x,y)$, $f_x(a,b)$ tests the line $y=b$, and $f_y(a,b)$ tests the line $x=a$. Continuity requires good behavior as $(x,y)$ approaches $(a,b)$ from every possible path, not only from the two coordinate directions.

This is why partial derivatives should not be confused with full differentiability. A partial derivative is a one-coordinate-at-a-time derivative. A stronger notion, developed later, asks whether the function has one good linear approximation that works for all small changes near the point. For the present section, the correct conclusion is more modest: partial derivatives measure coordinate-direction rates of change. They are essential, but they do not by themselves describe all possible local behavior of a multivariable function.

Partial derivatives are also the key to tangent planes. For a one-variable function $y=f(x)$, the derivative $f'(a)$ gives the slope of the tangent line:
$$
y=f(a)+f'(a)(x-a).
$$
For a two-variable function $z=f(x,y)$, the graph is a surface rather than a curve. The corresponding local linear object is a tangent plane. This plane should pass through the point on the surface and should match the two coordinate-direction slopes.

![pasted 1780986496971](/math-2/assets/pasted-1780986496971.png)

At the point
$$
P=(a,b,f(a,b)),
$$
there are two natural tangent direction vectors. If we move one unit in the $x$-direction, $x$ changes by $1$, $y$ does not change, and $z$ changes at rate $f_x(a,b)$. This gives the tangent vector
$$
T_1=(1,0,f_x(a,b)).
$$
If we move one unit in the $y$-direction, $x$ does not change, $y$ changes by $1$, and $z$ changes at rate $f_y(a,b)$. This gives the tangent vector
$$
T_2=(0,1,f_y(a,b)).
$$
The tangent plane is the plane through $P$ spanned by these two tangent directions.

A plane in three-dimensional space can be described using a normal vector. A normal vector is a nonzero vector perpendicular to the plane. A vector perpendicular to both $T_1$ and $T_2$ is
$$
n=(f_x(a,b),f_y(a,b),-1).
$$
This vector is normal to the tangent plane. Multiplying a normal vector by any nonzero constant gives another valid normal vector, so the sign and scaling of the normal vector are not unique. For example,
$$
(f_x(a,b),f_y(a,b),-1)
$$
and
$$
(-f_x(a,b),-f_y(a,b),1)
$$
describe the same normal direction.

Using the point $P=(a,b,f(a,b))$ and the normal vector
$$
n=(f_x(a,b),f_y(a,b),-1),
$$
the tangent plane is given by the point-normal equation
$$
f_x(a,b)(x-a)+f_y(a,b)(y-b)-\bigl(z-f(a,b)\bigr)=0.
$$
Here $x,y,z$ are the coordinates of a general point on the tangent plane. The numbers $a,b,f(a,b)$ describe the point of tangency. Solving for $z$ gives the equivalent form
$$
z=f(a,b)+f_x(a,b)(x-a)+f_y(a,b)(y-b).
$$
This formula says that near $(a,b)$, the surface is approximated by starting at the height $f(a,b)$, then adding the $x$-slope times the change $x-a$, and adding the $y$-slope times the change $y-b$. It is the two-variable analogue of the tangent line formula.

The normal line is the line through the point of tangency in the normal direction. Since the point is
$$
P=(a,b,f(a,b))
$$
and a normal vector is
$$
n=(f_x(a,b),f_y(a,b),-1),
$$
a vector description of the normal line is
$$
(x,y,z)=(a,b,f(a,b))+\rho(f_x(a,b),f_y(a,b),-1),
\qquad \rho\in\mathbb{R}.
$$
The parameter $\rho$ is a real number. As $\rho$ varies, the point $(x,y,z)$ moves along the line perpendicular to the tangent plane. This vector form is usually the cleanest way to write the normal line.

Consider the function
$$
f(x,y)=4-x^2+2xy-2y^2.
$$
We find the tangent plane and normal line to the graph at the point with $x=0$ and $y=1$. First compute the height:
$$
f(0,1)=4-0+0-2=2.
$$
So the point on the surface is
$$
P=(0,1,2).
$$
Next compute the partial derivatives. With respect to $x$, treat $y$ as constant:
$$
f_x(x,y)=-2x+2y.
$$
At $(0,1)$,
$$
f_x(0,1)=-2(0)+2(1)=2.
$$
With respect to $y$, treat $x$ as constant:
$$
f_y(x,y)=2x-4y.
$$
At $(0,1)$,
$$
f_y(0,1)=2(0)-4(1)=-4.
$$
The tangent plane is therefore
$$
z=2+2(x-0)-4(y-1).
$$
Simplifying,
$$
z=2x-4y+6.
$$
A normal vector is
$$
n=(2,-4,-1),
$$
and the normal line is
$$
(x,y,z)=(0,1,2)+\rho(2,-4,-1),
\qquad \rho\in\mathbb{R}.
$$

A horizontal tangent plane occurs when the tangent plane is parallel to the $xy$-plane. A plane parallel to the $xy$-plane has no $x$-slope and no $y$-slope. Therefore, for the graph $z=f(x,y)$, the tangent plane is horizontal at $(a,b)$ exactly when
$$
f_x(a,b)=0
\qquad\text{and}\qquad
f_y(a,b)=0.
$$
For
$$
f(x,y)=4-x^2+2xy-2y^2,
$$
we found
$$
f_x(x,y)=-2x+2y,
\qquad
f_y(x,y)=2x-4y.
$$
Setting both equal to zero gives
$$
-2x+2y=0,
\qquad
2x-4y=0.
$$
The first equation gives $y=x$. Substituting into the second gives
$$
2x-4x=-2x=0,
$$
so $x=0$, and therefore $y=0$. Thus the tangent plane is horizontal at $(0,0)$. The corresponding point on the graph is
$$
(0,0,f(0,0))=(0,0,4).
$$
At this point, both coordinate slices have horizontal tangents. Later, such points are important when studying local maxima, local minima, and saddle points. In the present section, the immediate meaning is simply that both coordinate-direction slopes vanish.

The normal line also gives a geometric way to understand shortest distance from a point to a smooth surface. If a point $Q$ outside a smooth surface is closest to a point $P$ on the surface, then the segment from $P$ to $Q$ must be perpendicular to the tangent plane at $P$. Otherwise, one could move slightly along the surface and get closer. Therefore, at a closest point, the point $Q$ lies on the normal line through $P$.

![pasted 1780986701851](/math-2/assets/pasted-1780986701851.png)

For example, find the distance from
$$
Q=(1,1,0)
$$
to the surface
$$
z=x^2+y^2.
$$
A general point on the surface has the form
$$
P=(x_0,y_0,x_0^2+y_0^2).
$$
For the function
$$
f(x,y)=x^2+y^2,
$$
the partial derivatives are
$$
f_x(x,y)=2x,
\qquad
f_y(x,y)=2y.
$$
Thus a normal vector at $P$ is
$$
n=(2x_0,2y_0,-1).
$$
If $P$ is the closest point, then $Q$ must lie on the normal line through $P$. Therefore, for some real number $\rho$,
$$
(1,1,0)
=
(x_0,y_0,x_0^2+y_0^2)
+
\rho(2x_0,2y_0,-1).
$$
This gives the system
$$
1=x_0+2\rho x_0,
$$
$$
1=y_0+2\rho y_0,
$$
$$
0=x_0^2+y_0^2-\rho.
$$
The first two equations are symmetric, so the closest point should have $x_0=y_0$. Let
$$
x_0=y_0=s.
$$
Then
$$
\rho=x_0^2+y_0^2=2s^2,
$$
and
$$
1=s+2\rho s=s+4s^3.
$$
So
$$
4s^3+s-1=0.
$$
The value
$$
s=\frac12
$$
satisfies this equation, because
$$
4\left(\frac12\right)^3+\frac12-1
=
\frac12+\frac12-1=0.
$$
Thus the closest point is
$$
P=\left(\frac12,\frac12,\frac12\right).
$$
The distance from $Q$ to the surface is therefore
$$
|Q-P|
=
\sqrt{
\left(1-\frac12\right)^2+
\left(1-\frac12\right)^2+
\left(0-\frac12\right)^2
}
=
\sqrt{\frac14+\frac14+\frac14}
=
\frac{\sqrt3}{2}.
$$
The computation works because the shortest segment from the point to the surface is normal to the surface.

It is important to distinguish tangent planes to graphs from tangent planes to level surfaces. In this section, the main formula
$$
z=f(a,b)+f_x(a,b)(x-a)+f_y(a,b)(y-b)
$$
belongs to the graph of a function $z=f(x,y)$. The surface is written with $z$ isolated as the output.

A level surface has a different form:
$$
F(x,y,z)=C.
$$
Here $x$, $y$, and $z$ are all input variables of a scalar field $F$, and the surface consists of points where the output $F(x,y,z)$ has the fixed value $C$. A graph $z=f(x,y)$ can be rewritten as a level surface by defining
$$
F(x,y,z)=f(x,y)-z.
$$
Then the graph is the zero level surface
$$
F(x,y,z)=0.
$$
This explains why the normal vector for a graph has the form
$$
(f_x(a,b),f_y(a,b),-1).
$$
It is the collection of the partial derivatives of $f(x,y)-z$ with respect to $x$, $y$, and $z$. The general level-surface method belongs with gradients, but this connection helps prevent confusion: the graph formula is a special case, not a different kind of geometry.

Partial derivatives are the first local measurement tool for scalar fields. They measure how a multivariable function changes when one coordinate changes and all other coordinates are held fixed. Geometrically, they are slopes of coordinate slices of a surface. Algebraically, they are computed by ordinary differentiation while temporarily treating the other variables as constants. At ordinary points, the usual differentiation rules apply; at special points of piecewise definitions, the limit definition must be used directly. Together, $f_x(a,b)$ and $f_y(a,b)$ determine the tangent plane to the graph $z=f(x,y)$, the normal vector $(f_x(a,b),f_y(a,b),-1)$, and the normal line through the point of tangency. These ideas provide the local geometric foundation for the next stages of multivariable differentiation.
