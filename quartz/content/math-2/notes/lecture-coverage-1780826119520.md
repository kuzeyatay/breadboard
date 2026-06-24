---
title: "Lecture Coverage"
date: "2026-06-07T09:55:19.520Z"
source: "user-note"
knowledge_type: "user-note"
---

Topics discussed in **Lecture 1**:

* Course organization, including lecturer introduction, textbook and study guide, lecture/instruction/studio structure, Q4 schedule, homework tests, intermediate test, final exam, and resit structure.
* Overall purpose of Math 2: extending single-variable calculus to functions of several variables, combining Calculus with Math 1 / Linear Algebra, and emphasizing 3D geometry and applications.
* Motivation from applications: vector fields, wind fields and streamlines, electric and magnetic fields, electromagnetics, automotive flow/wind-tunnel examples, and physics/engineering applications.
* Cartesian coordinates in 3D: $(x,y,z)$-axes, right-handed coordinate systems, unit vectors $\mathbf{i},\mathbf{j},\mathbf{k}$, and cross product orientation rules.
* Points and position vectors:
  $$
  \mathbf{x}=x\mathbf{i}+y\mathbf{j}+z\mathbf{k}
  $$
* Euclidean distance:
  $$
  |\mathbf{x}|=\sqrt{x^2+y^2+z^2}
  $$
* Angles between vectors using the dot product, including an example with $(3,4,12)$ and the angle with the $x$-axis.
* Planes in 3D:
  $$
  ax+by+cz=d,\qquad \mathbf{n}=a\mathbf{i}+b\mathbf{j}+c\mathbf{k}
  $$
* Intersections of planes, half-spaces, open and closed sets, open balls, boundary points, quadric surfaces, conic sections, and visualization of surfaces.
* Covered textbook sections: **Adams 10.1**, **10.5**, and planned **10.6**.

Topics discussed in **Lecture 2**:

* Clarification of open and closed sets, including neighborhoods $B_r(\mathbf{x})$, interior/exterior/boundary points, and examples such as $x+y\leq 1$ and $(-\infty,5)$.
* More on quadric surfaces: cones, hyperboloids of one and two sheets, and recognizing surfaces from signs in equations.
* Cylindrical coordinates:
  $$
  x=r\cos\theta,\qquad y=r\sin\theta,\qquad z=z
  $$
* Spherical coordinates:
  $$
  x=R\sin\phi\cos\theta,\qquad y=R\sin\phi\sin\theta,\qquad z=R\cos\phi
  $$
* Vector functions of one variable:
  $$
  \mathbf{r}(t)=x(t)\mathbf{i}+y(t)\mathbf{j}+z(t)\mathbf{k}
  $$
* Velocity, speed, and acceleration:
  $$
  \mathbf{v}(t)=\mathbf{r}'(t),\qquad v(t)=|\mathbf{v}(t)|,\qquad \mathbf{a}(t)=\mathbf{v}'(t)=\mathbf{r}''(t)
  $$
* Constant acceleration formula:
  $$
  \mathbf{r}(t)=\mathbf{r}_0+\mathbf{v}_0t+\frac12\mathbf{a}t^2
  $$
* Examples of 3D motion, differentiation rules for vector functions, constant speed condition $\mathbf{v}(t)\cdot\mathbf{a}(t)=0$, curves and parametrizations, and arc length:
  $$
  L=\int_a^b |\mathbf{r}'(t)|\,dt
  $$
* Main textbook sections: **Adams 10.5**, **10.6**, **12.1**, and **12.3**.

Topics discussed in **Lecture 3**:

* Review of curves and parametrizations, including vector functions $\mathbf r(t)$ and position vectors.
* Parametrizing surfaces, including the unit sphere:
  $$
  x=\sin\phi\cos\theta,\qquad y=\sin\phi\sin\theta,\qquad z=\cos\phi
  $$
