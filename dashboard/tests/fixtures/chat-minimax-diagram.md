This is the **minimax game tree** for the example. White chooses between moves A and B, then Black chooses a reply to minimize White's score.

<box border radius="xl" padding={3} gap={2}>
  <svg viewBox="0 0 680 405" width="100%" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="currentColor" strokeWidth="1.7" opacity="0.55">
      <path d="M340 75 L170 154 M340 75 L510 154"/>
      <path d="M170 205 L88 302 M170 205 L252 302"/>
      <path d="M510 205 L428 302 M510 205 L592 302"/>
    </g>
    <g fontSize="14" fill="currentColor" textAnchor="middle">
      <text x="231" y="108">Move A</text><text x="450" y="108">Move B</text>
    </g>
    <rect x="247" y="12" width="186" height="64" rx="13" fill="#DCEAFE" stroke="#7397D6"/>
    <g textAnchor="middle" fill="#1B437A"><text x="340" y="36" fontSize="15" fontWeight="600">White to move</text><text x="340" y="56" fontSize="13">MAX</text></g>
    {#each [{x:80,score:"−5",move:"A"},{x:420,score:"+1",move:"B"}] as n}
      <rect x={n.x} y="154" width="180" height="54" rx="12" fill="#F1E6FE" stroke="#B398E0"/>
      <text x={n.x+90} y="175" fill="#563283" textAnchor="middle" fontSize="14" fontWeight="600">Black chooses MIN</text>
      <text x={n.x+90} y="195" fill="#563283" textAnchor="middle" fontSize="13">{n.score}</text>
    {/each}
    {#each [{x:33,v:"+9",c:"#287C56",bg:"#DDF4E8",label:"Reply A1"},{x:197,v:"−5",c:"#B34141",bg:"#FBE5E5",label:"Reply A2"},{x:373,v:"+2",c:"#287C56",bg:"#DDF4E8",label:"Reply B1"},{x:537,v:"+1",c:"#287C56",bg:"#DDF4E8",label:"Reply B2"}] as n}
      <rect x={n.x} y="302" width="110" height="62" rx="10" fill={n.bg} stroke={n.c} strokeWidth="1.5"/>
      <text x={n.x+55} y="326" textAnchor="middle" fontSize="12" fill={n.c}>{n.label}</text>
      <text x={n.x+55} y="350" textAnchor="middle" fontSize="21" fontWeight="700" fill={n.c}>{n.v}</text>
    {/each}
    <rect x="459" y="218" width="102" height="26" rx="13" fill="#DDF4E8" stroke="#287C56"/>
    <text x="510" y="236" textAnchor="middle" fontSize="12" fontWeight="600" fill="#287C56">Best choice</text>
    <text x="340" y="395" textAnchor="middle" fill="currentColor" fontSize="13">Scores are evaluated from White's perspective.</text>
  </svg>
</box>

Black takes the minimum score for each move:

- Move A: \(\min(9,-5)=-5\)
- Move B: \(\min(2,1)=1\)

White then takes the maximum:

\[
\boxed{\max(-5,1)=1 \quad\Rightarrow\quad \text{Choose B}}
\]

This is a two-ply tree: one move by White and one reply by Black. Deeper minimax trees alternate MAX and MIN at each level, propagating scores upward from the leaves.
