---
title: "Signals, Basis Functions, Fourier Analysis, and Sampling"
date: "2026-04-30T12:31:09.717Z"
source: "user-note"
knowledge_type: "user-note"
flag_color: "#22c55e"
tags: ["signal", "basis", "vector", "mathbf", "vector-space", "basis-vectors", "begin-bmatrix", "discrete-time", "end-bmatrix", "mathbf-begin", "time", "signals", "digital-signal-processing", "fourier-analysis", "sampling-theorem", "nyquist-rate", "aliasing", "basis-functions", "vector-spaces", "orthogonality", "communication-systems"]
---

# Signals, Basis Functions, and Fourier Analysis

Communication begins with a simple but deep problem: information must be carried by physical signals. A spoken word becomes air pressure, then a microphone voltage. A wireless transmission becomes an electromagnetic wave. A digital file becomes a sequence of voltage levels, light pulses, or radio-frequency changes. In every case, the message is not transmitted as an abstract idea. It is represented by a signal whose form changes as it moves through a communication system. The same information may appear first as an acoustic pressure wave, then as an analog voltage, later as a sequence of numbers, later as a line-coded electrical signal, and eventually again as an analog waveform at the receiver. The physical form changes, but the purpose remains the same: preserve and transfer information with sufficient fidelity.

[Graph: Course reader Figure 1, the Communication 1 topic map, should be placed here to show the transmitter-channel-receiver chain and the way the message changes form.]

A signal is therefore the central object of communication theory. At first, it is natural to think of a signal as a curve drawn against time. A microphone voltage, for example, may be written as

[
x(t),
]

where (t) is time and (x(t)) is the value of the signal at that instant. If the signal is analog, time varies continuously and the amplitude may also vary continuously. This means that, in principle, the signal has a value at every possible instant. Such a waveform may look like a curve, but for communication theory this visual picture is not enough. We need to know how to describe the signal, how to compare it with other signals, how to decompose it into simpler parts, and how to understand what frequencies it contains.

This is why the first mathematical step is representation. Before a signal can be transmitted, filtered, modulated, sampled, reconstructed, or analyzed, we need a language for saying what it is made of. Fourier analysis provides that language. It says that many signals can be represented in terms of sinusoidal components. The same signal can be viewed in time, where we see how it changes instant by instant, or in frequency, where we see which oscillatory components are present. These are not two different signals. The Fourier series or Fourier transform does not create a new function. It gives an alternative representation of the same function. In the time domain, the function is described by its value at each instant. In the frequency domain, the same function is described by how much of each sinusoidal basis function it contains. The object is unchanged; only the coordinate system has changed.

The idea behind this representation is not unique to Fourier analysis. It is the same idea that appears in linear algebra when a vector is represented using a basis. A vector is not defined by one specific coordinate system. The same vector may be described using different basis vectors, depending on which description is most useful. Signals behave in the same way. A time-domain description tells us how the signal behaves as time passes. A frequency-domain description tells us how much of each sinusoidal pattern is present. Fourier analysis is the change of representation that takes us from one view to the other.

To make this precise, we first need to understand why signals may be treated as vectors. A vector does not have to mean an arrow in two- or three-dimensional physical space. More generally, a vector is an object that can be added to another object of the same kind and multiplied by a scalar while remaining inside the same set of objects. Signals have this structure. If (x(t)) and (y(t)) are signals, then

[
x(t)+y(t)
]

is also a signal. If (c) is a scalar, then

[
cx(t)
]

is also a signal. Therefore, signals naturally form vector spaces. This viewpoint is essential because it lets us use the ideas of basis, projection, orthogonality, and coordinates for signals.

In digital signal processing, one important signal vector space is denoted by

[
S.
]

The elements of (S) are complete discrete-time signals. A signal in (S) is an infinite sequence

[
{y_k},
]

where the index (k) ranges over all integers. Such a signal has the form

[
\ldots,\ y_{-2},\ y_{-1},\ y_0,\ y_1,\ y_2,\ldots
]

This is an infinite-dimensional signal vector space. It contains whole discrete-time signals, not just short sample blocks. This distinction matters. A finite block of (N) samples,

[
\mathbf{x}
==========

\begin{bmatrix}
x[0]\
x[1]\
\vdots\
x[N-1]
\end{bmatrix},
]

belongs to

[
\mathbb{R}^N
]

if the samples are real, or to

[
\mathbb{C}^N
]

if the samples are complex. Such a vector may be a finite window taken from a signal in (S), but it is not the same object as the entire doubly infinite sequence. The full space (S) is the theoretical space of complete discrete-time signals. The finite space (\mathbb{R}^N) or (\mathbb{C}^N) is the computational space used when a computer processes a finite block of samples.

A basic signal in (S) is the discrete-time delta signal, denoted by (\delta), defined by

[
\delta_k=
\begin{cases}
1, & k=0,\
0, & k\neq 0.
\end{cases}
]

A shifted delta signal is zero everywhere except at one chosen integer index. These shifted deltas isolate sample positions. In a finite-dimensional space such as (\mathbb{R}^N), the analogous objects are the standard basis vectors

[
\mathbf{e}_0,\mathbf{e}*1,\ldots,\mathbf{e}*{N-1}.
]

Each one has a single nonzero entry. Therefore any finite sample vector can be written as

[
\mathbf{x}
==========

x[0]\mathbf{e}_0
+
x[1]\mathbf{e}*1
+
\cdots
+
x[N-1]\mathbf{e}*{N-1}.
]

This is a true finite basis expansion. The sample values are the coordinates, and the standard basis vectors identify the sample positions.

For a complete discrete-time signal, one often writes formally

