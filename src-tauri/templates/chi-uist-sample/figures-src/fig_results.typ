// Source of fig_results.png (workload chart of the CHI/UIST sample).
// Rebuild: typst compile --ppi 300 fig_results.typ ../fig_results.png
#set page(width: 250pt, height: 138pt, margin: 0pt, fill: white)
#set text(font: "Libertinus Serif", size: 7pt, fill: rgb("#1f2937"))

// (label, baseline mean, baseline sd, system mean, system sd) — fictitious sample data.
#let data = (
  ("Mental", 62, 14, 47, 15),
  ("Physical", 21, 10, 19, 9),
  ("Temporal", 58, 16, 44, 14),
  ("Perform.", 41, 15, 30, 12),
  ("Effort", 60, 13, 45, 14),
  ("Frustr.", 49, 17, 31, 13),
)
#let x0 = 30pt
#let y0 = 122pt
#let plot-h = 96pt
#let plot-w = 212pt
#let sy(v) = v / 100 * plot-h
#let c-base = rgb("#94a3b8")
#let c-sys = rgb("#2563eb")

// Grid + y axis
#for v in (0, 25, 50, 75, 100) {
  place(top + left, dx: x0, dy: y0 - sy(v), line(length: plot-w, stroke: 0.4pt + rgb("#e2e8f0")))
  place(top + left, dx: 0pt, dy: y0 - sy(v) - 3pt, box(width: x0 - 4pt, align(right, text(size: 6.5pt, str(v)))))
}
#place(top + left, dx: 2pt, dy: y0 - plot-h / 2 + 22pt, rotate(-90deg, origin: top + left, text(size: 7pt)[NASA-TLX score]))
#place(top + left, dx: x0, dy: y0, line(length: plot-w, stroke: 0.7pt + rgb("#475569")))

#let bar(x, mean, sd, color) = {
  place(top + left, dx: x, dy: y0 - sy(mean), rect(width: 12pt, height: sy(mean), fill: color))
  let cx = x + 6pt
  place(top + left, dx: cx, dy: y0 - sy(mean + sd), line(angle: 90deg, length: sy(2 * sd), stroke: 0.6pt + rgb("#1f2937")))
  place(top + left, dx: cx - 2.5pt, dy: y0 - sy(mean + sd), line(length: 5pt, stroke: 0.6pt + rgb("#1f2937")))
  place(top + left, dx: cx - 2.5pt, dy: y0 - sy(mean - sd), line(length: 5pt, stroke: 0.6pt + rgb("#1f2937")))
}
#let group-w = plot-w / data.len()
#for (i, d) in data.enumerate() {
  let gx = x0 + i * group-w + (group-w - 26pt) / 2
  bar(gx, d.at(1), d.at(2), c-base)
  bar(gx + 14pt, d.at(3), d.at(4), c-sys)
  place(top + left, dx: x0 + i * group-w, dy: y0 + 4pt, box(width: group-w, align(center, text(size: 6.5pt, d.at(0)))))
}

// Legend
#place(top + left, dx: x0 + 4pt, dy: 6pt, box[
  #box(width: 7pt, height: 7pt, fill: c-base, baseline: 1pt) #h(2pt) Baseline
  #h(10pt)
  #box(width: 7pt, height: 7pt, fill: c-sys, baseline: 1pt) #h(2pt) ThoughtWeave
])