* Parametrizing an ellipsoid:
  $$
  \frac{x^2}{a^2}+\frac{y^2}{b^2}+\frac{z^2}{c^2}=1
  $$
* Curves of intersection, arc length, arc length of graphs, conical helices, and arc-length parametrization:
  $$
  s=L(t)=\int_a^t |\mathbf r'(\tau)|\,d\tau
  $$
* Transition to functions of several variables, domains, graphs, level curves, contour maps, saddle points, and limits.
* Example domain condition:
  $$
  g(x,y)=\ln\left(1-\sqrt{1-xy}\right),\qquad 0<xy\leq 1
  $$
* Example limits:
  $$
  f(x,y)=\frac{x^2y}{x^2+y^2},\qquad g(x,y)=\frac{xy}{x^2+y^2}
  $$
* Main textbook sections: **Adams 12.3**, **13.1**, and **13.2**.

Topics discussed in **Lecture 4 / Studio Classroom 1**:

* Coordinate systems, Cartesian coordinates, vector fields, cylindrical coordinates, spherical coordinates, and unit vectors.
* Cartesian position vector:
  $$
  \mathbf r_P=x\hat{\mathbf i}+y\hat{\mathbf j}+z\hat{\mathbf k}
  $$
* Cylindrical position vector:
  $$
  \mathbf r_P=r\hat{\mathbf r}+z\hat{\mathbf k}
  $$
* Cylindrical unit vectors:
  $$
  \hat{\mathbf r}=\cos\theta\,\hat{\mathbf i}+\sin\theta\,\hat{\mathbf j},\qquad
  \hat{\boldsymbol\theta}=-\sin\theta\,\hat{\mathbf i}+\cos\theta\,\hat{\mathbf j}
  $$
* Spherical radial unit vector:
  $$
  \hat{\mathbf R}=\sin\phi\cos\theta\,\hat{\mathbf i}+\sin\phi\sin\theta\,\hat{\mathbf j}+\cos\phi\,\hat{\mathbf k}
  $$
* Derivatives of cylindrical unit vectors:
  $$
  \frac{d\hat{\mathbf r}}{d\theta}=\hat{\boldsymbol\theta},\qquad
  \frac{d\hat{\boldsymbol\theta}}{d\theta}=-\hat{\mathbf r}
  $$
* Velocity and acceleration in cylindrical coordinates:
  $$
  \mathbf v=\dot r\,\hat{\mathbf r}+r\dot\theta\,\hat{\boldsymbol\theta}
  $$
  $$
  \mathbf a=(\ddot r-r\dot\theta^2)\hat{\mathbf r}+(2\dot r\dot\theta+r\ddot\theta)\hat{\boldsymbol\theta}
  $$
* Uniform circular motion:
  $$
  \mathbf v=a\omega\hat{\boldsymbol\theta},\qquad \mathbf a=-a\omega^2\hat{\mathbf r}
  $$
* Key takeaway: in non-Cartesian coordinates, unit vectors can change direction and must be differentiated.

Topics discussed in **Lecture 5**:

* Limits of functions of several variables, practical limit computation, partial derivatives, tangent planes, normal vectors, normal lines, higher-order partial derivatives, and mixed partial derivatives.
* Example limit:
  $$
  \frac{\sin\sqrt{x^2+y^2}}{\sqrt{x^2+y^2}}\to 1\quad\text{as }(x,y)\to(0,0)
  $$
* Partial derivatives:
  $$
  \frac{\partial f}{\partial x},\qquad \frac{\partial f}{\partial y}
  $$
* Example:
  $$
  f(x,y)=x^2+xy+y^2,\qquad f_x=2x+y,\qquad f_y=x+2y
  $$
* Tangent plane:
  $$
  z=f(a,b)+f_x(a,b)(x-a)+f_y(a,b)(y-b)
  $$
* Normal vector:
  $$
  \mathbf n=(f_x(a,b),f_y(a,b),-1)
  $$