[
x[k]=\sum_{n=-\infty}^{\infty}x[n]\delta[k-n].
]

This equation says that the signal can be assembled from shifted deltas weighted by the sample values. However, there is a subtle point. This is an infinite sum. In ordinary algebraic vector-space language, a basis expansion uses only a finite linear combination. Therefore, the shifted deltas form an ordinary algebraic basis for finite-support signals, meaning signals with only finitely many nonzero samples. For general signals in (S), the expression is better understood as an infinite coordinate expansion. This is one of the places where signal spaces are richer than the finite-dimensional spaces first encountered in linear algebra.

The reason basis representations are useful is that they let us describe a complicated object through simpler building blocks. In the plane, a vector

[
\mathbf{v}
==========

\begin{bmatrix}
v_1\
v_2
\end{bmatrix}
]

is usually written using the standard basis vectors

[
\mathbf{e}_1=
\begin{bmatrix}
1\
0
\end{bmatrix},
\qquad
\mathbf{e}_2=
\begin{bmatrix}
0\
1
\end{bmatrix}.
]

Then

[
\mathbf{v}=v_1\mathbf{e}_1+v_2\mathbf{e}_2.
]

The coordinates (v_1) and (v_2) tell us how much of each basis direction is present. But another basis could also be used. The vector itself would not change; only its coordinate description would change.

[Graph: Course reader Figure 2, the 2D vector-space visualization with (\hat{i}) and (\hat{j}), should be placed here.]

A set of basis vectors must satisfy two conditions. First, the vectors must be linearly independent: no vector in the set may be written as a combination of the others. Algebraically, if

[
c_1\mathbf{v}_1+c_2\mathbf{v}_2+\cdots+c_k\mathbf{v}_k=0,
]

then the only solution must be

[
c_1=c_2=\cdots=c_k=0.
]

If there were a nonzero solution, then at least one vector could be written in terms of the others, meaning that the set would contain a redundant direction.

Second, the vectors must span the space: every vector in the space must be expressible as a linear combination of them. If

[
S={\mathbf{v}_1,\mathbf{v}_2,\ldots,\mathbf{v}_k}
]

is a basis for a space, then every vector (\mathbf{w}) in that space can be written as

[
\mathbf{w}
==========

a_1\mathbf{v}_1+a_2\mathbf{v}_2+\cdots+a_k\mathbf{v}_k,
]

where the coefficients (a_1,a_2,\ldots,a_k) scale the basis vectors. Linear independence prevents redundancy. Spanning prevents incompleteness. Together, they make a set of vectors a basis.

The same principle applies to signals. If we describe a finite sample vector using the standard sample-position basis, we are asking how much signal value is present at each sample index. Fourier analysis asks a different question: how much of each sinusoidal pattern is present? The signal does not change. Its coordinates change. Instead of coordinates indexed by time position, we obtain coordinates indexed by frequency.

To make coordinates useful, we need a way to measure how much of one direction is present in another. This is the role of the dot product. The dot product takes two vectors and returns a single number. For

[
\mathbf{v}
==========

\begin{bmatrix}
v_1&v_2&\cdots&v_n
\end{bmatrix},
\qquad
\mathbf{w}
==========

\begin{bmatrix}
w_1\
w_2\
\vdots\
w_n
\end{bmatrix},
]

the dot product is

[
\mathbf{v}\cdot\mathbf{w}
=========================

v_1w_1+v_2w_2+\cdots+v_nw_n.
]

This number measures how strongly the two vectors align. If it is large and positive, the vectors point strongly in similar directions. If it is negative, they point partly in opposite directions. If it is zero, the vectors are orthogonal: one has no component in the direction of the other.

Two vectors are orthogonal if their dot product is zero:

[
\mathbf{v}_i\cdot\mathbf{v}_j=0
\qquad \text{for } i\neq j.
]

Orthogonality means that the directions do not interfere with each other. If a vector is measured along one orthogonal direction, that measurement is not contaminated by the components in the other directions. If the basis vectors are also of length one, the basis is called orthonormal.

Projection explains why this matters. In three dimensions, a vector can be decomposed along three mutually perpendicular axes. Suppose

[
\mathbf{A}
==========

A_x\hat{x}
+
A_y\hat{y}
+
A_z\hat{z}.
]

The coordinate (A_x) measures how much of (\mathbf{A}) lies along the (x)-axis, (A_y) measures how much lies along the (y)-axis, and (A_z) measures how much lies along the (z)-axis. These are not three different vectors; they are the three coordinates of the same vector in the chosen basis. Because the axes are orthogonal, each coordinate can be found independently.

[Graph: Use a 3D projection diagram here, matching the left side of Course reader Figure 4. Show a vector (\mathbf{A}) in 3D and its projections (A_x), (A_y), and (A_z) on the three orthogonal axes.]

If (\mathbf{x}) is projected onto a nonzero vector (\mathbf{u}), the projection coefficient is

[
a=
\frac{\mathbf{x}\cdot\mathbf{u}}{\mathbf{u}\cdot\mathbf{u}}.
]

The numerator measures overlap between (\mathbf{x}) and (\mathbf{u}). The denominator corrects for the length of (\mathbf{u}). If (\mathbf{u}) has unit length, then

[
\mathbf{u}\cdot\mathbf{u}=1,
]

and the coefficient becomes

[
a=\mathbf{x}\cdot\mathbf{u}.
]

Thus, in an orthogonal basis, coefficients are found by projection and by dividing by the squared length of the basis vector. In an orthonormal basis, that squared length is already one, so the coefficient is just the projection inner product.

For complex-valued finite sample vectors, the dot product must be replaced by the complex inner product. If

