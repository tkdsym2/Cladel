// CHI / UIST style paper (ACM template).
// format: "double" = two-column proceedings layout, "single" = single-column manuscript for review.
#import "acm.typ": acm

#let title = [Paper Title]

#let abstract = [
  Summarize the problem, your approach, and the main findings in about 150 words.
]

#show: acm.with(
  format: "double",
  title: title,
  authors: (
    (name: "First Author", affiliation: "Affiliation", location: "City, Country", email: "first@example.org"),
    (name: "Second Author", affiliation: "Affiliation", location: "City, Country", email: "second@example.org"),
  ),
  abstract: abstract,
  ccs: [*Human-centered computing* → Human computer interaction (HCI).],
  keywords: ("keyword one", "keyword two", "keyword three"),
  conference: (
    short: "Conference acronym 'XX",
    name: "Proceedings of the Conference Title",
    date: "Month DD–DD, YYYY",
    location: "City, Country",
  ),
  // review: true,     // line numbers for review submissions
  // anonymous: true,  // hide authors for anonymous review
)

= Introduction

// Graph references (resolved when the render node compiles this note):
//   cite a paper node ........ {@citation_key}   or   {@key_a; @key_b}
//   insert an image node ..... {{@image_1}}
//   one table cell ........... {@table_1[1,2]}
// Type / on an empty line to pull content from connected nodes.
Write your introduction here.

= Related Work

== A Subsection

Position your work against prior research.

= Method

Inline math such as $a^2 + b^2 = c^2$ and numbered equations are supported:

$ x = (-b plus.minus sqrt(b^2 - 4 a c)) / (2 a) $ <eq:example>

Refer to it as @eq:example.

= Results

#figure(
  table(
    columns: 3,
    table.hline(),
    table.header[*Condition*][*Mean*][*SD*],
    table.hline(stroke: 0.5pt),
    [A], [1.0], [0.1],
    [B], [2.0], [0.2],
    table.hline(),
  ),
  caption: [An example table.],
) <tab:example>

@tab:example shows an example table.

// A figure with adjustable width (connect an image node first):
//   #figure(image("@image_1", width: 100%), caption: [Caption.]) <fig:example>
// Add `placement: top, scope: "parent"` to span both columns.

= Discussion

= Conclusion