* Normal line:
  $$
  (x,y,z)=(a,b,f(a,b))+\rho(f_x(a,b),f_y(a,b),-1)
  $$
* Mixed partials usually satisfy $f_{xy}=f_{yx}$ for smooth functions.
* Connected sections: **Adams 13.2**, **13.3**, **13.4**, and postponed **13.5**.

Topics discussed in **Lecture 6**:

* Chain rule, gradients, directional derivatives, and tangent lines to intersection curves.
* One-variable chain rule:
  $$
  h'(x)=f'(g(x))g'(x)
  $$
* Chain rule for one parameter:
  $$
  \frac{dh}{dt}=\frac{\partial f}{\partial x}\frac{dx}{dt}+\frac{\partial f}{\partial y}\frac{dy}{dt}
  $$
* Chain rule for two independent variables:
  $$
  \frac{\partial g}{\partial s}=f_x(u,v)\frac{\partial u}{\partial s}+f_y(u,v)\frac{\partial v}{\partial s}
  $$
  $$
  \frac{\partial g}{\partial t}=f_x(u,v)\frac{\partial u}{\partial t}+f_y(u,v)\frac{\partial v}{\partial t}
  $$
* Gradient:
  $$
  \nabla f(x,y)=f_x(x,y)\mathbf i+f_y(x,y)\mathbf j
  $$
  $$
  \nabla f(x,y,z)=f_x\mathbf i+f_y\mathbf j+f_z\mathbf k
  $$
* Chain rule using gradient:
  $$
  \frac{d}{dt}f(\mathbf x(t))=\nabla f(\mathbf x(t))\cdot \mathbf x'(t)
  $$
* Directional derivative:
  $$
  D_{\mathbf u}f(a,b)=\nabla f(a,b)\cdot \mathbf u
  $$
* Tangent line to an intersection curve:
  $$
  (x,y,z)=(1,1,\sqrt2)+\lambda(0,\sqrt2,-1)
  $$
* Sections: **Adams 13.5**, **13.7**, postponed **13.6**, and support from **13.4**.

Topics discussed in **Lecture 7**:

* Gradient, directional derivatives, tangent planes to graphs and level surfaces, linear approximation, differentiability, vector fields, Jacobians, and Jacobian chain rule.
* Gradient for $f(x,y,z)$:
  $$
  \nabla f=(f_x,f_y,f_z)
  $$
* Tangent plane to a graph:
  $$
  z-f(a,b)=f_x(a,b)(x-a)+f_y(a,b)(y-b)
  $$
* Graph as level surface:
  $$
  g(x,y,z)=f(x,y)-z,\qquad \nabla g=(f_x,f_y,-1)
  $$
* Linearization:
  $$
  L(x,y)=g(a,b)+g_x(a,b)(x-a)+g_y(a,b)(y-b)
  $$
* Jacobian matrix:
  $$
  D\mathbf F=
  \begin{pmatrix}
  \frac{\partial F_1}{\partial x_1} & \cdots & \frac{\partial F_1}{\partial x_d}\\
  \vdots & \ddots & \vdots\\
  \frac{\partial F_n}{\partial x_1} & \cdots & \frac{\partial F_n}{\partial x_d}
  \end{pmatrix}
  $$
* Linear approximation with Jacobian:
  $$
  \mathbf F(\mathbf x)\approx \mathbf F(\mathbf x_0)+D\mathbf F(\mathbf x_0)(\mathbf x-\mathbf x_0)
  $$
* Jacobian chain rule:
  $$
  D\mathbf H(\mathbf x)=D\mathbf G(\mathbf F(\mathbf x))D\mathbf F(\mathbf x)
  $$
* Sections: **Adams 13.6**, **13.7**, Jacobian material, and postponed **13.9**.

Topics discussed in **Lecture 8**:

* Transition after the midterm, Taylor polynomials, multivariable Taylor formulas, Hessian matrices, series substitution, and the start of double integrals.
* One-variable Taylor polynomial:
  $$
  G(x)\approx G(x_0)+G'(x_0)(x-x_0)+\frac{1}{2!}G''(x_0)(x-x_0)^2+\cdots
  $$
* Step form:
  $$
  G(x_0+h)\approx G(x_0)+hG'(x_0)+\frac{h^2}{2!}G''(x_0)+\cdots
  $$
* Multivariable setup with $\mathbf a=(a_1,\ldots,a_d)$ and $\mathbf h=(h_1,\ldots,h_d)$.
* Chain rule derivative:
  $$
  F'(t)=h_1f_1(\mathbf a+t\mathbf h)+\cdots+h_df_d(\mathbf a+t\mathbf h)
  $$
* Operator notation:
  $$
  \mathbf h\cdot\nabla=h_1\frac{\partial}{\partial x_1}+\cdots+h_d\frac{\partial}{\partial x_d}
  $$
* Taylor form:
  $$
  f(\mathbf x)+(\mathbf h\cdot\nabla)f(\mathbf x)+\frac{1}{2!}(\mathbf h\cdot\nabla)^2f(\mathbf x)+\cdots
  $$
* Hessian:
  $$
  H_f=\begin{pmatrix}f_{11}&f_{12}\\f_{21}&f_{22}\end{pmatrix}
  $$
* Double integrals:
  $$
  \iint_D f(x,y)\,dA
  $$
* Riemann sums:
  $$
  \sum_i\sum_j f(x_{ij}^*,y_{ij}^*)\Delta A_{ij}
  $$
* Iterated integral for an $x$-simple domain:
  $$
  \iint_D f(x,y)\,dA=\int_a^b\left(\int_{c(x)}^{d(x)}f(x,y)\,dy\right)dx
  $$
* Sections: **Adams 13.9**, **15.1**, and start of **15.2**.

Topics discussed in **Lecture 9**:

* Brief discussion of the midterm results and the shift to integration.
* Review of double integrals:
  $$
  \iint_D f(x,y)\,dA
  $$
  Here $D$ is a region in the $xy$-plane, and $f(x,y)$ is the height of a surface above $D$.
* If $f(x,y)\geq 0$, the double integral represents volume under the surface.
* Basic properties of double integrals:
  $$
  \iint_D 1\,dA=\operatorname{area}(D)
  $$
  $$
  \iint_D(\alpha f+\beta g)\,dA=\alpha\iint_D f\,dA+\beta\iint_D g\,dA
  $$
  $$
  f\leq g \implies \iint_D f\,dA\leq \iint_D g\,dA
  $$
  $$
  \left|\iint_D f\,dA\right|\leq \iint_D |f|\,dA
  $$
* Review of $x$-simple and $y$-simple domains:
  $$
  a\leq x\leq b,\qquad c(x)\leq y\leq d(x)
  $$
  $$
  c\leq y\leq d,\qquad a(y)\leq x\leq b(y)
  $$
* Computing double integrals by slicing. For an $x$-simple domain:
  $$
  \iint_D f(x,y)\,dA=\int_a^b\int_{c(x)}^{d(x)} f(x,y)\,dy\,dx
  $$
  For a $y$-simple domain:
  $$
  \iint_D f(x,y)\,dA=\int_c^d\int_{a(y)}^{b(y)} f(x,y)\,dx\,dy
  $$
* Example over a rectangle:
  $$
  0\leq x\leq 2,\qquad 2\leq y\leq 3,\qquad f(x,y)=8-2x-y
  $$
  Both orders give $7$.
* Example over a triangle with vertices $(0,0)$, $(1,0)$, and $(1,1)$:
  $$
  f(x,y)=x^2y
  $$
  $$
  \int_0^1\int_0^x x^2y\,dy\,dx
  $$
  Changing order gives:
  $$
  \int_0^1\int_y^1 x^2y\,dx\,dy
  $$
  Both give $\frac{1}{10}$.