[
\mathbf{x},\mathbf{y}\in\mathbb{C}^N,
]

then

[
\langle \mathbf{x},\mathbf{y}\rangle
====================================

\sum_{n=0}^{N-1}x[n]y^*[n],
]

where (y^*[n]) denotes complex conjugation. The conjugate is not a technical decoration. It is needed so that length and energy behave correctly. With this definition,

[
\langle \mathbf{x},\mathbf{x}\rangle
====================================

# \sum_{n=0}^{N-1}x[n]x^*[n]

\sum_{n=0}^{N-1}|x[n]|^2,
]

which is real and nonnegative. This is the finite signal energy. Without the conjugate, a complex vector could have a “length squared” that is complex or even zero for a nonzero vector, which would destroy the geometry needed for projection.

The imaginary unit (j) also has a useful geometric meaning. It is often introduced by the algebraic rule

[
j^2=-1,
]

but in signal analysis it is helpful to think of multiplication by (j) as a (90^\circ) rotation in the complex plane. Multiplying by (j) rotates a complex quantity by (90^\circ), and multiplying by (j^2=-1) rotates it by (180^\circ). This viewpoint makes Euler’s formula intuitive:

[
e^{j\omega t}
=============

\cos(\omega t)+j\sin(\omega t).
]

The cosine term lies along the real axis, while the sine term lies along the (90^\circ)-shifted imaginary axis. Thus a complex exponential packages two orthogonal sinusoidal directions into one compact expression.

This finite-dimensional viewpoint leads naturally to the Discrete Fourier Transform, or DFT. A computer does not process an entire continuous-time function directly. It processes finite lists of samples. Therefore, it needs a finite-dimensional Fourier tool: a way to take a length-(N) sample vector and describe it using a finite set of sinusoidal patterns.

For a length-(N) sample block, the (k)-th Fourier vector is

[
\mathbf{v}_k=
\begin{bmatrix}
1\
e^{j2\pi k/N}\
e^{j2\pi k2/N}\
\vdots\
e^{j2\pi k(N-1)/N}
\end{bmatrix}.
]

Its (n)-th entry is

[
v_k[n]=e^{j2\pi kn/N}.
]

Here (n) is the sample index, meaning position inside the finite time block. The index (k) is the frequency index, meaning which sinusoidal pattern is being tested. The case (k=0) corresponds to a constant pattern, called the DC component. The case (k=1) corresponds to one full cycle across the (N)-sample block. The case (k=2) corresponds to two cycles across the block, and so on. If the samples were taken at sampling frequency (f_s), the frequency spacing between DFT bins is

[
\Delta f=\frac{f_s}{N},
]

so the bin (k) corresponds to

[
f_k=\frac{k f_s}{N},
]

with the usual interpretation that the upper DFT bins represent negative frequencies.

A subtle but important normalization issue appears here. Each individual complex exponential value

[
e^{j2\pi kn/N}
]

has magnitude one, because it lies on the unit circle. But the whole vector (\mathbf{v}_k) does not have length one. It has (N) entries, each with magnitude one, so

[
\langle \mathbf{v}_k,\mathbf{v}_k\rangle
========================================

# \sum_{n=0}^{N-1}|e^{j2\pi kn/N}|^2

# \sum_{n=0}^{N-1}1

N.
]

Therefore,

[
|\mathbf{v}_k|=\sqrt{N}.
]

The Fourier vectors are orthogonal, but not orthonormal. They point in independent frequency directions, but their length is (\sqrt{N}), not one. Their orthogonality follows from the finite sum

[
\sum_{n=0}^{N-1}
e^{j2\pi(k-m)n/N}
=================

\begin{cases}
N, & k=m,\
0, & k\neq m.
\end{cases}
]

If (k=m), every term in the sum is (1), so the result is (N). If (k\neq m), the terms are equally spaced points around the unit circle. They complete an integer number of rotations and cancel to zero. This is the finite-dimensional version of harmonic orthogonality.

The DFT is obtained by comparing the signal vector with each Fourier vector. Using the complex inner product,

[
\langle \mathbf{x},\mathbf{v}_k\rangle
======================================

\sum_{n=0}^{N-1}x[n]v_k^*[n].
]

Since

[
v_k[n]=e^{j2\pi kn/N},
]

we have

[
v_k^*[n]=e^{-j2\pi kn/N}.
]

Therefore,

[
\langle \mathbf{x},\mathbf{v}_k\rangle
======================================

\sum_{n=0}^{N-1}x[n]e^{-j2\pi kn/N}.
]

This is the usual DFT formula:

[
X[k]=
\sum_{n=0}^{N-1}x[n]e^{-j2\pi kn/N}.
]

Thus (X[k]) is the raw overlap between the sampled signal and the (k)-th Fourier vector. If the signal strongly contains that frequency pattern, the terms in the sum reinforce and (|X[k]|) becomes large. If the pattern is absent, the rotating complex terms cancel and (X[k]) becomes small or zero.

Because (\mathbf{v}_k) is not unit length, the usual DFT output is not the normalized coordinate directly. It is an unnormalized Fourier coordinate. The actual coefficient in the expansion

[
\mathbf{x}
==========

\sum_{k=0}^{N-1}a_k\mathbf{v}_k
]

is obtained from the projection formula:

[
a_k=
\frac{\langle \mathbf{x},\mathbf{v}_k\rangle}
{\langle \mathbf{v}_k,\mathbf{v}_k\rangle}.
]

Since

[
\langle \mathbf{v}_k,\mathbf{v}_k\rangle=N,
]

we get

[
a_k=\frac{X[k]}{N}.
]

