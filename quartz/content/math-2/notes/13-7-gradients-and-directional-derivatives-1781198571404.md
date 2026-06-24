---
title: "13.7 Gradients and Directional Derivatives"
date: "2026-06-11T17:22:51.404Z"
source: "user-note"
knowledge_type: "user-note"
---

# 13.7 Gradients and Directional Derivatives

Partial derivatives answer a useful but incomplete question. If $f(x,y)$ is a function of two variables, then $f_x(a,b)$ tells us how $f$ changes at $(a,b)$ when we move only in the positive $x$-direction, and $f_y(a,b)$ tells us how $f$ changes when we move only in the positive $y$-direction. These are coordinate-direction rates of change. In many problems, however, the relevant motion is not parallel to a coordinate axis. A hiker on a map may walk northeast, an insect may move through a temperature field in an arbitrary direction, and a particle may move through a physical potential along a curve. The immediate problem in this section is therefore: given a scalar quantity that varies from point to point, how do we measure its rate of change in any chosen direction?

This section appears after partial derivatives, the chain rule, and linear approximation because those ideas now combine into one geometric object. Partial derivatives give the separate coordinate rates. The chain rule explains how a function changes along a path. Linear approximation shows that, near a differentiable point, the first-order change of a function is controlled by its first partial derivatives. The gradient packages all of this first-order information into a vector. Directional derivatives then use that vector to measure change in a specified direction.

A scalar field is a function that assigns one number to each point in a domain. For example, $T(x,y,z)$ may represent temperature at the point $(x,y,z)$, $h(x,y)$ may represent height on a map, and $V(x,y,z)$ may represent electric potential. A vector field assigns a vector to each point. The gradient takes a scalar field and produces a vector field: at each point, it gives a vector describing the local direction and size of the fastest first-order increase of the scalar field.

For a differentiable function $f(x,y)$, the gradient of $f$ is defined by

$$
\nabla f(x,y)=\operatorname{grad}f(x,y)=f_x(x,y)\mathbf{i}+f_y(x,y)\mathbf{j}.
$$

Here $f_x(x,y)$ is the partial derivative of $f$ with respect to $x$, $f_y(x,y)$ is the partial derivative of $f$ with respect to $y$, and $\mathbf{i}$ and $\mathbf{j}$ are the unit vectors in the positive $x$- and $y$-directions. The symbol $\nabla$, read as “del” or “nabla,” is used as a differential operator. In two dimensions it is formally written as

$$
\nabla=\mathbf{i}\frac{\partial}{\partial x}+\mathbf{j}\frac{\partial}{\partial y}.
$$

This notation does not mean that $\nabla$ is an ordinary vector of numbers. It means that when $\nabla$ acts on a scalar function $f$, the result is the vector made from the first partial derivatives of $f$:

$$
\nabla f=\left(\mathbf{i}\frac{\partial}{\partial x}+\mathbf{j}\frac{\partial}{\partial y}\right)f=\frac{\partial f}{\partial x}\mathbf{i}+\frac{\partial f}{\partial y}\mathbf{j}.
$$

Thus the gradient is not one more partial derivative. It is a vector that stores the first-order change of $f$ in all coordinate directions at once.

![pasted 1781198997148](/math-2/assets/pasted-1781198997148.png)

Consider the function

$$
f(x,y)=x^2+y^2.
$$

The partial derivatives are

$$
f_x(x,y)=2x,\qquad f_y(x,y)=2y.
$$

Therefore

$$
\nabla f(x,y)=2x\mathbf{i}+2y\mathbf{j}.
$$

At the point $(1,2)$,

$$
\nabla f(1,2)=2\mathbf{i}+4\mathbf{j}.
$$

The level curve of $f$ through $(1,2)$ is found by keeping the value of $f$ constant. Since

$$
f(1,2)=1^2+2^2=5,
$$

the level curve is

$$
x^2+y^2=5.
$$

A level curve is a curve in the input plane along which the function value stays constant. This is different from the graph $z=f(x,y)$, which lives in three-dimensional space. For $f(x,y)=x^2+y^2$, the graph is a paraboloid, while the level curves are circles in the $xy$-plane.

At $(1,2)$, the tangent line to the level curve $x^2+y^2=5$ has equation

$$
x+2y=5.
$$

The vector $2\mathbf{i}+4\mathbf{j}$ is perpendicular to this tangent line. Therefore the gradient at $(1,2)$ is normal to the level curve. A normal vector is a vector perpendicular to the tangent direction. This perpendicularity has a simple meaning: if we move along a level curve, the value of $f$ does not change, so the direction of change represented by the gradient must be perpendicular to the direction of motion along the level curve.

The general statement is as follows. If $f(x,y)$ is differentiable at $(a,b)$ and

$$
\nabla f(a,b)\neq \mathbf{0},
$$

then $\nabla f(a,b)$ is normal to the level curve of $f$ passing through $(a,b)$. Here $\mathbf{0}$ denotes the zero vector. The condition $\nabla f(a,b)\neq \mathbf{0}$ matters because the zero vector has no direction and cannot determine a unique normal line.