* Changing the order of integration requires redrawing or reinterpreting the domain; it is not just swapping $dx$ and $dy$.
* Example where changing order is necessary:
  $$
  \int_0^1\int_{\sqrt{x}}^1 e^{y^3}\,dy\,dx
  $$
  Rewritten as:
  $$
  \int_0^1\int_0^{y^2} e^{y^3}\,dx\,dy
  $$
  The result is:
  $$
  \frac{e-1}{3}
  $$
* Integration by geometric inspection:
  $$
  \iint_D \sqrt{x^2+y^2}\,dA
  $$
  over the disk of radius $2$, recognizing the graph as a cone.
* Double integrals in polar coordinates:
  $$
  x=r\cos\theta,\qquad y=r\sin\theta
  $$
  $$
  dA=dx\,dy=r\,dr\,d\theta
  $$
* Example over the unit disk:
  $$
  x^2+y^2\leq 1,\qquad f(x,y)=1-x^2-y^2
  $$
  In polar coordinates:
  $$
  \int_0^{2\pi}\int_0^1 (1-r^2)r\,dr\,d\theta=\frac{\pi}{2}
  $$
* Volume of a sphere using polar coordinates:
  $$
  x^2+y^2+z^2=R^2,\qquad z=\sqrt{R^2-x^2-y^2}
  $$
  $$
  2\iint_D \sqrt{R^2-x^2-y^2}\,dA=\frac{4}{3}\pi R^3
  $$
* More difficult polar-coordinate example: inside the circular cylinder
  $$
  x^2+y^2=2y
  $$
  and inside the parabolic cylinder
  $$
  z^2=y
  $$
  Completing the square gives:
  $$
  x^2+(y-1)^2=1
  $$
  Polar bounds:
  $$
  0\leq \theta\leq \pi,\qquad 0\leq r\leq 2\sin\theta
  $$
  Height:
  $$
  2\sqrt{y}=2\sqrt{r\sin\theta}
  $$
* Trigonometric integral:
  $$
  \int_0^\pi \sin^3\theta\,d\theta=\frac{4}{3}
  $$
* Gaussian integral:
  $$
  \int_{-\infty}^{\infty}e^{-x^2}\,dx=\sqrt{\pi}
  $$
* Main connected textbook sections: **Adams 15.1**, **15.2**, and **15.4**.

Topics discussed in **Lecture 10 / Studio Classroom**:

* Purpose of the studio classroom: connecting Math 2 material to physics, preparing for Electromagnetics 1, and revisiting gradients and directional derivatives through physical examples.
* Cartesian gradient:
  $$
  \nabla f=\frac{\partial f}{\partial x}\mathbf i+\frac{\partial f}{\partial y}\mathbf j+\frac{\partial f}{\partial z}\mathbf k
  $$
* The gradient turns a scalar field into a vector field, points in the direction of fastest increase, and is perpendicular to level sets.
* Example scalar function:
  $$
  \psi(x,y)=\sin(2\pi x)\sin(2\pi y)
  $$
* Diffusive flux is related to the negative gradient:
  $$
  \mathbf J\propto -\nabla \phi
  $$
* Conservative force from potential energy:
  $$
  \mathbf F=-\nabla U
  $$
* Electric field from electric potential:
  $$
  \mathbf E=-\nabla V
  $$
* Point-charge potential:
  $$
  V=\frac{q}{4\pi\varepsilon_0\sqrt{x^2+y^2+z^2}}
  $$
  Resulting electric field:
  $$
  \mathbf E=\frac{q}{4\pi\varepsilon_0}\frac{x\mathbf i+y\mathbf j+z\mathbf k}{(x^2+y^2+z^2)^{3/2}}
  $$
