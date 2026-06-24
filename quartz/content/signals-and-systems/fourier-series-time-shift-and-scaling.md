---
title: "Fourier Series Time Shift and Scaling"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 15"]
related: ["fourier-series-coefficients-and-line-spectra", "periodic-signals-and-harmonics", "spectrum-representation-of-sums-of-sinusoids"]
tags: ["fourier-coefficients", "time-shift", "dc-component", "piecewise-constant-signal", "scaling", "t-0"]
source_images: ["/signals-and-systems/assets/signals-and-systems-full-notes-page-015.png"]
---

## Fourier Series Time Shift and Scaling

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 15

The notes include a worked Fourier-series problem for a periodic piecewise constant signal and then apply scaling, shifting, and DC offset to obtain new coefficients. The signal has period $T_0=4$ and is defined as $x(t)=2$ for $-1\le t\le1$, $x(t)=1$ for $1\le t\le2$, and $x(t)=0$ for $2\le t\le3$. Its DC coefficient is computed from area as $a_0=\frac{1}{4}(2\cdot2+1)=5/4$. The nonzero-harmonic coefficients are derived by integrating each constant segment against $e^{-j(2\pi/T_0)kt}$. Then a transformed signal $y(t)=2x(t-1)+1/2$ is expressed in Fourier series by replacing $t$ with $t-1$, which multiplies each harmonic coefficient by $e^{-j(2\pi/T_0)k}$. Since $T_0=4$, this exponential factor becomes $e^{-j\pi k/2}=(-j)^k$. The resulting coefficients are $B_k=2a_k(-j)^k$ for $k\ne0$, while the new DC value is $B_0=2a_0+1/2=3$.

### Source snapshots

![Signals and Systems full notes Page 15](/signals-and-systems/assets/signals-and-systems-full-notes-page-015.png)

### Page-grounded details

#### Page 15

10/ some question, page:

[Diagram: rectangular periodic-looking graph of x(t) versus t. Horizontal axis labeled t with marks -1, 0, 1, 2, 3. Vertical axis has levels 1 and 2. The signal is 2 from t = -1 to t = 1, then 1 from t = 1 to t = 2, then 0 from t = 2 to t = 3, with a jump back up to 2 at t = 3.]

Solution:  x(t) = { 2 for -1 <= t <= 1
                  1 for 1 <= t <= 2
                  0 for 2 <= t <= 3        T_0 = 4

DC component  a_0 = 1/T_0 ∫_0ᵀ^0 x(t)dt

= 1/4 (2*2 + 1) = 5/4    ∴ a_0 = 5/4

aₖ = 1/T_0 ∫_0ᵀ^0 x(t)e^(-j(2π/T_0)kt) dt

= 1/T_0 ( ∫₋_1^1 4e^(-j(2π/T_0)kt) dt + ∫_1^2 e^(-j(2π/T_0)kt) dt + ∫_2^3 0 e^(-j(2π/T_0)kt) dt )

= 1/4 ( [ 4*4*e^(-j(π/2)kt) / -2πkj ]₋_1^1  +  [ 4e^(-j(π/2)kt) / -2πkj ]_1^2 )

= 2e^(-jπ/2 k) / -jπkj  -  ( 2e^(+jπ/2 k) / -πkj )
  + ( e^(-jπk) / -2πkj  -  e^(-jπ/2 k) / -2πkj )

= 1 / -2πkj ( 4(-j)ᵏ - 4(j)ᵏ + (-1)ᵏ - (-j)ᵏ )

= 1 / -2πkj ( 3(j)ᵏ - 4jᵏ + (-1)ᵏ )

Now since the fourier coefficients for y(t) = 2x(t-1) + 1/2

= 2 ( sumₖ₌₋∞^∞ aₖ e^(j(2π/T_0)k(t-1)) + a_0 ) + 1/2

= 2 ( sumₖ₌₋∞^∞ aₖ e^(j(2π/T_0)kt) * e^(-j(2π/T_0)k) + a_0 ) + 1/2

y(t) = sumₖ₌₋∞^∞ 2aₖ(-j)ᵏ  + 2*5/4 + 1/2
                               [underbrace] + 3

∴ Bₖ

[Truncated for analysis]

### Key points

- The piecewise constant example has period $T_0=4$
- $x(t)=2$ on $-1\le t\le1$, $1$ on $1\le t\le2$, and $0$ on $2\le t\le3$
- The DC coefficient is $a_0=5/4$
- Nonzero Fourier coefficients come from integrating each interval separately
- A time shift $x(t-1)$ multiplies harmonic coefficients by $e^{-j(2\pi/T_0)k}$
- For $T_0=4$, the shift factor is $(-j)^k$
- Scaling by $2$ multiplies nonzero coefficients by $2$
- Adding $1/2$ changes only the DC coefficient, giving $B_0=3$

### Related topics

- [[fourier-series-coefficients-and-line-spectra|Fourier Series Coefficients and Line Spectra]]
- [[periodic-signals-and-harmonics|Periodic Signals and Harmonics]]
- [[spectrum-representation-of-sums-of-sinusoids|Spectrum Representation of Sums of Sinusoids]]

### Relationships

- applies-to: [[fourier-series-coefficients-and-line-spectra|Fourier Series Coefficients and Line Spectra]]