The reason for the theorem comes directly from the chain rule. Suppose a level curve is parametrized by

$$
\mathbf{r}(t)=x(t)\mathbf{i}+y(t)\mathbf{j},
$$

where $t$ is a parameter and $\mathbf{r}(0)=(a,b)$. Since this is a level curve, the value of $f$ remains constant along it:

$$
f(x(t),y(t))=f(a,b).
$$

Differentiating both sides with respect to $t$ gives

$$
f_x(x(t),y(t))x'(t)+f_y(x(t),y(t))y'(t)=0.
$$

At $t=0$, this becomes

$$
\nabla f(a,b)\cdot \mathbf{r}'(0)=0.
$$

Here $\mathbf{r}'(0)=x'(0)\mathbf{i}+y'(0)\mathbf{j}$ is a tangent vector to the level curve at $(a,b)$, and the dot product being zero means the vectors are perpendicular. Therefore the gradient is perpendicular to the level curve.

This also explains why the gradient naturally appears after the chain rule. The chain rule says that when a multivariable function is evaluated along a path, the rate of change along that path is obtained by taking the dot product of the gradient with the path velocity. The gradient is therefore the object that converts a direction of motion into a rate of change of the scalar field.

We now define the directional derivative. Let

$$
\mathbf{u}=u_1\mathbf{i}+u_2\mathbf{j}
$$

be a unit vector, meaning that

$$
|\mathbf{u}|=\sqrt{u_1^2+u_2^2}=1.
$$

The directional derivative of $f$ at $(a,b)$ in the direction $\mathbf{u}$ is the rate of change of $f$ per unit distance when we move from $(a,b)$ in the direction $\mathbf{u}$. It is defined by

$$
D_{\mathbf{u}}f(a,b)=\lim_{h\to 0}\frac{f(a+hu_1,b+hu_2)-f(a,b)}{h},
$$

provided this limit exists. Here $h$ is the signed distance moved along the direction $\mathbf{u}$. It is a distance because $\mathbf{u}$ has length $1$.

This unit-vector condition is essential. If a problem gives a direction vector

$$
\mathbf{w}=w_1\mathbf{i}+w_2\mathbf{j},\qquad \mathbf{w}\neq \mathbf{0},
$$

then the corresponding unit direction vector is

$$
\mathbf{u}=\frac{\mathbf{w}}{|\mathbf{w}|}.
$$

Here

$$
|\mathbf{w}|=\sqrt{w_1^2+w_2^2}.
$$

The vector $\mathbf{w}$ tells us the direction, but it may also include an arbitrary length. The directional derivative asks for rate of change per unit distance, so we must remove that arbitrary length. For example, the direction $\mathbf{i}-\mathbf{j}$ corresponds to the unit vector

$$
\frac{\mathbf{i}-\mathbf{j}}{\sqrt{2}},
$$

not to $\mathbf{i}-\mathbf{j}$ itself. Forgetting this normalization changes the answer by a factor of $\sqrt{2}$.

![pasted 1781199013860](/math-2/assets/pasted-1781199013860.png)

The directional derivative is an ordinary derivative along a line. Define a one-variable function

$$
g(t)=f(a+tu_1,b+tu_2).
$$

Here $t$ measures signed distance along the line through $(a,b)$ in the direction $\mathbf{u}$, and $g(t)$ is the value of $f$ along that line. Then

$$
D_{\mathbf{u}}f(a,b)=g'(0).
$$

Using the chain rule,

$$
g'(0)=f_x(a,b)u_1+f_y(a,b)u_2.
$$

This can be written as the dot product

$$
D_{\mathbf{u}}f(a,b)=\nabla f(a,b)\cdot \mathbf{u}.
$$

This is the main computational formula for directional derivatives. The gradient gives the local first-order change of the function, and the unit vector selects the direction in which that change is measured.

Partial derivatives are special directional derivatives. If $\mathbf{u}=\mathbf{i}$, then

$$
D_{\mathbf{i}}f(a,b)=\nabla f(a,b)\cdot \mathbf{i}=f_x(a,b).
$$

If $\mathbf{u}=\mathbf{j}$, then

$$
D_{\mathbf{j}}f(a,b)=\nabla f(a,b)\cdot \mathbf{j}=f_y(a,b).
$$

Thus $f_x$ and $f_y$ measure rates of change in the coordinate directions, while $D_{\mathbf{u}}f$ measures rate of change in any chosen unit direction.

As an example, let

$$
f(x,y)=y^4+2xy^3+x^2y^2.
$$

We want rates of change at $(0,1)$ in several directions. First compute the gradient:

$$
f_x(x,y)=2y^3+2xy^2,
$$

$$
f_y(x,y)=4y^3+6xy^2+2x^2y.
$$

Therefore

$$
\nabla f(x,y)=\left(2y^3+2xy^2\right)\mathbf{i}+\left(4y^3+6xy^2+2x^2y\right)\mathbf{j}.
$$

At $(0,1)$,

$$
\nabla f(0,1)=2\mathbf{i}+4\mathbf{j}.
$$