This is why the inverse DFT contains the factor (1/N):

[
x[n]=
\frac{1}{N}
\sum_{k=0}^{N-1}
X[k]e^{j2\pi kn/N}.
]

The factor (1/N) is not arbitrary. It corrects for the fact that the usual Fourier vectors have squared length (N). The forward DFT computes raw overlaps. The inverse DFT converts those raw overlaps into the correct reconstruction weights.

For example, suppose

[
x[n]=A
\qquad
\text{for all }n.
]

This is a constant signal, so it contains only the DC pattern. For (k=0),

[
X[0]=
\sum_{n=0}^{N-1}A
=================

NA.
]

The DFT gives (NA), not (A), because it has accumulated the contribution over all (N) samples. The actual coefficient of the constant basis vector is

[
\frac{X[0]}{N}=A.
]

For (k\neq 0), the complex exponentials complete full rotations and cancel, so

[
X[k]=0.
]

Thus the DFT result says that the finite sample block contains only a DC component. Its raw overlap is (NA), and its actual coordinate is (A).

The magnitude

[
|X[k]|
]

therefore tells how strongly the finite sample block overlaps with the (k)-th frequency pattern, up to the chosen normalization convention. The phase

[
\angle X[k]
]

tells the phase alignment of that component. A large magnitude means that the frequency is strongly present in the finite observation window. A small magnitude means that the pattern is weak or absent.

One may also define normalized Fourier vectors,

[
\mathbf{u}_k=
\frac{1}{\sqrt{N}}\mathbf{v}_k.
]

Then

[
|\mathbf{u}_k|=1,
]

so the basis is orthonormal. In that convention, the Fourier coefficient is directly

[
\widetilde{X}[k]
================

# \langle \mathbf{x},\mathbf{u}_k\rangle

\frac{1}{\sqrt{N}}X[k],
]

and reconstruction becomes

[
\mathbf{x}
==========

\sum_{k=0}^{N-1}
\widetilde{X}[k]\mathbf{u}_k.
]

This is the same geometry with a different normalization. The usual engineering convention places all normalization in the inverse transform. The unitary convention splits normalization evenly between the forward and inverse transforms. Both describe the same change of basis.

The DFT is therefore the finite-dimensional version of Fourier analysis. It rewrites a finite sample vector in a frequency basis. Its results are not mysterious new quantities; they are frequency-domain overlaps, with magnitude and phase, scaled according to the normalization convention. This finite-dimensional picture prepares the same idea in a more general setting: continuous-time signals are also vectors, but now the vectors are functions.

In a function space, basis vectors become basis functions. A signal may be represented as

[
x(t)=\sum_i a_i\phi_i(t),
]

where (\phi_i(t)) are basis functions and (a_i) are coefficients. Basis functions need not be sinusoidal. A Taylor series, for example, uses polynomial basis functions:

[
f(t)
====

# a_0+a_1t+a_2t^2+a_3t^3+\cdots

\sum_{n=0}^{\infty}a_nt^n.
]

Here the basis functions are

[
1,\ t,\ t^2,\ t^3,\ldots
]

[Graph: Course reader Figure 3, showing a function decomposed into a sum of five basis functions, should be placed here.]

Fourier analysis chooses a different family:

[
\sin(\omega t),
\qquad
\cos(\omega t),
\qquad
e^{j\omega t}.
]

This choice is made because communication systems are naturally described in terms of frequency. Filters pass some frequencies and suppress others. Channels have bandwidth. Antennas operate over frequency ranges. Modulation shifts information to different frequency bands. Therefore, a basis that reveals frequency content is especially useful.

To project one function onto another, the finite sum in the inner product becomes an integral:

[
\langle f,g\rangle
==================

\int_{t_1}^{t_2}f(t)g^*(t),dt.
]

This is the continuous analogue of the dot product. Instead of multiplying corresponding vector entries and summing, we multiply corresponding function values and integrate. A function space equipped with such an inner product, together with the appropriate completeness property, is called a Hilbert space. For the present purpose, the essential idea is that functions can be treated like vectors: they can be projected onto basis functions, and coefficients can be found by inner products.

The analogy with ordinary three-dimensional projection is direct. In three dimensions, the coordinate of a vector (\vec{A}) along the (x)-axis is found by projecting (\vec{A}) onto the unit vector (\hat{x}):

[
A_x=\vec{A}\cdot\hat{x}.
]

The dot product measures how much of (\vec{A}) lies in the (\hat{x}) direction. Because the (x), (y), and (z) axes are mutually orthogonal, projection onto one axis does not pick up components from the other axes.

In a Hilbert space of functions, the “axes” are no longer physical coordinate axes. They are basis functions. For a periodic signal, these basis functions are often chosen as complex exponentials,

[
e^{jk\omega_0t},
]

or equivalently as sine and cosine functions. The Fourier coefficient

[
c_k=\frac{1}{T}\int_0^T x(t)e^{-jk\omega_0t},dt
]

is the function-space version of a coordinate projection. The finite dot product has become an integral over time. The basis vector (\hat{x}) has become the basis function (e^{jk\omega_0t}). The coordinate (A_x) has become the Fourier coefficient (c_k). The integer (k) selects which orthogonal function-axis, or harmonic direction, is being measured.

[Graph: Course reader Figure 4, “From 3D Axes to Function Axes,” should be placed here. It should show the 3D projection (A_x=\vec{A}\cdot\hat{x}) next to the function projection (c_k=\frac{1}{T}\int_0^T x(t)e^{-jk\omega_0t}dt).]

A set of basis functions ({\phi_k(t)}) is orthogonal on the interval ([t_1,t_2]) if

