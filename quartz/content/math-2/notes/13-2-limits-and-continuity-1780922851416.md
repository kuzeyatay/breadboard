---
title: "13.2 Limits and Continuity"
date: "2026-06-08T12:47:31.416Z"
source: "user-note"
knowledge_type: "user-note"
---

# 13.2 Limits and Continuity

A function of several variables assigns one output value to each input point in a domain. In the previous section, this gave us objects such as graphs, level curves, and level surfaces. Those tools describe what a function looks like globally. The next question is local: what happens to the output when the input point moves closer and closer to a particular point?

For a function of one variable, approaching a point is mostly a left-versus-right issue. For a function of two variables, there are infinitely many ways to approach a point. The point $(x,y)$ can approach $(a,b)$ along a horizontal line, a vertical line, a diagonal line, a parabola, a spiral, or any other curve lying in the domain. This makes limits in several variables stricter than one-variable limits. A multivariable limit exists only if all allowed approaches force the function values toward the same number.

The reason this topic appears immediately after functions of several variables is that domains, graphs, and level curves are not enough to tell us whether a function behaves stably near a point. A formula may look harmless but fail to have a limit because different paths give different values. A formula may be undefined at a point but still approach a definite value near that point. A boundary point may have a meaningful limit, but only through points where the function is actually defined. Limits and continuity are the language used to separate these possibilities.

Before defining a limit, we need the idea of distance between input points. If $(x,y)$ and $(a,b)$ are points in the plane, their distance is

$$
\sqrt{(x-a)^2+(y-b)^2}.
$$

This formula measures how far $(x,y)$ is from $(a,b)$. A small distance means that the input point is close to the target point. If $\delta>0$, the $\delta$-neighbourhood of $(a,b)$ is the open disk

$$
B_\delta(a,b)=\left\{(x,y):\sqrt{(x-a)^2+(y-b)^2}<\delta\right\}.
$$

Here $B_\delta(a,b)$ means “the ball of radius $\delta$ centered at $(a,b)$.” In two dimensions this ball is a disk. In three dimensions it is an ordinary ball. The same idea also works in $\mathbb{R}^d$, where the input point is written as a vector

$$
\mathbf{x}=(x_1,x_2,\ldots,x_d).
$$

If $\mathbf{x}_0=(a_1,a_2,\ldots,a_d)$, then the distance from $\mathbf{x}$ to $\mathbf{x}_0$ is

$$
|\mathbf{x}-\mathbf{x}_0|=\sqrt{(x_1-a_1)^2+(x_2-a_2)^2+\cdots+(x_d-a_d)^2}.
$$

The notation $|\mathbf{x}-\mathbf{x}_0|$ means the length of the difference vector $\mathbf{x}-\mathbf{x}_0$. Conceptually, it is just the distance between the current input point and the point being approached.

A point of a domain can be an interior point, a boundary point, or an isolated point. A point $\mathbf{x}_0$ is an interior point of a domain $D$ if some small ball around $\mathbf{x}_0$ lies completely inside $D$. This means that one can move a little in every direction and remain in the domain. A point $\mathbf{x}_0$ is a boundary point of $D$ if every small ball around $\mathbf{x}_0$ contains both points of $D$ and points outside $D$. This means the point lies on the edge of the domain. A point $\mathbf{x}_0\in D$ is an isolated point of $D$ if there exists some radius $r>0$ such that

$$
B_r(\mathbf{x}_0)\cap D=\{\mathbf{x}_0\}.
$$

This says that $\mathbf{x}_0$ is a single separated point of the domain. There are no other domain points sufficiently close to it. Limits are not intended for such points, because a limit asks what happens as nearby domain points approach the target point. If there are no nearby domain points, there is no real approach process to study.

![pasted 1780928452025](/math-2/assets/pasted-1780928452025.png)

Now let $f:D\to\mathbb{R}$ be a real-valued function whose domain $D$ is a subset of $\mathbb{R}^2$. We say that

$$
\lim_{(x,y)\to(a,b)}f(x,y)=L
$$

if two requirements are satisfied. First, every neighbourhood of $(a,b)$ must contain points of $D$ different from $(a,b)$. Second, for every number $\varepsilon>0$, there must exist a number $\delta>0$ such that

$$
|f(x,y)-L|<\varepsilon
$$

whenever $(x,y)\in D$ and

$$
0<\sqrt{(x-a)^2+(y-b)^2}<\delta.
$$

The number $\varepsilon$ measures how close the output $f(x,y)$ must be to the proposed limit $L$. The number $\delta$ measures how close the input point $(x,y)$ must be to the target point $(a,b)$. The inequality