In the direction $\mathbf{i}+2\mathbf{j}$, the corresponding unit vector is

$$
\mathbf{u}=\frac{\mathbf{i}+2\mathbf{j}}{\sqrt{5}},
$$

because

$$
|\mathbf{i}+2\mathbf{j}|=\sqrt{1^2+2^2}=\sqrt{5}.
$$

Thus

$$
D_{\mathbf{u}}f(0,1)=(2\mathbf{i}+4\mathbf{j})\cdot \frac{\mathbf{i}+2\mathbf{j}}{\sqrt{5}}=\frac{2+8}{\sqrt{5}}=2\sqrt{5}.
$$

This is positive because the chosen direction points in the same general direction as the gradient.

In the direction $\mathbf{j}-2\mathbf{i}$, the unit vector is

$$
\mathbf{u}=\frac{-2\mathbf{i}+\mathbf{j}}{\sqrt{5}}.
$$

Then

$$
D_{\mathbf{u}}f(0,1)=(2\mathbf{i}+4\mathbf{j})\cdot \frac{-2\mathbf{i}+\mathbf{j}}{\sqrt{5}}=\frac{-4+4}{\sqrt{5}}=0.
$$

The derivative is zero because $\mathbf{j}-2\mathbf{i}$ is perpendicular to the gradient. Geometrically, this means the direction is tangent to the level curve through $(0,1)$, so moving in that direction produces no first-order change in $f$.

In the direction $3\mathbf{i}$, the direction is simply $\mathbf{i}$, because $3\mathbf{i}$ points in the same direction as $\mathbf{i}$. Therefore

$$
D_{\mathbf{i}}f(0,1)=2.
$$

In the direction $\mathbf{i}+\mathbf{j}$, the unit vector is

$$
\mathbf{u}=\frac{\mathbf{i}+\mathbf{j}}{\sqrt{2}}.
$$

Thus

$$
D_{\mathbf{u}}f(0,1)=(2\mathbf{i}+4\mathbf{j})\cdot \frac{\mathbf{i}+\mathbf{j}}{\sqrt{2}}=\frac{6}{\sqrt{2}}=3\sqrt{2}.
$$

The complete procedure is always the same: compute the gradient, normalize the direction vector, and take the dot product.

A direction in the plane is often described by an angle. If $\varphi$ is the angle measured counterclockwise from the positive $x$-axis, then the unit vector in that direction is

$$
\mathbf{u}_{\varphi}=\cos\varphi\,\mathbf{i}+\sin\varphi\,\mathbf{j}.
$$

Here $\cos\varphi$ is the $x$-component of the unit vector and $\sin\varphi$ is the $y$-component. The directional derivative in this direction is

$$
D_{\varphi}f(x,y)=D_{\mathbf{u}_{\varphi}}f(x,y)=\nabla f(x,y)\cdot \mathbf{u}_{\varphi}.
$$

Substituting the components gives

$$
D_{\varphi}f(x,y)=f_x(x,y)\cos\varphi+f_y(x,y)\sin\varphi.
$$

This formula is useful when a direction is given by an angle instead of by a vector.

![pasted 1781199031050](/math-2/assets/pasted-1781199031050.png)

The same line-based idea can be used to define a second directional derivative. The first directional derivative measures the slope of $f$ along a chosen line. The second directional derivative measures how that slope changes as we continue along the same line. It is the analogue of the ordinary second derivative from one-variable calculus, but taken in a specified direction.

Assume $f(x,y)$ has continuous second partial derivatives. The second directional derivative of $f$ in the direction making angle $\varphi$ with the positive $x$-axis is

$$
D_{\varphi}^{2}f(x,y)=D_{\varphi}\bigl(D_{\varphi}f(x,y)\bigr).
$$

Since

$$
D_{\varphi}f(x,y)=f_x(x,y)\cos\varphi+f_y(x,y)\sin\varphi,
$$

we differentiate once more in the same direction. This gives

$$
D_{\varphi}^{2}f(x,y)=f_{xx}(x,y)\cos^2\varphi+2f_{xy}(x,y)\cos\varphi\sin\varphi+f_{yy}(x,y)\sin^2\varphi.
$$

Here $f_{xx}$ is the second partial derivative with respect to $x$ twice, $f_{yy}$ is the second partial derivative with respect to $y$ twice, and $f_{xy}$ is the mixed partial derivative obtained by differentiating first with respect to $x$ and then with respect to $y$. When the second partial derivatives are continuous near the point, $f_{xy}=f_{yx}$, so the two mixed terms combine into the single coefficient $2f_{xy}\cos\varphi\sin\varphi$.

This formula should be interpreted as concavity along a line. If $D_{\varphi}^{2}f(a,b)>0$, then the slice of the graph in that direction is curving upward at $(a,b)$. If $D_{\varphi}^{2}f(a,b)<0$, then it is curving downward in that direction. This is not the same as saying the entire surface is concave up or down; the concavity can depend on direction.

The dot product formula also explains why the gradient points in the direction of fastest increase. Let $\theta$ be the angle between the unit direction vector $\mathbf{u}$ and the gradient $\nabla f(a,b)$. Since