[
\int_{t_1}^{t_2}\phi_i(t)\phi_j^*(t),dt=0
\qquad \text{for } i\neq j.
]

The squared length, or energy, of one basis function is

[
\lambda_k=
\int_{t_1}^{t_2}|\phi_k(t)|^2,dt.
]

If

[
\lambda_k=1
]

for every (k), the basis is orthonormal.

Suppose a signal can be represented as

[
x(t)=\sum_k a_k\phi_k(t).
]

To find (a_m), multiply both sides by (\phi_m^*(t)) and integrate:

[
\int_{t_1}^{t_2}x(t)\phi_m^*(t),dt
==================================

\int_{t_1}^{t_2}
\left(
\sum_k a_k\phi_k(t)
\right)
\phi_m^*(t),dt.
]

By linearity,

[
\int_{t_1}^{t_2}x(t)\phi_m^*(t),dt
==================================

\sum_k a_k
\int_{t_1}^{t_2}\phi_k(t)\phi_m^*(t),dt.
]

Orthogonality removes every term except the one with (k=m):

[
\int_{t_1}^{t_2}x(t)\phi_m^*(t),dt
==================================

a_m
\int_{t_1}^{t_2}|\phi_m(t)|^2,dt.
]

Using

[
\lambda_m=
\int_{t_1}^{t_2}|\phi_m(t)|^2,dt,
]

we obtain

[
a_m=
\frac{1}{\lambda_m}
\int_{t_1}^{t_2}\phi_m^*(t)x(t),dt.
]

This is the general projection formula for orthogonal basis functions. If the basis is orthonormal, then (\lambda_m=1), and

[
a_m=
\int_{t_1}^{t_2}\phi_m^*(t)x(t),dt.
]

This is the reason Fourier coefficients are found by multiplying by a basis function and integrating. The integral is not a memorized trick; it is projection in a function space.

The projection idea also has a direct area interpretation. When a signal is multiplied by a basis function and integrated, the integral measures the net signed area of their product. If the signal truly contains that basis function, the product has a nonzero net area. If the basis function does not match the signal’s structure, positive and negative areas cancel. This is the functional version of saying that one vector has zero projection onto an orthogonal direction.

For example, suppose

[
x(t)=2\sin(t)+0.5\cos(t).
]

If this signal is projected onto the correct basis functions, (\sin(t)) and (\cos(t)), the coefficients are significant: the projections recover the weights (2) and (0.5). The basis functions are actually present in the signal. But if the same signal is projected onto the wrong basis functions, such as (\sin(2t)) and (\cos(2t)), the products oscillate in such a way that the positive and negative areas cancel. The resulting coefficients are zero or nearly zero. This is exactly what orthogonality means in practice: a basis function that is not present in the signal has no surviving projection.

[Graph: Course reader Figure 5, correct basis and wrong basis projection example, should be placed here. Use panel (a) for the correct basis (\sin(t)), (\cos(t)), and panel (b) for the wrong basis (\sin(2t)), (\cos(2t)), where the shaded areas cancel.]

This area-cancellation picture is one of the most important intuitions in Fourier analysis. A Fourier coefficient is not a mysterious number produced by a formula. It is the signed area of a comparison. The signal is multiplied by a candidate basis function, and the integral asks whether the product has a surviving average contribution or whether the oscillations cancel out.

For periodic signals, the natural Fourier basis functions are complex exponentials,

[
e^{jk\omega_0t},
]

where

[
\omega_0=\frac{2\pi}{T}
]

is the fundamental angular frequency of a signal with period (T). The integer (k) selects the harmonic. A periodic signal satisfies

[
x(t)=x(t+T),
]

and it can be represented as

[
x(t)
====

\sum_{k=-\infty}^{\infty}
c_k e^{jk\omega_0t}.
]

Here each exponential (e^{jk\omega_0t}) serves as a basis function for the space of signals with period (T). These exponentials are orthogonal over one period:

[
\int_0^T e^{jm\omega_0t}e^{-jn\omega_0t},dt=0
\qquad m\neq n.
]

To see why, combine the exponentials:

[
e^{jm\omega_0t}e^{-jn\omega_0t}
===============================

e^{j(m-n)\omega_0t}.
]

If (m=n), the exponent is zero and the integral becomes

[
\int_0^T 1,dt=T.
]

If (m\neq n), then

[
\int_0^T e^{j(m-n)\omega_0t},dt
===============================

\left[
\frac{e^{j(m-n)\omega_0t}}{j(m-n)\omega_0}
\right]_0^T.
]

Since (\omega_0T=2\pi),

[
e^{j(m-n)\omega_0T}
===================

# e^{j(m-n)2\pi}

1,
]

so the numerator becomes (1-1=0), and the integral is zero. Therefore different harmonics are orthogonal.

This orthogonality is what allows a Fourier coefficient to isolate one frequency component. To find (c_m), multiply the Fourier series by (e^{-jm\omega_0t}) and integrate over one period:

[
\int_0^T x(t)e^{-jm\omega_0t},dt
================================

\int_0^T
\left(
\sum_{k=-\infty}^{\infty}
c_k e^{jk\omega_0t}
\right)
e^{-jm\omega_0t},dt.
]

Move the summation outside the integral:

[
\int_0^T x(t)e^{-jm\omega_0t},dt
================================

\sum_{k=-\infty}^{\infty}
c_k
\int_0^T e^{j(k-m)\omega_0t},dt.
]

All terms disappear except the one with (k=m). Therefore,

[
\int_0^T x(t)e^{-jm\omega_0t},dt
================================

c_mT.
]

Solving for (c_m) gives

