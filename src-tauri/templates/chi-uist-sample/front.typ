// CHI / UIST style paper (ACM two-column) — front matter.
// Change `format` below to "single" for the single-column review manuscript.
#import "acm.typ": acm

#let title = [ThoughtWeave: Layered Knowledge Graphs for Sensemaking in Literature Reviews]

#let abstract = [
  Researchers synthesizing a body of literature must repeatedly move between reading, organizing, and writing, yet most tools support only one of these activities. We present ThoughtWeave, a thought-mapping environment in which papers, notes, figures, and tables are nodes of a layered knowledge graph and a manuscript is rendered directly from the connected notes. In a within-subjects study with 24 graduate students, ThoughtWeave reduced synthesis time by 24% and perceived workload by 26% compared with a reference manager paired with a word processor, while participants integrated more sources into their drafts.
]

#let teaser = [
  #figure(
    image("@image_1", width: 100%),
    caption: [ThoughtWeave workflow. (a) Papers, notes, and figures are arranged as a layered knowledge graph around a core idea. (b) Notes are written in Typst and reference graph nodes directly. (c) Connected notes are compiled into a camera-ready paper.],
  ) <fig:teaser>
]

#show: acm.with(
  format: "double",
  title: title,
  authors: (
    (name: "Aiko Tanaka", affiliation: "Example University", location: "Tokyo, Japan", email: "aiko@example.org"),
    (name: "Jordan Lee", affiliation: "Example Institute of Technology", location: "Cambridge, MA, USA", email: "jlee@example.org"),
    (name: "María García", affiliation: "Example Research Lab", location: "Barcelona, Spain", email: "maria@example.org"),
  ),
  abstract: abstract,
  ccs: [*Human-centered computing* → Interactive systems and tools; Empirical studies in HCI.],
  keywords: ("sensemaking", "knowledge graphs", "literature review", "writing tools"),
  teaser: teaser,
  conference: (
    short: "Conference acronym 'XX",
    name: "Proceedings of the Sample Conference on Human Factors in Computing Systems",
    date: "April 13–17, 2026",
    location: "Barcelona, Spain",
  ),
  year: 2026,
  copyright: [Sample document distributed with Filonex. The system evaluation, participants, and all numbers reported here are fictitious placeholders that only illustrate the template.],
)