$$
0<\sqrt{(x-a)^2+(y-b)^2}
$$

excludes the point $(a,b)$ itself. This is important because the limit depends on nearby values, not necessarily on the function value at the point itself. The condition $(x,y)\in D$ is also essential, because the function only has values on its domain.

![pasted 1780928752476](/math-2/assets/pasted-1780928752476.png)

The definition says that the function values can be forced as close as desired to $L$ by requiring the input point to be close enough to $(a,b)$. The phrase “as close as desired” is represented by $\varepsilon$. The phrase “close enough” is represented by $\delta$. The definition does not say that one particular $\delta$ works for all accuracy levels. Usually, if we demand a smaller $\varepsilon$, we need a smaller $\delta$.

The same definition can be written compactly in vector notation. If $f:D\to\mathbb{R}$, where $D\subseteq\mathbb{R}^d$, then

$$
\lim_{\mathbf{x}\to\mathbf{x}_0}f(\mathbf{x})=L
$$

means that every neighbourhood of $\mathbf{x}_0$ contains domain points other than possibly $\mathbf{x}_0$, and for every $\varepsilon>0$ there exists $\delta>0$ such that

$$
|f(\mathbf{x})-L|<\varepsilon
$$

whenever

$$
\mathbf{x}\in D
\qquad\text{and}\qquad
0<|\mathbf{x}-\mathbf{x}_0|<\delta.
$$

This vector notation is not a new idea. It is the same input-closeness and output-closeness definition, but written in a form that works in two, three, or more dimensions.

A limit, if it exists, is unique. This means that a function cannot have two different limits at the same point. The reason is conceptual: if nearby function values can be forced arbitrarily close to $L$, and also arbitrarily close to $M$, then $L$ and $M$ cannot be distinct. In multivariable work, uniqueness is usually used in a practical way: if two approaches toward the same point give two different limiting values, then the full limit does not exist.

The most direct limits are evaluated by substitution and the usual limit laws. If

$$
\lim_{(x,y)\to(a,b)}f(x,y)=L
\qquad\text{and}\qquad
\lim_{(x,y)\to(a,b)}g(x,y)=M,
$$

then

$$
\lim_{(x,y)\to(a,b)}(f(x,y)+g(x,y))=L+M,
$$

$$
\lim_{(x,y)\to(a,b)}(f(x,y)-g(x,y))=L-M,
$$

$$
\lim_{(x,y)\to(a,b)}f(x,y)g(x,y)=LM,
$$

and, if $M\neq0$,

$$
\lim_{(x,y)\to(a,b)}\frac{f(x,y)}{g(x,y)}=\frac{L}{M}.
$$

These rules say that sums, differences, products, and quotients behave predictably when the separate limits exist. There is also a composition rule. If $F:\mathbb{R}\to\mathbb{R}$ is continuous at $L$, and

$$
\lim_{(x,y)\to(a,b)}f(x,y)=L,
$$

then

$$
\lim_{(x,y)\to(a,b)}F(f(x,y))=F(L).
$$

This rule explains why square roots, logarithms, trigonometric functions, and exponentials can often be handled by substitution, provided their inputs approach values where the outer function is defined and continuous.

For example, consider

$$
f(x,y)=1-xy+y^2.
$$

The maximal domain is all of $\mathbb{R}^2$, because the formula uses only addition, subtraction, and multiplication. As $(x,y)\to(0,0)$, the product $xy$ tends to $0$, and $y^2$ tends to $0$. Therefore,

$$
\lim_{(x,y)\to(0,0)}(1-xy+y^2)=1.
$$

This is the simplest kind of multivariable limit: the formula is continuous everywhere, so the limit is found by substituting the target point.

Boundary points require a slight change in interpretation. Consider

$$
f(x,y)=\sqrt{1-x^2-y^2}.
$$

The square root requires

$$
1-x^2-y^2\geq0,
$$

so the domain is

$$
D=\{(x,y):x^2+y^2\leq1\}.
$$

This is the closed disk of radius $1$ centered at the origin. If $(a,b)$ is on the boundary circle $a^2+b^2=1$, then points outside the disk are not part of the domain. They are not allowed approaches. The limit is taken only through points inside the disk. Since

$$
\sqrt{1-x^2-y^2}\to\sqrt{1-a^2-b^2}=0,
$$

the function has limit $0$ at each boundary point. This illustrates a general principle: at a boundary point, the limit is relative to the domain.

![pasted 1780924598683](/math-2/assets/pasted-1780924598683.png)

A limit can fail because different paths give different limiting values. Consider

$$
f(x,y)=\frac{2xy}{x^2+y^2},
$$

