---
title: "13.6 Linear Approximations, Differentiability, and Differentials"
date: "2026-06-11T06:05:24.347Z"
source: "user-note"
knowledge_type: "user-note"
---

# 13.6 Linear Approximations, Differentiability, and Differentials

The previous sections developed the basic machinery for describing local change in functions of several variables. Partial derivatives describe how a function changes when one input variable is changed while the other input variables are held fixed. The chain rule then describes how such changes combine when the input variables themselves depend on other variables. The next natural question is more practical: if we know the value of a function and its first partial derivatives at one convenient point, can we estimate the value of the function at a nearby point?

This is the problem solved by linear approximation. A nonlinear function may be difficult to evaluate exactly, but near a point where it behaves smoothly, it can often be replaced by a much simpler linear model. In one-variable calculus, the local linear model is the tangent line. In multivariable calculus, the same idea becomes the tangent plane for a function of two variables, and more generally a local linear map for functions with several input variables. This section appears here because partial derivatives and the chain rule are already available: partial derivatives give the slopes needed for the local model, and the chain rule explains why this local model is the correct first-order description of composed changes.

![pasted 1781168944607](/math-2/assets/pasted-1781168944607.png)

For a function of one variable, the idea begins with the tangent line. Suppose $f$ is differentiable at $x=a$. The tangent line to the graph of $f$ at $a$ has slope $f'(a)$ and passes through the point $(a,f(a))$. Therefore its equation is

$$
L(x)=f(a)+f'(a)(x-a).
$$

Here $L(x)$ is called the linearization of $f$ about $a$. The value $f(a)$ is the known output at the base point, $f'(a)$ is the rate of change at that base point, and $x-a$ is the change in the input. The approximation

$$
f(x)\approx L(x)
$$

means that, when $x$ is close to $a$, the tangent line gives a good first-order estimate of the function value.

It is important to understand what “good first-order estimate” means. Let $h=x-a$, so that $x=a+h$. The tangent-line approximation becomes

$$
f(a+h)\approx f(a)+f'(a)h.
$$

The approximation error is

$$
f(a+h)-f(a)-f'(a)h.
$$

Differentiability means that this error is small compared with the input change $h$. Formally,