$$
D_{\mathbf{u}}f(a,b)=\nabla f(a,b)\cdot \mathbf{u},
$$

the geometric formula for the dot product gives

$$
D_{\mathbf{u}}f(a,b)=|\nabla f(a,b)|\,|\mathbf{u}|\cos\theta.
$$

Because $\mathbf{u}$ is a unit vector, $|\mathbf{u}|=1$, so

$$
D_{\mathbf{u}}f(a,b)=|\nabla f(a,b)|\cos\theta.
$$

Here $|\nabla f(a,b)|$ is the length of the gradient vector. Since $\cos\theta$ is largest when $\theta=0$, the directional derivative is largest when $\mathbf{u}$ points in the same direction as $\nabla f(a,b)$. Therefore $f$ increases most rapidly in the direction of the gradient, and the maximum rate of increase is

$$
|\nabla f(a,b)|.
$$

The function decreases most rapidly in the opposite direction,

$$
-\nabla f(a,b),
$$

and the maximum rate of decrease has magnitude

$$
|\nabla f(a,b)|.
$$

If $\mathbf{u}$ is perpendicular to the gradient, then $\theta=\pi/2$, so $\cos\theta=0$, and

$$
D_{\mathbf{u}}f(a,b)=0.
$$

This is exactly the situation along a level curve. Moving tangent to a level curve produces no first-order change in the function value.

If

$$
\nabla f(a,b)=\mathbf{0},
$$

then the first-order information does not select a direction of fastest increase. For a differentiable function, all directional derivatives at that point are zero, because

$$
D_{\mathbf{u}}f(a,b)=\mathbf{0}\cdot \mathbf{u}=0.
$$

This does not mean the function is locally constant. It means that the linear, first-order part of the change vanishes at that point. To understand the behavior near such a point, one usually needs higher-order information.

A temperature example shows how the signs should be interpreted. Let

$$
T(x,y)=x^2-2y^2.
$$

Here $T(x,y)$ is temperature at the point $(x,y)$. The gradient is

$$
\nabla T(x,y)=2x\mathbf{i}-4y\mathbf{j}.
$$

At $(2,1)$,

$$
\nabla T(2,1)=4\mathbf{i}-4\mathbf{j}.
$$

The direction of fastest temperature increase is therefore

$$
4\mathbf{i}-4\mathbf{j},
$$

or, as a unit vector,

$$
\frac{\mathbf{i}-\mathbf{j}}{\sqrt{2}}.
$$

The direction of fastest cooling is the opposite direction,

$$
-4\mathbf{i}+4\mathbf{j},
$$

or, as a unit vector,

$$
\frac{-\mathbf{i}+\mathbf{j}}{\sqrt{2}}.
$$

The maximum rate of temperature increase per unit distance is

$$
|\nabla T(2,1)|=\sqrt{4^2+(-4)^2}=4\sqrt{2}.
$$

Therefore, if an object moves in the fastest-cooling direction at speed $k$, where $k$ is measured in units of distance per unit time, then the temperature decreases at rate

$$
4\sqrt{2}\,k.
$$

If instead the object moves with speed $k$ in the direction $\mathbf{i}-2\mathbf{j}$, the unit direction is

$$
\mathbf{u}=\frac{\mathbf{i}-2\mathbf{j}}{\sqrt{5}}.
$$

The rate of temperature change per unit time is

$$
k\,\nabla T(2,1)\cdot \mathbf{u}=k(4\mathbf{i}-4\mathbf{j})\cdot \frac{\mathbf{i}-2\mathbf{j}}{\sqrt{5}}=\frac{12k}{\sqrt{5}}.
$$

This is positive, so the object is warming, not cooling. If the question is phrased as a “rate of decrease,” then the answer would be

$$
-\frac{12k}{\sqrt{5}},
$$

because the temperature is not decreasing in that direction. This is a common sign issue: $\nabla f$ gives fastest increase, while $-\nabla f$ gives fastest decrease.

![pasted 1781199061559](/math-2/assets/pasted-1781199061559.png)

The mountain example gives a geometric interpretation with units. Let

$$
h(x,y)=\frac{20000}{3+x^2+2y^2},
$$

where $h(x,y)$ is height in metres and $(x,y)$ are map coordinates measured in kilometres. The hiker is at $(3,2)$. The gradient is

$$
\nabla h(x,y)=-\frac{20000}{(3+x^2+2y^2)^2}(2x\mathbf{i}+4y\mathbf{j}).
$$

At $(3,2)$, the denominator is

$$
3+3^2+2(2^2)=20,
$$

so

$$
\nabla h(3,2)=-\frac{20000}{20^2}(6\mathbf{i}+8\mathbf{j})=-100(3\mathbf{i}+4\mathbf{j}).
$$

The gradient points uphill, toward fastest increase of height. The stream flows downhill, so its direction is the negative gradient:

$$
-\nabla h(3,2)=100(3\mathbf{i}+4\mathbf{j}).
$$

Thus the downstream direction has the same direction as

$$
3\mathbf{i}+4\mathbf{j}.
$$