which is defined for all $(x,y)\neq(0,0)$. We ask whether the limit exists as $(x,y)\to(0,0)$. Along the $x$-axis, $y=0$, so

$$
f(x,0)=\frac{2x\cdot0}{x^2+0^2}=0.
$$

Thus along the $x$-axis, the function approaches $0$. Along the line $y=x$,

$$
f(x,x)=\frac{2x\cdot x}{x^2+x^2}=\frac{2x^2}{2x^2}=1
$$

for $x\neq0$. Thus along $y=x$, the function approaches $1$. Since the same point $(0,0)$ is approached but the output tends to two different values, the limit does not exist:

$$
\lim_{(x,y)\to(0,0)}\frac{2xy}{x^2+y^2}
$$

does not exist.

This example also explains why path testing is useful. To disprove a limit, it is enough to find two paths that produce different limiting values. A common family of paths is the family of straight lines through the point. At the origin, these have the form

$$
y=kx,
$$

where $k$ is a constant slope. Substituting $y=kx$ into the function gives

$$
f(x,kx)=\frac{2x(kx)}{x^2+(kx)^2}=\frac{2kx^2}{(1+k^2)x^2}=\frac{2k}{1+k^2}
$$

for $x\neq0$. The expression depends on $k$. For $k=0$, it is $0$. For $k=1$, it is $1$. Therefore the limiting value depends on the direction of approach, so there is no single limit.

![pasted 1780924628407](/math-2/assets/pasted-1780924628407.png)

There is an important warning: checking straight lines is not enough to prove that a limit exists. It is enough to disprove a limit if different straight lines give different values, but agreement along all straight lines does not guarantee a full multivariable limit.

Consider

$$
f(x,y)=\frac{2x^2y}{x^4+y^2}.
$$

Along the coordinate axes, the numerator is zero, so the function is zero. Along a non-horizontal straight line $y=kx$, with $k\neq0$,

$$
f(x,kx)=\frac{2x^2(kx)}{x^4+(kx)^2}=\frac{2kx^3}{x^4+k^2x^2}=\frac{2kx}{x^2+k^2}.
$$

As $x\to0$, this tends to $0$. Thus every straight-line approach suggests the value $0$. But along the parabola

$$
y=x^2,
$$

we get

$$
f(x,x^2)=\frac{2x^2(x^2)}{x^4+(x^2)^2}=\frac{2x^4}{2x^4}=1
$$

for $x\neq0$. Along this curved path the function approaches $1$. Therefore the full limit does not exist. The conclusion is that path testing is mainly a method for finding contradictions, not a general proof of existence.

![pasted 1780924650807](/math-2/assets/pasted-1780924650807.png)

To prove that a multivariable limit exists, one usually needs a path-independent argument. A common method is to bound the absolute value of the function by a simpler expression that depends only on the distance to the target point.

Consider

$$
f(x,y)=\frac{x^2y}{x^2+y^2}.
$$

This function is not defined at $(0,0)$, but the limit at $(0,0)$ may still exist. Since

$$
x^2\leq x^2+y^2,
$$

we have

$$
\left|\frac{x^2y}{x^2+y^2}\right|=\frac{x^2|y|}{x^2+y^2}\leq |y|.
$$

Also,

$$
|y|\leq \sqrt{x^2+y^2}.
$$

Therefore

$$
\left|\frac{x^2y}{x^2+y^2}\right|\leq\sqrt{x^2+y^2}.
$$

As $(x,y)\to(0,0)$, the distance $\sqrt{x^2+y^2}$ tends to $0$. Since the absolute value of the function is trapped between $0$ and a quantity that tends to $0$, the function itself tends to $0$. Hence

$$
\lim_{(x,y)\to(0,0)}\frac{x^2y}{x^2+y^2}=0.
$$

The key point is that this argument does not depend on a chosen path. It works for all points sufficiently close to the origin.

A similar estimate appears in trigonometric examples. Consider

$$
f(x,y)=\frac{x\sin y}{\sqrt{x^2+y^2}}.
$$

The denominator is zero at $(0,0)$, so the function is not defined there. To study the limit, use the one-variable inequality

$$
|\sin y|\leq |y|.
$$

Then

$$
\left|\frac{x\sin y}{\sqrt{x^2+y^2}}\right|\leq\frac{|x||y|}{\sqrt{x^2+y^2}}.
$$

Let

$$
r=\sqrt{x^2+y^2}.
$$

Here $r$ is the distance from $(x,y)$ to the origin. Since $|x|\leq r$ and $|y|\leq r$,

