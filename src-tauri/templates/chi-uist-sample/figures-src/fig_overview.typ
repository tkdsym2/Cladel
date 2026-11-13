// Source of fig_overview.png (teaser figure of the CHI/UIST sample).
// Rebuild: typst compile --ppi 300 fig_overview.typ ../fig_overview.png
#set page(width: 520pt, height: 150pt, margin: 0pt, fill: white)
#set text(font: "Libertinus Serif", size: 7pt, fill: rgb("#1f2937"))

#let card(x, y, w, h, fill, stroke, label, dark: false) = place(top + left, dx: x, dy: y,
  rect(width: w, height: h, radius: 3pt, fill: fill, stroke: 0.8pt + stroke, inset: 4pt,
    align(left + top, text(size: 6pt, weight: "bold", fill: if dark { white } else { stroke }, label))))
#let wire(x1, y1, x2, y2) = place(top + left, curve(
  stroke: (paint: rgb("#94a3b8"), thickness: 1.1pt, cap: "round"),
  curve.move((x1, y1)),
  curve.cubic((x1 + (x2 - x1) * 0.45, y1), (x2 - (x2 - x1) * 0.45, y2), (x2, y2)),
))
#let panel(x, w, tag, title) = {
  place(top + left, dx: x, dy: 6pt, rect(width: w, height: 138pt, radius: 5pt, fill: rgb("#f8fafc"), stroke: 0.6pt + rgb("#cbd5e1")))
  place(top + left, dx: x + 7pt, dy: 12pt, text(size: 8pt, weight: "bold")[#box(fill: rgb("#1e3a5f"), radius: 2pt, inset: (x: 3pt, y: 1.5pt), text(fill: white, tag)) #h(2pt) #title])
}
#let lines(x, y, widths, gap: 5pt, color: rgb("#cbd5e1")) = for (i, w) in widths.enumerate() {
  place(top + left, dx: x, dy: y + i * gap, rect(width: w, height: 1.8pt, radius: 1pt, fill: color))
}
#let arrow(x) = place(top + left, dx: x, dy: 68pt, text(size: 16pt, fill: rgb("#64748b"), sym.arrow.r.filled))

// ── (a) Map ──
#panel(6pt, 232pt, "a", "Map: layered knowledge graph")
#wire(62pt, 60pt, 88pt, 86pt)
#wire(62pt, 112pt, 88pt, 86pt)
#wire(138pt, 86pt, 164pt, 58pt)
#wire(138pt, 86pt, 164pt, 112pt)
#wire(62pt, 60pt, 164pt, 50pt)
#card(14pt, 46pt, 48pt, 28pt, rgb("#f0fdf4"), rgb("#059669"), "Paper")
#card(14pt, 98pt, 48pt, 28pt, rgb("#f0fdf4"), rgb("#059669"), "Paper")
#card(88pt, 70pt, 50pt, 32pt, rgb("#1e3a5f"), rgb("#1e40af"), "Core idea", dark: true)
#card(164pt, 38pt, 54pt, 32pt, rgb("#fffbeb"), rgb("#d97706"), "Note")
#card(164pt, 96pt, 54pt, 32pt, rgb("#f0fdfa"), rgb("#0891b2"), "Figure")
#lines(20pt, 60pt, (30pt, 22pt))
#lines(20pt, 112pt, (26pt, 32pt))
#lines(170pt, 52pt, (40pt, 34pt, 38pt), gap: 4.5pt, color: rgb("#fcd34d"))
#place(top + left, dx: 172pt, dy: 110pt, polygon(fill: rgb("#67e8f9"), (0pt, 14pt), (12pt, 2pt), (20pt, 9pt), (28pt, 0pt), (38pt, 14pt)))

#arrow(241pt)

// ── (b) Write ──
#panel(262pt, 118pt, "b", "Write: notes in Typst")
#place(top + left, dx: 270pt, dy: 30pt, rect(width: 102pt, height: 106pt, radius: 3pt, fill: white, stroke: 0.6pt + rgb("#d97706"), inset: 6pt,
  text(font: "DejaVu Sans Mono", size: 5.4pt, fill: rgb("#374151"))[
    #text(fill: rgb("#b45309"), weight: "bold")[= Introduction] \
    Sensemaking is costly \
    #text(fill: rgb("#059669"))[{\@pirolli2005}]. We \
    propose a layered map. \ \
    #text(fill: rgb("#0891b2"))[{{\@image_1}}] \ \
    #text(fill: rgb("#7c3aed"))[\$ R = L / (S + C) \$] \ \
    #text(fill: rgb("#0f766e"))[{\@table_1[1,2]}] min
  ]))

#arrow(383pt)

// ── (c) Render ──
#panel(404pt, 110pt, "c", "Render: paper PDF")
#place(top + left, dx: 424pt, dy: 30pt, rect(width: 72pt, height: 106pt, fill: white, stroke: 0.6pt + rgb("#9333ea")))
#place(top + left, dx: 437pt, dy: 36pt, rect(width: 46pt, height: 3pt, radius: 1pt, fill: rgb("#334155")))
#lines(445pt, 43pt, (30pt,), color: rgb("#94a3b8"))
#place(top + left, dx: 430pt, dy: 50pt, rect(width: 60pt, height: 20pt, fill: rgb("#e0f2fe"), stroke: 0.4pt + rgb("#7dd3fc")))
#lines(430pt, 76pt, (28pt, 28pt, 24pt, 28pt, 28pt, 20pt, 28pt, 28pt, 26pt, 28pt, 16pt), gap: 5pt)
#lines(462pt, 76pt, (28pt, 26pt, 28pt, 28pt, 22pt), gap: 5pt)
#place(top + left, dx: 462pt, dy: 103pt, rect(width: 28pt, height: 14pt, fill: rgb("#f3e8ff"), stroke: 0.4pt + rgb("#d8b4fe")))
#lines(462pt, 121pt, (28pt, 24pt), gap: 5pt)