The steepest uphill rate is the length of the gradient:

$$
|\nabla h(3,2)|=|-100(3\mathbf{i}+4\mathbf{j})|=100\sqrt{3^2+4^2}=500.
$$

Because height is measured in metres and horizontal distance is measured in kilometres, this means $500$ metres of vertical change per kilometre of horizontal distance. The steepest downhill rate has the same magnitude, but in the opposite direction.

The path of the stream can also be found from the gradient. Along the stream, the tangent direction is parallel to the negative gradient. A small displacement along the stream can be written as

$$
d\mathbf{r}=dx\,\mathbf{i}+dy\,\mathbf{j}.
$$

Since the downhill direction is parallel to

$$
2x\mathbf{i}+4y\mathbf{j},
$$

the components must be proportional:

$$
\frac{dx}{2x}=\frac{dy}{4y}.
$$

This is equivalent to

$$
\frac{dy}{y}=2\frac{dx}{x}.
$$

Integrating both sides gives

$$
\ln y=2\ln x+\ln C,
$$

so

$$
y=Cx^2.
$$

The stream passes through $(3,2)$, so

$$
2=C(3^2)=9C,
$$

and therefore

$$
C=\frac{2}{9}.
$$

Thus the stream path on the map satisfies

$$
9y=2x^2.
$$

This example shows why level curves and gradient directions are complementary. Level curves describe where the height stays constant. The gradient and negative gradient describe how to move most rapidly between different height levels.

The same idea explains curves that intersect level curves perpendicularly. Suppose we want the curve through $(1,1)$ that intersects the level curves of

$$
f(x,y)=x^3+y^2
$$

at right angles. Since the gradient is perpendicular to the level curves, the desired curve must have tangent direction parallel to

$$
\nabla f(x,y)=3x^2\mathbf{i}+2y\mathbf{j}.
$$

If the desired curve is written as $y=y(x)$, then its slope satisfies

$$
\frac{dy}{dx}=\frac{2y}{3x^2}.
$$

Separating variables gives

$$
\frac{1}{y}\,dy=\frac{2}{3x^2}\,dx.
$$

Integrating,

$$
\ln y=-\frac{2}{3x}+C.
$$

The curve passes through $(1,1)$, so

$$
0=-\frac{2}{3}+C,
$$

and therefore

$$
C=\frac{2}{3}.
$$

Thus

$$
\ln y=\frac{2}{3}-\frac{2}{3x},
$$

and hence

$$
y=e^{\frac{2}{3}-\frac{2}{3x}}.
$$

This curve is not a level curve of $f$. It is a curve whose tangent direction follows the gradient direction, so it crosses the level curves orthogonally.

Directional derivatives can be interpreted in two different units, and these must not be confused. If $\mathbf{u}$ is a unit vector, then

$$
D_{\mathbf{u}}f(a,b)=\nabla f(a,b)\cdot \mathbf{u}
$$

is a rate of change per unit distance. If an observer moves with velocity

$$
\mathbf{v}=v_1\mathbf{i}+v_2\mathbf{j},
$$

then $\mathbf{v}$ is usually not a unit vector. Its length $|\mathbf{v}|$ is speed, measured in distance per unit time. The direction of motion is

$$
\frac{\mathbf{v}}{|\mathbf{v}|}.
$$

The rate of change per unit distance in that direction is

$$
D_{\mathbf{v}/|\mathbf{v}|}f(a,b)=\nabla f(a,b)\cdot \frac{\mathbf{v}}{|\mathbf{v}|}.
$$

To convert this to rate of change per unit time, multiply by the speed $|\mathbf{v}|$. This gives

$$
|\mathbf{v}|\left(\nabla f(a,b)\cdot \frac{\mathbf{v}}{|\mathbf{v}|}\right)=\nabla f(a,b)\cdot \mathbf{v}.
$$

Thus the rate of change perceived by an observer moving through $(a,b)$ with velocity $\mathbf{v}$ is

$$
\frac{d}{dt}f(\mathbf{r}(t))=\nabla f(a,b)\cdot \mathbf{v}.
$$

Here $\mathbf{v}$ includes both direction and speed, so the result is a rate per unit time. This is different from $D_{\mathbf{u}}f$, which uses a unit vector and gives a rate per unit distance.

If the scalar field itself also depends explicitly on time, such as a temperature field

$$
T(x,y,z,t),
$$

then a moving observer sees two kinds of change. One part comes from moving through space, and the other part comes from the temperature changing with time at a fixed point. If the observer has velocity $\mathbf{v}$, then

$$
\frac{dT}{dt}=\mathbf{v}\cdot \nabla T+\frac{\partial T}{\partial t}.
$$

Here $\nabla T$ is the spatial gradient, meaning the gradient with respect to $x,y,z$ only; $\mathbf{v}\cdot\nabla T$ is the change caused by the observer’s motion through space; and $\frac{\partial T}{\partial t}$ is the local time change of the temperature at a fixed point.

The gradient extends directly to three dimensions. For a scalar field $f(x,y,z)$,