$$
\frac{|x||y|}{r}\leq\frac{r\cdot r}{r}=r.
$$

Therefore

$$
\left|\frac{x\sin y}{\sqrt{x^2+y^2}}\right|\leq r.
$$

As $(x,y)\to(0,0)$, $r\to0$, so

$$
\lim_{(x,y)\to(0,0)}\frac{x\sin y}{\sqrt{x^2+y^2}}=0.
$$

This is a typical exam-style limit: direct substitution gives $0/0$, but the expression can be controlled by the distance to the origin.

Not every limit is centered at the origin. If the target point is $(a,b)$, it is often useful to translate the point to the origin by setting

$$
u=x-a,
\qquad
v=y-b.
$$

Then $(x,y)\to(a,b)$ is equivalent to $(u,v)\to(0,0)$. For example, suppose we want to study

$$
\lim_{(x,y)\to(0,1)}\frac{x^2(y-1)^2}{x^2+(y-1)^2}.
$$

Set

$$
u=x,
\qquad
v=y-1.
$$

Then the expression becomes

$$
\frac{u^2v^2}{u^2+v^2},
$$

and $(x,y)\to(0,1)$ becomes $(u,v)\to(0,0)$. Since

$$
u^2v^2\leq \frac{(u^2+v^2)^2}{4},
$$

we get

$$
0\leq\frac{u^2v^2}{u^2+v^2}\leq\frac{u^2+v^2}{4}.
$$

The right-hand side tends to $0$, so the original limit is $0$. Translation is not a new method; it simply rewrites a non-origin limit as an origin limit.

Continuity combines the limiting behaviour near a point with the value at the point. A function $f$ is continuous at a point $(a,b)\in D$ if

$$
\lim_{(x,y)\to(a,b)}f(x,y)=f(a,b).
$$

This definition has three parts. First, $f(a,b)$ must be defined. Second, the limit as $(x,y)\to(a,b)$ must exist. Third, the limit must equal the actual function value at the point. If any of these conditions fails, the function is not continuous at that point.

The distinction between a limit and a function value is essential. The limit describes what nearby function values do. The function value describes what happens exactly at the point. Consider

$$
f(x,y)=
\begin{cases}
0, & (x,y)\neq(0,0),\\
1, & (x,y)=(0,0).
\end{cases}
$$

Near the origin, every point except the origin itself has function value $0$. Therefore

$$
\lim_{(x,y)\to(0,0)}f(x,y)=0.
$$

But

$$
f(0,0)=1.
$$

The function is not continuous at the origin because the limit and the assigned value do not match.

A discontinuity may be removable. For example,

$$
f(x,y)=\frac{x^2y}{x^2+y^2}
$$

is not originally defined at $(0,0)$, but we proved that its limit there is $0$. If we define

$$
f(0,0)=0,
$$

then the extended function becomes continuous at the origin. The discontinuity was caused only by a missing value. In contrast, for

$$
\frac{2xy}{x^2+y^2}
$$

or

$$
\frac{2x^2y}{x^4+y^2},
$$

there is no value that can be assigned at the origin to make the function continuous there, because the limit itself does not exist.

Many standard functions are continuous wherever they are defined. Polynomial functions in $x$ and $y$, such as

$$
x^2+xy+y^2,
$$

are continuous everywhere in $\mathbb{R}^2$. Rational functions, which are quotients of polynomial functions, are continuous wherever the denominator is not zero. Square-root functions are continuous where the expression under the square root is nonnegative. Logarithmic functions are continuous where the expression inside the logarithm is positive. Compositions of continuous functions are continuous wherever the composition is defined.

This is why domain analysis is part of continuity. The formula alone is not enough. We must know where the formula is allowed. For square roots, the expression under the square root must satisfy

$$
\text{inside of square root}\geq0.
$$

For logarithms, the expression inside the logarithm must satisfy

$$
\text{inside of logarithm}>0.
$$

For denominators, the denominator must satisfy

$$
\text{denominator}\neq0.
$$

These conditions determine the maximal domain of definition.

A domain is open if every point of the domain is an interior point. Equivalently, around every domain point there is a small ball fully contained in the domain. A domain is closed if it contains all of its boundary points; equivalently, its complement is open. A domain can be neither open nor closed. This often happens when one part of the boundary is included and another part is excluded. A domain is connected if it consists of one piece. A practical way to understand connectedness in this course is this: a domain is connected if any two points in it can be joined by a continuous path lying entirely inside the domain. If a domain splits into two separated pieces, it is not connected.

![pasted 1780929200349](/math-2/assets/pasted-1780929200349.png)

Consider the function