* Cylindrical coordinates:
  $$
  x=r\cos\theta,\qquad y=r\sin\theta,\qquad z=z
  $$
  Unit vectors:
  $$
  \hat{\mathbf r},\qquad \hat{\boldsymbol\theta},\qquad \hat{\mathbf k}
  $$
* Gradient in cylindrical coordinates:
  $$
  \nabla f=\frac{\partial f}{\partial r}\hat{\mathbf r}+\frac{1}{r}\frac{\partial f}{\partial \theta}\hat{\boldsymbol\theta}+\frac{\partial f}{\partial z}\hat{\mathbf k}
  $$
* The factor $1/r$ appears because a small angular change $d\theta$ corresponds to distance $r\,d\theta$.
* Displacement comparison:
  $$
  d\mathbf s=dx\,\mathbf i+dy\,\mathbf j+dz\,\mathbf k
  $$
  $$
  d\mathbf s=dr\,\hat{\mathbf r}+r\,d\theta\,\hat{\boldsymbol\theta}+dz\,\hat{\mathbf k}
  $$
* Divergence and curl preview:
  $$
  \nabla\cdot \mathbf F,\qquad \nabla\times \mathbf F
  $$
* Gradient in spherical coordinates:
  $$
  \nabla f=\frac{\partial f}{\partial R}\hat{\mathbf R}+\frac{1}{R}\frac{\partial f}{\partial \phi}\hat{\boldsymbol\phi}+\frac{1}{R\sin\phi}\frac{\partial f}{\partial \theta}\hat{\boldsymbol\theta}
  $$
* Practice functions:
  $$
  f(r,\theta,z)=r\theta z,\qquad f(R,\phi,\theta)=R\phi\theta
  $$
* Line charge in cylindrical coordinates:
  $$
  \mathbf E=\frac{\rho_L}{2\pi\varepsilon_0 r}\hat{\mathbf r}
  $$
* Point charge in spherical coordinates:
  $$
  \mathbf E=\frac{q}{4\pi\varepsilon_0R^2}\hat{\mathbf R}
  $$
* Leftover problem: showing $\mathbf r(t)-t\mathbf v(t)$ has constant length under assumptions
  $$
  \mathbf r\cdot \mathbf a=0,\qquad \mathbf v\cdot \mathbf a=0
  $$
* Leftover curve-length problem:
  $$
  \mathbf v(t)=\mathbf r'(t),\qquad \mathbf a(t)=\mathbf v'(t),\qquad L=\int_a^b |\mathbf r'(t)|\,dt
  $$
* Main connected sections: **Adams 13.7**, **10.6**, **12.1 / 12.3**, and preview of **17.1**.

Topics discussed in **Lecture 11**:

* Continuation of integration: double integrals, triple integrals, coordinate transformations, and Jacobian correction factors.
* Review of polar coordinates:
  $$
  dA=dx\,dy=r\,dr\,d\theta
  $$
* General change of variables for double integrals:
  $$
  x=x(u,v),\qquad y=y(u,v)
  $$
* Jacobian matrix:
  $$
  \frac{\partial(x,y)}{\partial(u,v)}=
  \begin{pmatrix}
  x_u & x_v\\
  y_u & y_v
  \end{pmatrix}
  $$
* Area element transformation:
  $$
  dx\,dy=\left|\frac{\partial(x,y)}{\partial(u,v)}\right|du\,dv
  $$
* Polar coordinates as a special case:
  $$
  x=r\cos\theta,\qquad y=r\sin\theta,\qquad \left|\frac{\partial(x,y)}{\partial(r,\theta)}\right|=r
  $$
* Area of an ellipse:
  $$
  \frac{x^2}{a^2}+\frac{y^2}{b^2}\leq 1,\qquad x=ar\cos\theta,\qquad y=br\sin\theta
  $$
  The Jacobian determinant is $abr$, giving area $\pi ab$.