$$
\nabla f(x,y,z)=f_x(x,y,z)\mathbf{i}+f_y(x,y,z)\mathbf{j}+f_z(x,y,z)\mathbf{k}.
$$

Here $f_x$, $f_y$, and $f_z$ are the first partial derivatives with respect to $x$, $y$, and $z$, and $\mathbf{i},\mathbf{j},\mathbf{k}$ are the Cartesian unit vectors. In $n$ dimensions, for a function

$$
f(x_1,x_2,\ldots,x_n),
$$

the gradient is

$$
\nabla f(x_1,x_2,\ldots,x_n)=\frac{\partial f}{\partial x_1}\mathbf{e}_1+\frac{\partial f}{\partial x_2}\mathbf{e}_2+\cdots+\frac{\partial f}{\partial x_n}\mathbf{e}_n.
$$

Here $\mathbf{e}_j$ is the unit vector in the $x_j$-direction. The meaning is unchanged: the gradient collects all first partial derivatives into one vector.

In three dimensions, the analogue of a level curve is a level surface. A level surface of $f(x,y,z)$ is a surface on which

$$
f(x,y,z)=C,
$$

where $C$ is constant. If

$$
P_0=(a,b,c),
$$

then the level surface passing through $P_0$ is

$$
f(x,y,z)=f(a,b,c).
$$

If $f$ is differentiable at $P_0$ and

$$
\nabla f(P_0)\neq \mathbf{0},
$$

then $\nabla f(P_0)$ is normal to this level surface. Therefore the tangent plane to the level surface at $P_0$ has equation

$$
\nabla f(P_0)\cdot\bigl((x,y,z)-P_0\bigr)=0.
$$

In this formula, $(x,y,z)$ is a variable point on the tangent plane, $P_0=(a,b,c)$ is the point of tangency, and $\nabla f(P_0)$ is the normal vector to the plane.

![pasted 1781199082083](/math-2/assets/pasted-1781199082083.png)

For example, let

$$
f(x,y,z)=x^2+y^2+z^2.
$$

Then

$$
\nabla f(x,y,z)=2x\mathbf{i}+2y\mathbf{j}+2z\mathbf{k}.
$$

At

$$
P_0=(1,-1,2),
$$

we get

$$
\nabla f(1,-1,2)=2\mathbf{i}-2\mathbf{j}+4\mathbf{k}.
$$

The level surface through $P_0$ is

$$
x^2+y^2+z^2=1^2+(-1)^2+2^2=6.
$$

This is the sphere of radius $\sqrt{6}$. The tangent plane at $(1,-1,2)$ has normal vector $2\mathbf{i}-2\mathbf{j}+4\mathbf{k}$, so

$$
2(x-1)-2(y+1)+4(z-2)=0.
$$

Simplifying gives

$$
x-y+2z=6.
$$

The maximum rate of increase of $f$ at $(1,-1,2)$ is the length of the gradient:

$$
|\nabla f(1,-1,2)|=\sqrt{2^2+(-2)^2+4^2}=2\sqrt{6}.
$$

If we want the rate of change of $f$ at $(1,-1,2)$ in the direction from this point toward $(3,1,1)$, first find the direction vector:

$$
\mathbf{w}=(3,1,1)-(1,-1,2)=(2,2,-1).
$$

Its length is

$$
|\mathbf{w}|=\sqrt{2^2+2^2+(-1)^2}=3.
$$

Therefore the unit direction vector is

$$
\mathbf{u}=\frac{1}{3}(2\mathbf{i}+2\mathbf{j}-\mathbf{k}).
$$

The directional derivative is

$$
D_{\mathbf{u}}f(1,-1,2)=(2\mathbf{i}-2\mathbf{j}+4\mathbf{k})\cdot\frac{1}{3}(2\mathbf{i}+2\mathbf{j}-\mathbf{k}).
$$

Thus

$$
D_{\mathbf{u}}f(1,-1,2)=\frac{4-4-4}{3}=-\frac{4}{3}.
$$

The negative sign means that, in that direction, $f$ is decreasing at that point.

Gradients are also useful for curves formed by the intersection of two surfaces. Suppose a curve is the intersection of

$$
F(x,y,z)=0
$$

and

$$
G(x,y,z)=0.
$$

At a point $P$ on the curve, $\nabla F(P)$ is normal to the first surface and $\nabla G(P)$ is normal to the second surface. A tangent vector to the intersection curve must be perpendicular to both of these normal vectors. Therefore one possible tangent vector is

$$
\mathbf{T}=\nabla F(P)\times \nabla G(P).
$$

Here $\times$ denotes the cross product. This method works when the two gradients are not parallel and neither gradient is zero.

The tangent line to the intersection curve at $P=(a,b,c)$ is then

$$
\mathbf{r}(t)=P+t\mathbf{T}.
$$

Here $t$ is a real parameter and $\mathbf{T}$ is any nonzero tangent vector. This is often faster than trying to parametrize the whole intersection curve.

For example, consider the surfaces

$$
F(x,y,z)=x^2-y^2-z=0
$$

and

$$
G(x,y,z)=xyz+30=0
$$

at the point

$$
P=(-3,2,5).
$$