$$
f(x,y)=\sqrt{1+y^2-x^2}.
$$

The square root requires

$$
1+y^2-x^2\geq0.
$$

Thus the maximal domain is

$$
D=\{(x,y)\in\mathbb{R}^2:x^2-y^2\leq1\}.
$$

The boundary is described by

$$
x^2-y^2=1.
$$

The domain includes its boundary because the condition is $\leq1$, not $<1$. Therefore it is closed. It is also connected. One way to see this is that any point $(x,y)\in D$ can be connected to the point $(0,y)$ by moving horizontally while staying inside $D$, since decreasing $|x|$ keeps $x^2-y^2\leq1$. Then points on the $y$-axis can be connected vertically. The point $(1,0)$ is not isolated, because nearby domain points such as $(1-t,0)$, with small $t>0$, also lie in $D$. Since the square-root function is continuous on its domain,

$$
\lim_{(x,y)\to(1,0)}\sqrt{1+y^2-x^2}=\sqrt{1+0^2-1^2}=0.
$$

This example shows how domain, boundary, connectedness, isolated points, continuity, and limits can appear in one problem.

Now consider

$$
f(x,y)=1-\sqrt{xy-y^2}.
$$

The square root requires

$$
xy-y^2\geq0.
$$

Factoring gives

$$
y(x-y)\geq0.
$$

This inequality describes the maximal domain

$$
D=\{(x,y)\in\mathbb{R}^2:y(x-y)\geq0\}.
$$

The domain is closed because it is defined by a non-strict inequality involving a continuous expression. The point $(0,0)$ is not isolated. For example, every point of the form $(t,0)$ satisfies

$$
0(t-0)=0,
$$

so $(t,0)\in D$ for all real $t$. These domain points can be made arbitrarily close to $(0,0)$. The limit is

$$
\lim_{(x,y)\to(0,0)}\left(1-\sqrt{xy-y^2}\right)=1-\sqrt{0}=1,
$$

where the approach is understood through points of the domain.

A logarithm can create a different kind of domain. Consider

$$
f(x,y)=\ln\left(1-\sqrt{1-xy}\right).
$$

The square root requires

$$
1-xy\geq0,
$$

so

$$
xy\leq1.
$$

The logarithm requires its input to be strictly positive:

$$
1-\sqrt{1-xy}>0.
$$

This is equivalent to

$$
\sqrt{1-xy}<1.
$$

Since both sides are nonnegative, this gives

$$
1-xy<1,
$$

so

$$
xy>0.
$$

Combining the two restrictions gives the maximal domain

$$
D=\{(x,y)\in\mathbb{R}^2:0<xy\leq1\}.
$$

This domain is neither open nor closed. It includes the boundary curve $xy=1$, because $\leq1$ is allowed, but it excludes the axes $xy=0$, because $xy>0$ is required. It is also not connected, because it has one piece in the first quadrant and one piece in the third quadrant. As $(x,y)\to(0,0)$ through the domain, we have $xy\to0^+$. Then

$$
\sqrt{1-xy}\to1,
$$

so

$$
1-\sqrt{1-xy}\to0^+.
$$

Therefore

$$
\ln\left(1-\sqrt{1-xy}\right)\to-\infty.
$$

The formal limit definition in this section is a finite real-number definition. Thus this function does not have a finite real limit at $(0,0)$, although it decreases without bound along allowed approaches.

A final domain warning is useful. If a point is included only because an inequality becomes an equality, it may still be non-isolated. For example, for

$$
f(x,y)=\sqrt{(1-x)(y-\ln x)},
$$

the logarithm requires

$$
x>0,
$$

and the square root requires

$$
(1-x)(y-\ln x)\geq0.
$$

The point $(1,0)$ belongs to the domain because $x=1$ gives $\ln 1=0$, so the product is $0$. But $(1,0)$ is not isolated: when $x=1$, the factor $1-x$ is zero, so every point $(1,y)$ satisfies the square-root condition. Thus there are infinitely many domain points arbitrarily close to $(1,0)$. This kind of example is why isolated-point questions must be answered from the domain, not from visual guessing.

The main methods of this section fit together as follows. First find the domain, because limits and continuity are always relative to where the function is defined. Then decide whether the target point can actually be approached through the domain. For ordinary continuous formulas, use substitution and limit laws. If substitution gives an indeterminate form such as $0/0$, test paths to look for contradictions. If different paths give different values, the limit does not exist. If path tests do not produce a contradiction, prove the limit by using an inequality that controls the function in terms of the distance to the target point. Continuity is then the final check: the function is continuous at a point precisely when the nearby limiting value exists and equals the actual value at that point.
