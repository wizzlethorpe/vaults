---
title: Math
---

LaTeX renders at build time with [KaTeX](https://katex.org/), using the same `$…$` and `$$…$$` syntax Obsidian uses. No plugin and no client-side JavaScript. The deploy ships plain HTML and a stylesheet.

## Inline

Written as `The set $\{x \in \mathbb{N} : x < n\}$ has $n$ elements.`, this renders as:

The set $\{x \in \mathbb{N} : x < n\}$ has $n$ elements.

## Display

A `$$…$$` block on its own lines becomes a centred display equation:

$$
T(n) = 2\,T\!\left(\frac{n}{2}\right) + \Theta(n) = \Theta(n \log n)
$$

Multi-line environments work too:

$$
\begin{aligned}
\Pr[X = k] &= \binom{n}{k}\, p^{k} (1-p)^{n-k} \\
\mathbb{E}[X] &= np
\end{aligned}
$$

## Notes

- Math parses before emphasis, so the underscores in `$a_i + b_j$` stay subscripts instead of turning into italics: $a_i + b_j$.
- Math inside a fenced code block is left alone, so the syntax can be documented without rendering.
- The KaTeX stylesheet and its fonts ship only to vaults that contain math.