First compute the gradients:

$$
\nabla F(x,y,z)=2x\mathbf{i}-2y\mathbf{j}-\mathbf{k},
$$

so

$$
\nabla F(-3,2,5)=-6\mathbf{i}-4\mathbf{j}-\mathbf{k}.
$$

Also,

$$
\nabla G(x,y,z)=yz\mathbf{i}+xz\mathbf{j}+xy\mathbf{k},
$$

so

$$
\nabla G(-3,2,5)=10\mathbf{i}-15\mathbf{j}-6\mathbf{k}.
$$

A tangent vector is

$$
\mathbf{T}=\nabla F(-3,2,5)\times \nabla G(-3,2,5).
$$

Computing the cross product gives

$$
\mathbf{T}=9\mathbf{i}-46\mathbf{j}+130\mathbf{k}.
$$

Therefore a tangent line is

$$
\mathbf{r}(t)=(-3,2,5)+t(9,-46,130).
$$

Any nonzero scalar multiple of $\mathbf{T}$ gives the same tangent direction.

The gradient formulas above were written in Cartesian coordinates, but many physical and geometric problems are easier in cylindrical or spherical coordinates. In Cartesian coordinates, $x$, $y$, and $z$ all measure distances, so the gradient has the simple form

$$
\nabla f=\frac{\partial f}{\partial x}\mathbf{i}+\frac{\partial f}{\partial y}\mathbf{j}+\frac{\partial f}{\partial z}\mathbf{k}.
$$

In cylindrical coordinates $(r,\theta,z)$, the variable $r$ measures radial distance from the $z$-axis, $\theta$ measures angle around the $z$-axis, and $z$ measures height. The corresponding unit vectors are $\widehat{\mathbf{r}}$, $\widehat{\boldsymbol{\theta}}$, and $\mathbf{k}$. A small change $d\theta$ is not itself a distance. At radius $r$, the corresponding arc length is

$$
r\,d\theta.
$$

This is why the $\theta$-part of the gradient contains a factor $1/r$. For a scalar field $f(r,\theta,z)$,

$$
\nabla f=\frac{\partial f}{\partial r}\widehat{\mathbf{r}}+\frac{1}{r}\frac{\partial f}{\partial \theta}\widehat{\boldsymbol{\theta}}+\frac{\partial f}{\partial z}\mathbf{k}.
$$

Here $\frac{\partial f}{\partial r}$ measures change per unit radial distance, $\frac{1}{r}\frac{\partial f}{\partial \theta}$ converts angular change into change per unit arc length, and $\frac{\partial f}{\partial z}$ measures change per unit vertical distance.

For example, if

$$
f(r,\theta,z)=r\theta z,
$$

then

$$
\frac{\partial f}{\partial r}=\theta z,\qquad \frac{\partial f}{\partial \theta}=rz,\qquad \frac{\partial f}{\partial z}=r\theta.
$$

Therefore

$$
\nabla f=\theta z\,\widehat{\mathbf{r}}+\frac{1}{r}(rz)\widehat{\boldsymbol{\theta}}+r\theta\,\mathbf{k}.
$$

So

$$
\nabla f=\theta z\,\widehat{\mathbf{r}}+z\,\widehat{\boldsymbol{\theta}}+r\theta\,\mathbf{k}.
$$

The cancellation in the second component occurs because changing $\theta$ changes position by arc length $r\,d\theta$, not by distance $d\theta$.

In spherical coordinates $(R,\phi,\theta)$, the variable $R$ is distance from the origin, $\phi$ is the polar angle measured down from the positive $z$-axis, and $\theta$ is the azimuthal angle in the $xy$-plane. The corresponding unit vectors are $\widehat{\mathbf{R}}$, $\widehat{\boldsymbol{\phi}}$, and $\widehat{\boldsymbol{\theta}}$. For a scalar field $f(R,\phi,\theta)$,

$$
\nabla f=\frac{\partial f}{\partial R}\widehat{\mathbf{R}}+\frac{1}{R}\frac{\partial f}{\partial \phi}\widehat{\boldsymbol{\phi}}+\frac{1}{R\sin\phi}\frac{\partial f}{\partial \theta}\widehat{\boldsymbol{\theta}}.
$$

The factors $1/R$ and $1/(R\sin\phi)$ appear because the angular variables describe rotation, and rotation corresponds to arc length only after multiplying by the relevant radius.

For example, if

$$
f(R,\phi,\theta)=R\phi\theta,
$$

then

$$
\frac{\partial f}{\partial R}=\phi\theta,\qquad \frac{\partial f}{\partial \phi}=R\theta,\qquad \frac{\partial f}{\partial \theta}=R\phi.
$$

Therefore

$$
\nabla f=\phi\theta\,\widehat{\mathbf{R}}+\frac{1}{R}(R\theta)\widehat{\boldsymbol{\phi}}+\frac{1}{R\sin\phi}(R\phi)\widehat{\boldsymbol{\theta}}.
$$

So