$$
\lim_{h\to 0}
\frac{f(a+h)-f(a)-f'(a)h}{h}
=0.
$$

This does not say that the tangent line equals the function. It says that, near $a$, the part of the function’s change not explained by the tangent line becomes negligible compared with the size of the input change.

![pasted 1781168844300](/math-2/assets/pasted-1781168844300.png)

For a function of two variables, the graph is a surface $z=f(x,y)$. Suppose we want to approximate $f(x,y)$ near a base point $(a,b)$. The input change now has two components: $x-a$, the change in the $x$-direction, and $y-b$, the change in the $y$-direction. The partial derivative $f_x(a,b)$ measures the rate of change at $(a,b)$ when $x$ changes and $y$ is held fixed. The partial derivative $f_y(a,b)$ measures the rate of change at $(a,b)$ when $y$ changes and $x$ is held fixed.

The linear approximation combines these two first-order changes:

$$
L(x,y)=f(a,b)+f_x(a,b)(x-a)+f_y(a,b)(y-b).
$$

Here $L(x,y)$ is the linearization of $f$ about $(a,b)$. The number $f(a,b)$ is the height of the surface at the base point. The term $f_x(a,b)(x-a)$ predicts the change in height caused by the horizontal displacement in the $x$-direction. The term $f_y(a,b)(y-b)$ predicts the change in height caused by the horizontal displacement in the $y$-direction. Together they give the height of the tangent plane above the nearby point $(x,y)$. Thus

$$
f(x,y)\approx L(x,y)
$$

when $(x,y)$ is close to $(a,b)$.

Strictly speaking, $L(x,y)$ is an affine function rather than a purely linear function, because it contains the constant term $f(a,b)$. The truly linear part is the predicted change

$$
f_x(a,b)(x-a)+f_y(a,b)(y-b).
$$

This distinction is useful. Linear approximation starts with the known value $f(a,b)$, then adds a linear prediction of the change from $(a,b)$ to $(x,y)$.

A common calculation follows a fixed pattern. First choose the base point, usually a nearby point where the function and its derivatives are easy to evaluate. Then compute the function value and the relevant partial derivatives at the base point. Then build the linearization. Finally, substitute the target point into the linearization. The base point is where derivatives are evaluated; the target point is where the approximation is used. Confusing these two points is one of the most common mistakes in linear-approximation problems.

Consider

$$
f(x,y)=\sqrt{2x^2+e^{2y}}.
$$

Suppose we want to approximate $f(2.2,-0.2)$. The point $(2.2,-0.2)$ is close to the convenient point $(2,0)$. At this base point,

$$
f(2,0)=\sqrt{2(2)^2+e^0}=\sqrt{8+1}=3.
$$

The first partial derivatives are

$$
f_x(x,y)=\frac{2x}{\sqrt{2x^2+e^{2y}}},
\qquad
f_y(x,y)=\frac{e^{2y}}{\sqrt{2x^2+e^{2y}}}.
$$

The derivative $f_x$ is computed by treating $y$ as constant, and $f_y$ is computed by treating $x$ as constant. Evaluating at $(2,0)$ gives

$$
f_x(2,0)=\frac{4}{3},
\qquad
f_y(2,0)=\frac{1}{3}.
$$

Therefore the linearization about $(2,0)$ is

$$
L(x,y)=3+\frac{4}{3}(x-2)+\frac{1}{3}(y-0).
$$

Now substitute the target point $(2.2,-0.2)$:

$$
L(2.2,-0.2)=3+\frac{4}{3}(0.2)+\frac{1}{3}(-0.2)=3.2.
$$

Thus

$$
f(2.2,-0.2)\approx 3.2.
$$

The function itself is nonlinear, but near $(2,0)$ the tangent plane gives a usable local estimate.

A second example shows how linearization is used around a point where logarithmic and trigonometric terms simplify. Let

$$
g(x,y)=\sin(\pi xy+\ln y),
$$

where $y>0$, because $\ln y$ is defined only for positive $y$. We approximate $g(0.05,1.1)$ using the nearby base point $(0,1)$. First,

$$
g(0,1)=\sin(\pi\cdot 0\cdot 1+\ln 1)=\sin(0)=0.
$$

Using the chain rule,

$$
g_x(x,y)=\pi y\cos(\pi xy+\ln y),
$$

and

$$
g_y(x,y)=\left(\pi x+\frac{1}{y}\right)\cos(\pi xy+\ln y).
$$

At $(0,1)$,

$$
g_x(0,1)=\pi,
\qquad
g_y(0,1)=1.
$$

Therefore the linearization is

$$
L(x,y)=0+\pi(x-0)+1(y-1)=\pi x+y-1.
$$

Substituting the target point gives

$$
g(0.05,1.1)\approx L(0.05,1.1)=0.05\pi+0.1\approx 0.257.
$$

The calculation uses only local information at $(0,1)$. The approximation is not exact, but it is the first-order estimate obtained from the tangent plane.

The same idea works for functions of three variables. Suppose

$$
w=f(x,y,z)
$$

and we want to approximate the function near the base point $(a,b,c)$. A nearby point has input changes

$$
x-a,\qquad y-b,\qquad z-c.
$$

The linearization is

$$
L(x,y,z)=f(a,b,c)+f_x(a,b,c)(x-a)+f_y(a,b,c)(y-b)+f_z(a,b,c)(z-c).
$$

Here $f_x(a,b,c)$, $f_y(a,b,c)$, and $f_z(a,b,c)$ are the partial derivatives at the base point. Each derivative measures the first-order effect of changing one input variable while holding the other two fixed. The formula says that the total first-order change is obtained by adding the first-order changes caused by each input direction.

For example, let

$$
f(x,y,z)=\sqrt{x+2y+3z}.
$$

Suppose we want the linearization about $(1,1,1)$. First,

$$
f(1,1,1)=\sqrt{1+2+3}=\sqrt{6}.
$$

The partial derivatives are

$$
f_x(x,y,z)=\frac{1}{2\sqrt{x+2y+3z}},
$$

$$
f_y(x,y,z)=\frac{2}{2\sqrt{x+2y+3z}}=\frac{1}{\sqrt{x+2y+3z}},
$$

and

$$
f_z(x,y,z)=\frac{3}{2\sqrt{x+2y+3z}}.
$$

Evaluating at $(1,1,1)$ gives

$$
f_x(1,1,1)=\frac{1}{2\sqrt{6}},
\qquad
f_y(1,1,1)=\frac{1}{\sqrt{6}},
\qquad
f_z(1,1,1)=\frac{3}{2\sqrt{6}}.
$$

Therefore

$$
L(x,y,z)=\sqrt{6}+\frac{1}{2\sqrt{6}}(x-1)+\frac{1}{\sqrt{6}}(y-1)+\frac{3}{2\sqrt{6}}(z-1).
$$

This is the three-variable version of the tangent-plane idea. Although the graph of a function of three variables cannot be drawn as an ordinary surface in three-dimensional space, the local principle is the same: near the base point, the function is approximated by its first-order linear part.

The most compact notation for linear approximation uses vectors. Let

$$
\mathbf{x}=(x_1,x_2,\ldots,x_n)
$$

be an input point in $\mathbb{R}^n$, and let

$$
\mathbf{h}=(h_1,h_2,\ldots,h_n)
$$

be a small input-change vector. Then the nearby point is $\mathbf{x}+\mathbf{h}$. If $f$ is a scalar-valued function, meaning that it outputs one real number, the first-order approximation is

$$
f(\mathbf{x}+\mathbf{h})\approx f(\mathbf{x})+\nabla f(\mathbf{x})\cdot \mathbf{h}.
$$

Here $\nabla f(\mathbf{x})$ is the gradient vector at $\mathbf{x}$, and $\nabla f(\mathbf{x})\cdot \mathbf{h}$ is the dot product of the gradient with the input-change vector. Written out in coordinates,

$$
\nabla f(\mathbf{x})\cdot \mathbf{h}=\frac{\partial f}{\partial x_1}(\mathbf{x})h_1+\frac{\partial f}{\partial x_2}(\mathbf{x})h_2+\cdots+\frac{\partial f}{\partial x_n}(\mathbf{x})h_n.
$$

This is the same formula as before. The vector notation simply packages all input directions into one expression.

The condition that makes linear approximation reliable is called differentiability. In one variable, differentiability at a point means that the tangent line gives a good first-order approximation. In several variables, differentiability at a point means that one linear approximation works in all directions approaching that point, not only along the coordinate axes.

For a function of two variables, write a nearby point as

$$
(a+h,b+k).
$$

Here $h$ is the change in the $x$-coordinate and $k$ is the change in the $y$-coordinate. The distance from $(a,b)$ to $(a+h,b+k)$ in the input plane is

$$
\sqrt{h^2+k^2}.
$$

The linear prediction for the function value is

$$
f(a,b)+f_x(a,b)h+f_y(a,b)k.
$$

The error in this prediction is

$$
f(a+h,b+k)-f(a,b)-f_x(a,b)h-f_y(a,b)k.
$$

The function $f$ is called differentiable at $(a,b)$ if

$$
\lim_{(h,k)\to(0,0)}
\frac{f(a+h,b+k)-f(a,b)-f_x(a,b)h-f_y(a,b)k}{\sqrt{h^2+k^2}}
=0.
$$

The denominator is the length of the input-change vector $(h,k)$. This is necessary because, in several variables, the input change is not a single number but a vector. The definition says that the linearization error becomes negligible compared with the distance moved in the input plane.

This definition also explains why partial derivatives alone are not enough. The partial derivatives $f_x(a,b)$ and $f_y(a,b)$ measure change in only two special directions: parallel to the $x$-axis and parallel to the $y$-axis. But a point in the plane can be approached from infinitely many directions. A function may behave well along the coordinate axes but fail to have a good tangent-plane approximation along a diagonal or curved path. Differentiability rules out this problem by requiring the same linear approximation to work in every direction near the point.

In most ordinary computations, we do not check the differentiability limit directly. A useful sufficient condition is the following: if the first partial derivatives of $f$ exist and are continuous in a neighbourhood of $(a,b)$, then $f$ is differentiable at $(a,b)$. A neighbourhood means a small open region around the point. This condition is stronger than merely having the partial derivatives at the point itself. It requires the partial derivatives to behave smoothly nearby.

The reason this condition works can be understood by splitting a small move into coordinate-direction moves. To move from $(a,b)$ to $(a+h,b+k)$, one can first change $x$, then change $y$. The one-variable Mean Value Theorem controls the change during each part of this movement using partial derivatives at intermediate points. In one common form,

$$
f(a+h,b+k)-f(a,b)=h f_x(a+\theta_1 h,b+k)+k f_y(a,b+\theta_2 k),
$$

where $0<\theta_1<1$ and $0<\theta_2<1$. The numbers $\theta_1$ and $\theta_2$ indicate intermediate points along the small coordinate-direction moves. If $f_x$ and $f_y$ are continuous near $(a,b)$, then these intermediate partial derivatives approach $f_x(a,b)$ and $f_y(a,b)$ as $(h,k)\to(0,0)$. This is why the tangent-plane approximation becomes accurate to first order.

A polynomial example makes the structure visible. Let

$$
f(x,y)=x^3+xy^2.
$$

The partial derivatives are

$$
f_x(x,y)=3x^2+y^2,
\qquad
f_y(x,y)=2xy.
$$

Now compare the exact change from $(x,y)$ to $(x+h,y+k)$ with the linear prediction at $(x,y)$. Expanding gives

$$
f(x+h,y+k)-f(x,y)=(3x^2+y^2)h+(2xy)k+3xh^2+h^3+2yhk+hk^2+xk^2.
$$

The first two terms are exactly

$$
f_x(x,y)h+f_y(x,y)k.
$$

The remaining terms contain at least two small factors, such as $h^2$, $hk$, or $k^2$. These are smaller than first-order terms as $(h,k)\to(0,0)$. This is the algebraic reason the tangent plane gives the correct first-order model for this polynomial.

Differentials give a compact way to write the same first-order change. Suppose

$$
z=f(x,y).
$$

The exact change in $z$ when $x$ changes by $\Delta x$ and $y$ changes by $\Delta y$ is

$$
\Delta z=f(x+\Delta x,y+\Delta y)-f(x,y).
$$

This is the actual output change. The differential, written $dz$ or $df$, is the linear prediction of that change:

$$
dz=df=f_x(x,y)\,dx+f_y(x,y)\,dy.
$$

Here $dx$ and $dy$ are small changes in the input variables. The symbol $dz$ is the predicted first-order change in the output. It is not automatically equal to the exact change $\Delta z$. When $f$ is differentiable and $dx,dy$ are small,

$$
\Delta z\approx dz.
$$

The difference between $\Delta z$ and $dz$ is important. The exact change $\Delta z$ comes from the original nonlinear function. The differential $dz$ comes from the tangent plane. The differential is useful because it is easier to compute and usually accurate for small input changes.

For a function of $n$ variables,

$$
z=f(x_1,x_2,\ldots,x_n),
$$

the differential is

$$
dz=df=\frac{\partial f}{\partial x_1}dx_1+\frac{\partial f}{\partial x_2}dx_2+\cdots+\frac{\partial f}{\partial x_n}dx_n.
$$

The variables $x_1,x_2,\ldots,x_n$ are the input variables. The quantities $dx_1,dx_2,\ldots,dx_n$ are small changes in those inputs. Each coefficient $\partial f/\partial x_i$ is the partial derivative with respect to the corresponding input variable, evaluated at the base point. The formula says that the total first-order output change is the sum of the first-order contributions from the separate input changes.

Differentials are especially useful for estimating sensitivity. Consider the period $T$ of a pendulum,

$$
T=2\pi\sqrt{\frac{L}{g}},
$$

where $L$ is the pendulum length and $g$ is gravitational acceleration. Since $T$ depends on both $L$ and $g$, its differential is

$$
dT=\frac{\partial T}{\partial L}dL+\frac{\partial T}{\partial g}dg.
$$

The partial derivatives can be written in terms of $T$ itself:

$$
\frac{\partial T}{\partial L}=\frac{T}{2L},
\qquad
\frac{\partial T}{\partial g}=-\frac{T}{2g}.
$$

Therefore

$$
dT=\frac{T}{2L}dL-\frac{T}{2g}dg.
$$

Dividing by $T$ gives the relative-change formula

$$
\frac{dT}{T}=\frac{1}{2}\frac{dL}{L}-\frac{1}{2}\frac{dg}{g}.
$$

If $L$ increases by $2\%$, then $dL/L=0.02$. If $g$ decreases by $0.6\%$, then $dg/g=-0.006$. Substitution gives

$$
\frac{dT}{T}=\frac{1}{2}(0.02)-\frac{1}{2}(-0.006)=0.013.
$$

So the period increases by approximately $1.3\%$. This example also shows the importance of signs. A decrease in $g$ produces an increase in $T$, because $g$ appears in the denominator inside the square root.

![pasted 1781168999489](/math-2/assets/pasted-1781168999489.png)

The same local approximation idea applies to functions with several output components. Such a function is called a transformation. A transformation

$$
\mathbf{F}:\mathbb{R}^n\to\mathbb{R}^m
$$

takes an input vector with $n$ components and returns an output vector with $m$ components. If

$$
\mathbf{F}(x_1,\ldots,x_n)=(F_1(x_1,\ldots,x_n),\ldots,F_m(x_1,\ldots,x_n)),
$$

then each output component $F_i$ may depend on each input variable $x_j$. The partial derivatives of all output components with respect to all input variables are organized into the Jacobian matrix

$$
D\mathbf{F}(\mathbf{x})=
\begin{pmatrix}
\frac{\partial F_1}{\partial x_1} & \frac{\partial F_1}{\partial x_2} & \cdots & \frac{\partial F_1}{\partial x_n}\\
\frac{\partial F_2}{\partial x_1} & \frac{\partial F_2}{\partial x_2} & \cdots & \frac{\partial F_2}{\partial x_n}\\
\vdots & \vdots & \ddots & \vdots\\
\frac{\partial F_m}{\partial x_1} & \frac{\partial F_m}{\partial x_2} & \cdots & \frac{\partial F_m}{\partial x_n}
\end{pmatrix}.
$$

The entry in row $i$ and column $j$ is

$$
\frac{\partial F_i}{\partial x_j}.
$$

It measures how the $i$-th output component changes when the $j$-th input variable changes. Therefore the Jacobian has one row for each output component and one column for each input variable. If $\mathbf{F}:\mathbb{R}^n\to\mathbb{R}^m$, then $D\mathbf{F}$ is an $m\times n$ matrix.

If the partial derivatives in the Jacobian matrix are continuous near the point, the Jacobian gives the local linear approximation

$$
\mathbf{F}(\mathbf{x}+d\mathbf{x})\approx \mathbf{F}(\mathbf{x})+D\mathbf{F}(\mathbf{x})d\mathbf{x}.
$$

Here $d\mathbf{x}$ is the small input-change vector, and $D\mathbf{F}(\mathbf{x})d\mathbf{x}$ is the predicted first-order output-change vector. This is the vector-valued version of the tangent-plane formula.

A scalar-valued function is a special case. If

$$
f:\mathbb{R}^2\to\mathbb{R},
$$

then the output has only one component, so the Jacobian has one row:

$$
Df(x,y)=
\begin{pmatrix}
f_x(x,y) & f_y(x,y)
\end{pmatrix}.
$$

Multiplying this row matrix by the input-change column vector gives

$$
df=
\begin{pmatrix}
f_x & f_y
\end{pmatrix}
\begin{pmatrix}
dx\\
dy
\end{pmatrix}
=f_x\,dx+f_y\,dy.
$$

So the differential formula is just a Jacobian matrix multiplication in the scalar-output case.

Consider the transformation

$$
\mathbf{F}(x,y)=\bigl(xe^y+\cos(\pi y),\ x^2,\ x-e^y\bigr).
$$

This transformation maps $\mathbb{R}^2$ into $\mathbb{R}^3$. There are two input variables, $x$ and $y$, and three output components. Therefore its Jacobian is a $3\times 2$ matrix:

$$
D\mathbf{F}(x,y)=
\begin{pmatrix}
e^y & xe^y-\pi\sin(\pi y)\\
2x & 0\\
1 & -e^y
\end{pmatrix}.
$$

At the base point $(1,0)$,

$$
D\mathbf{F}(1,0)=
\begin{pmatrix}
1 & 1\\
2 & 0\\
1 & -1
\end{pmatrix},
\qquad
\mathbf{F}(1,0)=(2,1,0).
$$

To approximate $\mathbf{F}(1.02,0.01)$, use

$$
d\mathbf{x}=
\begin{pmatrix}
0.02\\
0.01
\end{pmatrix}.
$$

Then

$$
d\mathbf{F}=D\mathbf{F}(1,0)d\mathbf{x}=
\begin{pmatrix}
1 & 1\\
2 & 0\\
1 & -1
\end{pmatrix}
\begin{pmatrix}
0.02\\
0.01
\end{pmatrix}
=
\begin{pmatrix}
0.03\\
0.04\\
0.01
\end{pmatrix}.
$$

Therefore

$$
\mathbf{F}(1.02,0.01)\approx (2,1,0)+(0.03,0.04,0.01)=(2.03,1.04,0.01).
$$

This example is not a different principle. It is the same first-order approximation, but now the output has three components, so the predicted change also has three components.

The Jacobian is especially important for coordinate transformations. A coordinate transformation rewrites the same point in space using different variables. For example, cylindrical coordinates use $r,\theta,z$ instead of $x,y,z$. The transformation from cylindrical coordinates to Cartesian coordinates is

$$
x=r\cos\theta,
\qquad
y=r\sin\theta,
\qquad
z=z.
$$

This defines a transformation

$$
\mathbf{F}(r,\theta,z)=(r\cos\theta,r\sin\theta,z).
$$

The input variables are $r,\theta,z$, and the output variables are $x,y,z$. Its Jacobian matrix is

$$
D\mathbf{F}(r,\theta,z)=\frac{\partial(x,y,z)}{\partial(r,\theta,z)}=
\begin{pmatrix}
\frac{\partial x}{\partial r} & \frac{\partial x}{\partial \theta} & \frac{\partial x}{\partial z}\\
\frac{\partial y}{\partial r} & \frac{\partial y}{\partial \theta} & \frac{\partial y}{\partial z}\\
\frac{\partial z}{\partial r} & \frac{\partial z}{\partial \theta} & \frac{\partial z}{\partial z}
\end{pmatrix}.
$$

Computing the entries gives

$$
\frac{\partial(x,y,z)}{\partial(r,\theta,z)}=
\begin{pmatrix}
\cos\theta & -r\sin\theta & 0\\
\sin\theta & r\cos\theta & 0\\
0 & 0 & 1
\end{pmatrix}.
$$

The first column describes how the Cartesian point changes when $r$ changes. The second column describes how the Cartesian point changes when $\theta$ changes. The third column describes how the Cartesian point changes when $z$ changes. Thus the Jacobian matrix is a local description of how small cylindrical-coordinate changes produce small Cartesian-coordinate changes.

For spherical coordinates, using the course convention

$$
x=R\sin\phi\cos\theta,
\qquad
y=R\sin\phi\sin\theta,
\qquad
z=R\cos\phi,
$$

the transformation is

$$
\mathbf{F}(R,\phi,\theta)=(R\sin\phi\cos\theta,\ R\sin\phi\sin\theta,\ R\cos\phi).
$$

The Jacobian matrix is

$$
\frac{\partial(x,y,z)}{\partial(R,\phi,\theta)}=
\begin{pmatrix}
\sin\phi\cos\theta & R\cos\phi\cos\theta & -R\sin\phi\sin\theta\\
\sin\phi\sin\theta & R\cos\phi\sin\theta & R\sin\phi\cos\theta\\
\cos\phi & -R\sin\phi & 0
\end{pmatrix}.
$$

Each column again represents the Cartesian change produced by changing one spherical coordinate while holding the others fixed. The Jacobian matrix is therefore the differential of the coordinate transformation.

When the input and output dimensions are the same, the Jacobian matrix is square and has a determinant. The determinant is not the main focus of this section, but it is useful to know its meaning. A square Jacobian determinant measures the local area-scaling or volume-scaling factor of the transformation. This is why Jacobian determinants later appear in changes of variables for double and triple integrals. In the present section, the primary meaning of the Jacobian is simpler: it is the matrix of the best local linear approximation to a transformation.

The chain rule also has a natural Jacobian form. Suppose

$$
\mathbf{F}:\mathbb{R}^n\to\mathbb{R}^m
$$

and

$$
\mathbf{G}:\mathbb{R}^m\to\mathbb{R}^k
$$

are differentiable transformations. The composition $\mathbf{G}\circ\mathbf{F}$ first applies $\mathbf{F}$, then applies $\mathbf{G}$. The local linear approximation of the composition is obtained by multiplying the local linear approximations:

$$
D(\mathbf{G}\circ\mathbf{F})(\mathbf{x})=D\mathbf{G}(\mathbf{F}(\mathbf{x}))D\mathbf{F}(\mathbf{x}).
$$

This is the same chain rule idea as before, but written with matrices. The order of multiplication matters. First $D\mathbf{F}(\mathbf{x})$ maps an input change in the original variables to an approximate change in the intermediate variables. Then $D\mathbf{G}(\mathbf{F}(\mathbf{x}))$ maps that intermediate change to an approximate change in the final output variables.

There are several distinctions that should be kept clear. The base point is the point where the function value and partial derivatives are evaluated. The target point is the nearby point where the approximation is used. The exact change $\Delta f$ is the actual output change of the original function, while the differential $df$ is the first-order linear prediction of that change. Partial derivatives test coordinate directions, while differentiability guarantees a good linear approximation in all directions. Finally, the Jacobian matrix is the local linear map itself, while its determinant, when it exists, measures local scaling and is mainly used later.

The central idea of this section is that smooth nonlinear functions behave approximately linearly at sufficiently small scales. For a function of one variable, the local model is a tangent line. For a function of two variables, it is a tangent plane. For a scalar function of many variables, it is the gradient dot the input-change vector. For a vector-valued transformation, it is the Jacobian matrix multiplying the input-change vector. Differentiability is the condition that this first-order model is genuinely accurate, and differentials are the notation used to express the predicted small changes.