[
c_m=
\frac{1}{T}
\int_0^T x(t)e^{-jm\omega_0t},dt.
]

The factor (1/T) appears because the energy of (e^{jm\omega_0t}) over one period is (T). It is exactly the normalization factor from the general projection formula.

Using Euler’s formula,

[
e^{j\theta}=\cos\theta+j\sin\theta,
]

the same periodic signal can also be written as a sine-cosine Fourier series:

[
x(t)
====

\frac{a_0}{2}
+
\sum_{n=1}^{\infty}
\left[
a_n\cos(n\omega_0t)
+
b_n\sin(n\omega_0t)
\right].
]

The term (a_0/2) is the DC component, or average value. The coefficients are

[
a_n=
\frac{2}{T}
\int_0^T x(t)\cos(n\omega_0t),dt,
]

[
b_n=
\frac{2}{T}
\int_0^T x(t)\sin(n\omega_0t),dt.
]

The factor (2/T) appears because the energy of (\sin(n\omega_0t)) or (\cos(n\omega_0t)) over one period is (T/2). Again, the coefficient formulas are projection formulas.

The sine and cosine functions are also orthogonal over a full period when their frequencies are harmonics of the fundamental frequency. This is crucial because it explains why the sine-cosine Fourier series can isolate each harmonic independently.

Let

[
\omega_0=\frac{2\pi}{T}.
]

Consider two sine functions with harmonic indices (n) and (k):

[
\sin(n\omega_0t)
\qquad \text{and} \qquad
\sin(k\omega_0t).
]

To test whether they are orthogonal, compute

[
\int_0^T \sin(n\omega_0t)\sin(k\omega_0t),dt.
]

Using the identity

[
\sin A\sin B
============

\frac{1}{2}\left[\cos(A-B)-\cos(A+B)\right],
]

we get

[
\int_0^T \sin(n\omega_0t)\sin(k\omega_0t),dt
============================================

\frac{1}{2}
\int_0^T
\left[
\cos((n-k)\omega_0t)
--------------------

\cos((n+k)\omega_0t)
\right]dt.
]

If (n\neq k), both cosine terms complete an integer number of cycles over (0\leq t\leq T), so their integrals vanish. Therefore,

[
\int_0^T \sin(n\omega_0t)\sin(k\omega_0t),dt=0
\qquad n\neq k.
]

If (n=k), then

[
\sin(n\omega_0t)\sin(n\omega_0t)=\sin^2(n\omega_0t),
]

and over one full period the average value of (\sin^2) is (1/2). Therefore,

[
\int_0^T \sin^2(n\omega_0t),dt=\frac{T}{2}.
]

The same reasoning applies to cosine functions. Using

[
\cos A\cos B
============

\frac{1}{2}\left[\cos(A-B)+\cos(A+B)\right],
]

we obtain

[
\int_0^T \cos(n\omega_0t)\cos(k\omega_0t),dt=0
\qquad n\neq k,
]

and

[
\int_0^T \cos^2(n\omega_0t),dt=\frac{T}{2}.
]

Finally, sine and cosine functions are mutually orthogonal. Using

[
\sin A\cos B
============

\frac{1}{2}\left[\sin(A+B)+\sin(A-B)\right],
]

we find that

[
\int_0^T \sin(n\omega_0t)\cos(k\omega_0t),dt=0
]

for harmonic frequencies over a full period. The sine-cosine products oscillate symmetrically, so the positive and negative areas cancel.

This proves the essential trigonometric orthogonality used by Fourier series. Different harmonics do not interfere with one another under the integral. The coefficient of one harmonic can therefore be extracted without contamination from the others.

The quadrature form of the Fourier series writes the same idea over a symmetric interval. Let the period be

[
T=2L.
]

Then a periodic signal may be written as

[
f(t)
====

\frac{a_0}{2}
+
\sum_{n=1}^{\infty}
\left[
a_n\cos\left(\frac{n\pi t}{L}\right)
+
b_n\sin\left(\frac{n\pi t}{L}\right)
\right].
]

Here the basis functions are

[
\cos\left(\frac{n\pi t}{L}\right)
\qquad \text{and} \qquad
\sin\left(\frac{n\pi t}{L}\right),
]

and the fundamental angular frequency is consistent with

[
\omega_0=\frac{2\pi}{T}=\frac{\pi}{L}.
]

The coefficients are obtained by projection over the symmetric interval ([-L,L]):

[
a_n
===

\frac{1}{L}
\int_{-L}^{L}
f(t)\cos\left(\frac{n\pi t}{L}\right),dt,
]

[
b_n
===

\frac{1}{L}
\int_{-L}^{L}
f(t)\sin\left(\frac{n\pi t}{L}\right),dt.
]

The factor (1/L) appears because the energy of each sine or cosine basis function over ([-L,L]) is (L). The DC component requires careful notation. The actual DC value, meaning the average value of the signal over one period, is

[
\frac{a_0}{2}
=============

\frac{1}{T}
\int_{-L}^{L}f(t),dt.
]

Since (T=2L), this is equivalent to

[
a_0=
\frac{1}{L}
\int_{-L}^{L}f(t),dt.
]

This distinction matters. The term that appears in the Fourier series is (a_0/2), which is the average level of the signal. The symbol (a_0) is twice that value in the classical notation.

The quadrature form is especially useful for practical calculation. Periodic signals such as square, rectangular, and sawtooth waves often have symmetry. If a function is even, its sine coefficients vanish because an even function multiplied by an odd sine function gives an odd product whose integral over ([-L,L]) is zero. If a function is odd, its cosine coefficients vanish because an odd function multiplied by an even cosine function gives an odd product. This is why symmetry can greatly reduce the work needed to calculate Fourier coefficients.