$$
\nabla f=\phi\theta\,\widehat{\mathbf{R}}+\theta\,\widehat{\boldsymbol{\phi}}+\frac{\phi}{\sin\phi}\widehat{\boldsymbol{\theta}}.
$$

![pasted 1781199132417](/math-2/assets/pasted-1781199132417.png)

Physical examples clarify why gradients are useful. In mechanics, if a force comes from a potential energy function $U(x,y,z)$, then the force is

$$
\mathbf{F}=-\nabla U.
$$

Here $U$ is a scalar field, $\nabla U$ points in the direction where potential energy increases fastest, and the minus sign means the force points toward decreasing potential energy. Written in Cartesian components,

$$
\mathbf{F}=-\left(\frac{\partial U}{\partial x}\mathbf{i}+\frac{\partial U}{\partial y}\mathbf{j}+\frac{\partial U}{\partial z}\mathbf{k}\right).
$$

Thus

$$
F_x=-\frac{\partial U}{\partial x},\qquad F_y=-\frac{\partial U}{\partial y},\qquad F_z=-\frac{\partial U}{\partial z}.
$$

This example also shows the difference between a scalar field and a vector field. The potential energy $U$ assigns one number to each point, while the force $\mathbf{F}$ assigns a vector to each point.

The same structure appears in electrostatics. If $V$ is an electric potential, then the electric field is

$$
\mathbf{E}=-\nabla V.
$$

For an infinitely long charged line, the electric potential can be written in cylindrical coordinates as

$$
V(r)=-\frac{\rho_L}{2\pi\varepsilon_0}\ln r.
$$

Here $r$ is the cylindrical radius, $\rho_L$ is the line charge density, and $\varepsilon_0$ is the electric constant. Since $V$ depends only on $r$,

$$
\nabla V=\frac{dV}{dr}\widehat{\mathbf{r}}=-\frac{\rho_L}{2\pi\varepsilon_0 r}\widehat{\mathbf{r}}.
$$

Therefore

$$
\mathbf{E}=-\nabla V=\frac{\rho_L}{2\pi\varepsilon_0 r}\widehat{\mathbf{r}}.
$$

The field is radial because the potential depends only on the distance $r$ from the line.

For a point charge at the origin, the electric potential is naturally written in spherical coordinates as

$$
V(R)=\frac{q}{4\pi\varepsilon_0R}.
$$

Here $R$ is distance from the origin and $q$ is the charge. Since $V$ depends only on $R$,

$$
\nabla V=\frac{dV}{dR}\widehat{\mathbf{R}}=-\frac{q}{4\pi\varepsilon_0R^2}\widehat{\mathbf{R}}.
$$

Therefore

$$
\mathbf{E}=-\nabla V=\frac{q}{4\pi\varepsilon_0R^2}\widehat{\mathbf{R}}.
$$

The field points radially outward if $q>0$, and its magnitude decreases like $1/R^2$.

Diffusion gives another interpretation of the negative gradient. If $\phi(x,y,z,t)$ is a concentration of particles, then $\nabla\phi$ points in the direction in which the concentration increases fastest. Particles diffuse from higher concentration toward lower concentration, so the diffusion direction is opposite to the gradient. In a simple diffusion model, the current density is proportional to

$$
-D\nabla\phi,
$$

where $D>0$ is the diffusivity. The minus sign means that diffusion goes down the concentration gradient.

Several distinctions are important. The gradient is a vector built from partial derivatives; a directional derivative is a scalar rate of change in one chosen direction. The gradient at a point contains all first-order directional information at that point, while $D_{\mathbf{u}}f$ extracts the information in one unit direction $\mathbf{u}$. A non-unit direction vector must be normalized before using the directional-derivative formula, unless the vector is being used as a velocity and the problem asks for rate per unit time.

The graph $z=f(x,y)$ is not the same object as a level curve $f(x,y)=C$. The graph lies in three-dimensional space, while a level curve lies in the input plane. The gradient $\nabla f(x,y)$ is perpendicular to level curves in the input plane, not directly to the graph itself. If the graph is rewritten as the zero level surface

$$
w(x,y,z)=f(x,y)-z=0,
$$

then the gradient of $w$, not the two-dimensional gradient of $f$, gives a normal vector to the graph.

It is also important to remember the differentiability assumption. The formula

$$
D_{\mathbf{u}}f(P)=\nabla f(P)\cdot \mathbf{u}
$$

is guaranteed when $f$ is differentiable at $P$. The existence of directional derivatives in many directions does not by itself guarantee differentiability or continuity. In most computational problems in this course, the functions are differentiable at the point being studied, so the gradient formula applies, but the condition is conceptually important.

In synthesis, the gradient is the vector form of first-order spatial change. It collects the first partial derivatives, points in the direction of fastest increase, has length equal to the maximum rate of increase, and is perpendicular to level curves or level surfaces. The directional derivative uses the gradient to measure change in a chosen unit direction. If the direction includes speed, the same dot product gives a rate per unit time. Second directional derivatives extend the same line-based idea to concavity along a chosen direction. Together, these tools turn partial derivatives into a geometric language for slopes, contours, fastest ascent and descent, tangent planes, intersection curves, and physical fields.