* Triple integrals:
  $$
  \iiint_S f(x,y,z)\,dV
  $$
  In Cartesian coordinates:
  $$
  dV=dx\,dy\,dz
  $$
* Volume and mass:
  $$
  \iiint_S 1\,dV,\qquad \iiint_S \rho(x,y,z)\,dV
  $$
* Iterated triple integral:
  $$
  \iiint_S f(x,y,z)\,dV=\int_a^b\int_{c(x)}^{d(x)}\int_{e(x,y)}^{f(x,y)} f(x,y,z)\,dz\,dy\,dx
  $$
* Tetrahedron with vertices $(0,0,0)$, $(1,0,0)$, $(0,1,0)$, and $(0,0,1)$:
  $$
  x+y+z=1
  $$
  Bounds:
  $$
  0\leq x\leq 1,\qquad 0\leq y\leq 1-x,\qquad 0\leq z\leq 1-x-y
  $$
  Volume:
  $$
  \frac16
  $$
* Same tetrahedron with density:
  $$
  \rho(x,y,z)=y,\qquad \iiint_S y\,dV
  $$
* Volume between a plane and a paraboloid:
  $$
  z=3-2y,\qquad z=x^2+y^2
  $$
  Projection:
  $$
  x^2+y^2\leq 3-2y,\qquad x^2+(y+1)^2\leq 4
  $$
  Bounds use:
  $$
  x^2+y^2\leq z\leq 3-2y
  $$
* Trigonometric substitution example:
  $$
  x=2\sin\phi,\qquad \int \cos^4\phi\,d\phi
  $$
* Change of variables for triple integrals:
  $$
  x=x(u,v,w),\qquad y=y(u,v,w),\qquad z=z(u,v,w)
  $$
  Volume element transformation:
  $$
  dx\,dy\,dz=\left|\frac{\partial(x,y,z)}{\partial(u,v,w)}\right|du\,dv\,dw
  $$
* Cylindrical coordinates for triple integrals:
  $$
  x=r\cos\theta,\qquad y=r\sin\theta,\qquad z=z
  $$
  $$
  dV=r\,dr\,d\theta\,dz
  $$
* Cone volume in cylindrical coordinates:
  $$
  r\leq z\leq h,\qquad 0\leq \theta\leq 2\pi,\qquad 0\leq r\leq h
  $$
  $$
  V=\frac{\pi h^3}{3}
  $$
* Center of mass of a cone:
  $$
  \bar z=\frac{\iiint_S z\rho(x,y,z)\,dV}{\iiint_S \rho(x,y,z)\,dV}
  $$
  For constant density, $\bar z=\frac{3h}{4}$ in the coordinate setup used in the lecture.
* Spherical coordinates:
  $$
  x=R\sin\phi\cos\theta,\qquad y=R\sin\phi\sin\theta,\qquad z=R\cos\phi
  $$
* Spherical Jacobian:
  $$
  \left|\frac{\partial(x,y,z)}{\partial(R,\phi,\theta)}\right|=R^2\sin\phi
  $$
  $$
  dV=R^2\sin\phi\,dR\,d\phi\,d\theta
  $$
* Sphere cut by a cone:
  $$
  x^2+y^2+z^2\leq a^2,\qquad z\geq \sqrt{x^2+y^2}
  $$
  Spherical bounds:
  $$
  0\leq R\leq a,\qquad 0\leq \phi\leq \frac{\pi}{4},\qquad 0\leq \theta\leq 2\pi
  $$
* Key takeaway: Cartesian coordinates are best for boxes and simple algebraic bounds; polar coordinates for circular planar regions; cylindrical coordinates for solids with axial circular symmetry; and spherical coordinates for spheres, cones, and radial symmetry.
* Main connected textbook sections: **Adams 15.4**, **15.5**, **15.6**, with cylindrical and spherical coordinates connected back to **Adams 10.6**.