[Graph: Course reader Mini-lab/Fourier coefficient figure may be placed here. Use it to show how manually chosen (a_n) and (b_n) coefficients reconstruct different periodic shapes.]

The degree to which an oscillating wave with frequency (\omega) is represented in a signal can be calculated by finding the area under the graph after multiplication. In the Fourier series equations, this area is the overlap between the signal and a candidate sinusoidal function. Each frequency has its own integral result, and that result becomes the coefficient, or weight, of the sinusoid in the reconstructed signal. The actual area of the candidate sinusoid itself is not the point. The important quantity is the computed overlap area after the signal and the sinusoid are multiplied.

[Graph: Course reader Figures 7–10 should be placed here. These show a square wave multiplied by sinusoids of different frequencies and the shaded net-area/cancellation idea.]

Fourier series applies to periodic signals. The spectrum of a periodic signal consists of discrete harmonics: integer multiples of the fundamental frequency. Non-periodic signals require the Fourier transform. The idea remains the same, but the frequency variable becomes continuous. Instead of a sum over harmonics, we use an integral over all frequencies.

There are two common notations for the Fourier transform. Using angular frequency (\omega), measured in radians per second, the transform is written as

[
F(\omega)
=========

\int_{-\infty}^{\infty}
f(t)e^{-j\omega t},dt.
]

Using ordinary frequency (f), measured in hertz, the same idea is written as

[
X(f)
====

\int_{-\infty}^{\infty}
x(t)e^{-j2\pi ft},dt.
]

The two frequency variables are related by

[
\omega=2\pi f.
]

Thus (e^{-j\omega t}) and (e^{-j2\pi ft}) play the same role, but they use different frequency units. In angular-frequency notation, the inverse transform is usually written with a normalization factor:

[
f(t)
====

\frac{1}{2\pi}
\int_{-\infty}^{\infty}
F(\omega)e^{j\omega t},d\omega.
]

In hertz notation, the inverse transform is commonly written as

[
x(t)
====

\int_{-\infty}^{\infty}
X(f)e^{j2\pi ft},df.
]

Both forms express the same principle: the Fourier transform is the continuous-frequency version of the Fourier series. It gives the spectrum of a non-periodic signal. The function (F(\omega)) or (X(f)) tells how the signal is represented in terms of complex exponentials at each frequency.

There is also a useful geometric way to understand what the Fourier transform means. At one chosen frequency (f), the Fourier transform compares the signal with two reference waves at that frequency: a cosine wave and a sine wave. This becomes clear from Euler’s formula,

[
e^{-j2\pi ft}
=============

\cos(2\pi ft)-j\sin(2\pi ft).
]

Substituting this into the Fourier transform gives

[
X(f)
====

## \int_{-\infty}^{\infty}x(t)\cos(2\pi ft),dt

j
\int_{-\infty}^{\infty}x(t)\sin(2\pi ft),dt.
]

The first integral is the net area obtained after multiplying the signal by a cosine wave at frequency (f). This is the real component of (X(f)). Geometrically, it is the horizontal side, or base, of a right triangle in the complex plane. The second integral is the net area obtained after multiplying the signal by a sine wave at the same frequency. Because of the convention (e^{-j2\pi ft}), this sine contribution appears with a minus sign in the imaginary part. Geometrically, it still gives the vertical side, or height, of the triangle, with its sign determining whether the height points upward or downward in the complex plane.

So for each frequency (f), the Fourier transform produces one complex number. That complex number can be drawn as an arrow. The horizontal component is the cosine overlap. The vertical component is the sine overlap, with the sign determined by the Fourier convention. The magnitude

[
|X(f)|
]

is the length of this arrow. In the triangle picture, it is the hypotenuse. It combines the cosine area and sine area through the Pythagorean theorem:

[
|X(f)|
======

\sqrt{
(\text{cosine area})^2+
(\text{sine area})^2
}.
]

The magnitude therefore tells how strongly the signal contains that frequency overall, without caring whether the contribution appears mainly in the cosine direction or mainly in the sine direction.

The phase

[
\angle X(f)
]

is the angle of the same arrow. It tells how the frequency component is aligned between the cosine and sine directions. In other words, phase describes the relative size and sign of the two net areas. If the phase is (0^\circ), the sine contribution is zero, so the triangle has no height and the frequency component lies entirely along the cosine direction. If the phase is (45^\circ) or (-45^\circ), the absolute values of the cosine and sine contributions are equal, giving a (45^\circ)-(45^\circ)-(90^\circ) triangle. A positive or negative phase indicates on which side of the complex plane the vertical component lies. Thus phase is not a mysterious extra quantity; it is the angle that records how the cosine and sine overlaps combine.

This triangle picture makes the Fourier transform less abstract. At each frequency, the transform asks two questions at once: how much does the signal resemble the cosine at that frequency, and how much does it resemble the sine at that frequency? The real and imaginary parts store those two perpendicular measurements. The magnitude gives their combined size. The phase gives their angular balance.

[Graph: Insert a custom geometric figure here. It should show cosine overlap as the horizontal side, sine overlap as the vertical side, magnitude as the hypotenuse, and phase as the angle.]

The same idea can be shown through shaded areas. When a square wave is multiplied by a sinusoid of a matching frequency, the product has a nonzero net area. That nonzero area means the square wave contains a component at that frequency. If the square wave is multiplied by a sinusoid whose frequency does not match a component of the signal, the product oscillates so that positive and negative shaded regions cancel. The integral becomes small or zero.

[Graph: Course reader Figures 7–10 should be placed here. Figure 7 shows a square wave multiplied by a 1 Hz sinusoid with nonzero shaded net area. Figures 8–10 show the same area-correlation idea at different frequencies, including the cancellation case.]

A useful example is a single rectangular pulse,

[
w(t)=
\begin{cases}
1, & |t|<\frac{T}{2},\
0, & \text{otherwise}.
\end{cases}
]

This is not a periodic square wave. It occurs once and does not repeat in time. Therefore, it is represented by a Fourier transform, not by a Fourier series. Using the hertz-frequency convention, its Fourier transform is

[
W(f)
====

\int_{-\infty}^{\infty}w(t)e^{-j2\pi ft},dt.
]

Since (w(t)=1) only on ((-T/2,T/2)),

[
W(f)
====

\int_{-T/2}^{T/2}e^{-j2\pi ft},dt.
]

Integrating gives

[
W(f)
====

\left[
\frac{e^{-j2\pi ft}}{-j2\pi f}
\right]_{-T/2}^{T/2}.
]

Therefore,

[
W(f)
====

\frac{e^{-j\pi fT}-e^{j\pi fT}}{-j2\pi f}.
]

Using

[
e^{-j\alpha}-e^{j\alpha}=-2j\sin\alpha,
]

we obtain

[
W(f)
====

# \frac{-2j\sin(\pi fT)}{-j2\pi f}

\frac{\sin(\pi fT)}{\pi f}.
]

Multiplying and dividing by (T),

[
W(f)
====

T\frac{\sin(\pi fT)}{\pi fT}.
]

With

[
\operatorname{sinc}(x)=\frac{\sin(\pi x)}{\pi x},
]

this becomes

[
W(f)=T\operatorname{sinc}(fT).
]

Thus a rectangular pulse in time has a sinc-shaped spectrum. The pulse is localized in time, but its spectrum spreads across frequency. This example is important because it shows that sharp time-domain features require many frequency components. A sudden edge in time cannot be described by only one sinusoid. It needs a wide combination of sinusoidal basis functions.

[Graph: Course reader Figure 11 should be placed here. It shows a single square pulse and its Fourier transform, which has a sinc-like magnitude spectrum.]

Several properties make the Fourier transform especially useful. Linearity means that the transform of a sum is the sum of the transforms:

[
\mathcal{F}{a x(t)+b y(t)}
==========================

aX(f)+bY(f).
]

This matters because communication signals are often built by adding components, and linearity lets their spectra be handled component by component.

Time shifting changes phase but not magnitude. If

[
x(t) \longleftrightarrow X(f),
]

then

[
x(t-t_0)
\longleftrightarrow
X(f)e^{-j2\pi ft_0}.
]

A delay therefore appears in the frequency domain as a phase factor. The magnitude spectrum remains unchanged. This is physically sensible: delaying a signal does not change which frequencies it contains, but it changes their phase alignment.

Frequency shifting is equally important. Multiplying a signal by a complex exponential shifts its spectrum:

[
x(t)e^{j2\pi f_0t}
\longleftrightarrow
X(f-f_0).
]

This is the mathematical basis of modulation: multiplying by an oscillation moves spectral content to another frequency range.

Time scaling changes the width of the spectrum. If

[
x(t)\longleftrightarrow X(f),
]

then

[
x(at)
\longleftrightarrow
\frac{1}{|a|}X\left(\frac{f}{a}\right).
]

Compressing a signal in time spreads it in frequency, while stretching a signal in time compresses it in frequency. This is another expression of the time-frequency trade-off.

Differentiation in time becomes multiplication by frequency. If

[
x(t)\longleftrightarrow X(f),
]

then

[
\frac{d}{dt}x(t)
\longleftrightarrow
j2\pi fX(f).
]

This property explains why rapid changes in time correspond to stronger high-frequency content. A derivative emphasizes fast variations, and in the frequency domain this appears as multiplication by a factor proportional to frequency.

Convolution is another central property. If two signals are convolved in time,

[
z(t)=x(t)*h(t),
]

then their Fourier transforms multiply:

[
Z(f)=X(f)H(f).
]

This property explains why filters are described by frequency responses. A linear time-invariant system with impulse response (h(t)) modifies the spectrum of an input (x(t)) by multiplication with (H(f)). Frequencies for which (H(f)) is large pass strongly; frequencies for which (H(f)) is small are attenuated.

Multiplication in time corresponds to convolution in frequency:

[
x(t)y(t)
\longleftrightarrow
X(f)*Y(f).
]

This is the dual of the previous property and is fundamental later when sampled or modulated waveforms are analyzed. Multiplying by a sinusoid, for example, does not merely change the amplitude of a signal; it shifts and spreads spectral content according to this multiplication-convolution relationship.

The complete chain is now visible. Signals can be treated as vector-space objects. Finite sample windows belong to (\mathbb{R}^N) or (\mathbb{C}^N), while complete discrete-time signals belong to the infinite-dimensional signal vector space (S). Basis representations allow the same object to be described in different coordinate systems. Orthogonality makes projections independent. Inner products measure overlap. The 3D projection picture explains why coefficients are coordinates along independent directions, and Hilbert space extends that same idea to functions. In finite dimensions, the DFT rewrites a sample block in terms of finite sinusoidal patterns. In function spaces, Fourier series and Fourier transforms rewrite signals in terms of sinusoidal basis functions. The sine and cosine functions are orthogonal over a period when their frequencies are harmonics of the fundamental frequency, which is why each harmonic coefficient can be isolated by integration. The Fourier representation is therefore not a different signal; it is an alternative representation of the same signal, chosen because frequency content is the language in which communication systems, channels, filtering, and modulation become understandable.
