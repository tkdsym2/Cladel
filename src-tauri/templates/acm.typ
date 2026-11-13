// Filonex — ACM-style conference paper template (CHI / UIST and other ACM venues).
//
// An unofficial Typst approximation of the ACM `acmart` LaTeX class:
//   format: "double"  two-column proceedings layout  (acmart "sigconf")
//   format: "single"  single-column manuscript layout (acmart "manuscript",
//                     the layout used for review submissions)
//
// Usage, at the top of the first Note connected to a render node:
//
//   #import "acm.typ": acm
//   #show: acm.with(
//     format: "double",
//     title: [My Paper],
//     authors: ((name: "A. Author", affiliation: "Univ.", location: "City, Country", email: "a@example.org"),),
//     abstract: [...],
//     keywords: ("one", "two"),
//   )
//
// Always check the venue's current call for papers before submitting.

#let _serif = ("Libertinus Serif", "Liberation Serif", "Noto Serif JP")
#let _sans = ("Liberation Sans", "Noto Sans CJK JP")

#let _default-conference = (
  short: "Conference acronym 'XX",
  name: "Proceedings of the Conference Title",
  date: "Month DD–DD, YYYY",
  location: "City, Country",
)

// "A", "A and B", "A, B, and C"
#let _join-names(names) = {
  if names.len() == 0 { "" } else if names.len() == 1 { names.at(0) } else if names.len() == 2 {
    names.at(0) + " and " + names.at(1)
  } else { names.slice(0, -1).join(", ") + ", and " + names.at(-1) }
}

#let acm(
  // "double" = two-column proceedings, "single" = single-column manuscript.
  format: "double",
  title: [Paper Title],
  subtitle: none,
  // Array of dictionaries: (name:, affiliation:, location:, email:) — all but `name` optional.
  authors: (),
  abstract: none,
  // CCS concepts as content, e.g. [• *Human-centered computing* → Interactive systems and tools.]
  ccs: none,
  // Array of strings / content.
  keywords: (),
  // A figure spanning the full width under the authors (two-column format).
  teaser: none,
  // (short:, name:, date:, location:) — used in running heads and the reference format.
  conference: (:),
  year: auto,
  // Text for the note at the bottom of the first page (rights / permission block). none = omitted.
  copyright: none,
  doi: none,
  // Review submission: line numbers + page numbers.
  review: false,
  // Hide author names and affiliations (anonymous submission).
  anonymous: false,
  // Short title for the running head (defaults to the title).
  short-title: none,
  body,
) = {
  assert(format in ("double", "single"), message: "acm: format must be \"double\" or \"single\"")
  let double = format == "double"
  let conf = _default-conference + conference
  let year = if year == auto { datetime.today().year() } else { year }

  let shown-authors = if anonymous {
    ((name: "Anonymous Author(s)", affiliation: "Affiliation withheld for review"),)
  } else { authors }
  let names = shown-authors.map(a => a.name)
  let head-authors = if names.len() == 0 { "" } else if names.len() <= 2 { _join-names(names) } else {
    names.at(0) + " et al."
  }
  let head-title = if short-title != none { short-title } else { title }
  let conf-line = conf.short + ", " + conf.date + ", " + conf.location

  // ── Sizes ──
  let body-size = if double { 9pt } else { 10pt }
  let leading = if double { 0.52em } else { 0.62em }
  let small = if double { 7.5pt } else { 8.5pt }

  set document(title: title, author: names)
  set text(font: _serif, size: body-size, lang: "en")
  set par(justify: true, leading: leading, spacing: leading, first-line-indent: 10pt)

  // ── Page ──
  let header = context {
    let n = here().page()
    if n == 1 { return }
    set text(font: _sans, size: 8pt)
    if double {
      if calc.even(n) { [#conf-line #h(1fr) #head-authors] } else { [#head-title #h(1fr) #conf-line] }
    } else {
      if calc.even(n) { [#n #h(1fr) #head-authors] } else { [#head-title #h(1fr) #n] }
    }
  }
  let footer = if double {
    if review { align(center, text(font: _sans, size: 8pt, context counter(page).display())) }
  } else {
    align(center, text(font: _sans, size: 7pt)[
      #if review [Manuscript submitted to ACM] else [#conf-line]
    ])
  }
  set page(
    paper: "us-letter",
    margin: if double { (x: 54pt, top: 76pt, bottom: 76pt) } else { (x: 1.3in, top: 1.25in, bottom: 1.25in) },
    columns: if double { 2 } else { 1 },
    header: header,
    header-ascent: if double { 22pt } else { 26pt },
    footer: footer,
  )
  set columns(gutter: 24pt)
  set par.line(numbering: n => text(font: _sans, size: 6pt, fill: luma(110))[#n]) if review

  // ── Headings ──
  set heading(numbering: "1.1")
  show heading: it => {
    set par(first-line-indent: 0pt, justify: false)
    let size = if it.level == 1 { if double { 11pt } else { 10pt } } else { body-size + 1pt * calc.max(0, 2 - it.level) }
    let num = if it.numbering != none { counter(heading).display(it.numbering) + h(0.9em) }
    let label = if it.level == 1 { upper(it.body) } else { it.body }
    let style = if it.level >= 3 { "italic" } else { "normal" }
    let weight = if it.level >= 3 { "regular" } else { "bold" }
    block(
      above: if it.level == 1 { 1.25em } else { 1.05em },
      below: 0.6em,
      sticky: true,
      text(font: _sans, size: size, weight: weight, style: style, hyphenate: false)[#num#label],
    )
  }

  // ── Figures, tables, equations, lists ──
  set figure(gap: 0.8em)
  show figure: set block(spacing: 1.3em)
  show figure.caption: it => {
    set text(size: body-size)
    set par(justify: true, first-line-indent: 0pt, leading: leading)
    align(if double { left } else { center }, block[
      #text(weight: "bold")[#it.supplement #context it.counter.display(it.numbering):] #it.body
    ])
  }
  show figure.where(kind: table): set figure.caption(position: top)
  show figure.where(kind: table): set text(size: body-size - 1pt)
  set table(stroke: none, inset: (x: 5pt, y: 3pt))
  set math.equation(numbering: "(1)")
  show math.equation.where(block: true): set block(above: 0.9em, below: 0.9em)
  set list(indent: 10pt, body-indent: 5pt, spacing: leading)
  set enum(indent: 10pt, body-indent: 5pt, spacing: leading)
  set footnote.entry(separator: line(length: 30%, stroke: 0.4pt))
  show footnote.entry: set text(size: small)
  show raw: set text(size: 0.9em)

  // ── References ──
  set bibliography(title: "References")
  show bibliography: set text(size: small)
  show bibliography: set par(leading: 0.5em, spacing: 0.55em, first-line-indent: 0pt, justify: true)

  // ── Front matter pieces ──
  let ccs-line = if ccs != none [• #ccs]
  let keyword-line = keywords.join(", ")
  let reference-format = {
    set text(size: small)
    set par(first-line-indent: 0pt, leading: 0.5em)
    [*ACM Reference Format:* \ ]
    [#_join-names(names). #year. #title#if subtitle != none [: #subtitle]. In _#conf.name (#conf.short), #conf.date, #conf.location._ ACM, New York, NY, USA.]
    if doi != none [ #link("https://doi.org/" + doi)]
  }
  let rights-note = if copyright != none {
    place(bottom, float: true, clearance: 0.9em, {
      set text(size: if double { 7pt } else { 8pt })
      set par(first-line-indent: 0pt, leading: 0.45em, spacing: 0.45em, justify: true)
      line(length: 100%, stroke: 0.4pt)
      v(-0.35em)
      copyright
      parbreak()
      [_#conf.short, #conf.location _]
      if doi != none { linebreak(); link("https://doi.org/" + doi) }
    })
  }

  if double {
    // Title + authors (+ teaser) span both columns.
    place(top + center, scope: "parent", float: true, clearance: 1.6em, {
      set par(first-line-indent: 0pt, justify: false, leading: 0.5em, spacing: 0.5em)
      set align(center)
      text(font: _sans, size: 17.28pt, weight: "bold", hyphenate: false, title)
      if subtitle != none {
        v(0.2em)
        text(font: _sans, size: 12pt, hyphenate: false, subtitle)
      }
      v(1.1em)
      let n = shown-authors.len()
      if n > 0 {
        let per-row = if n <= 4 { n } else if n in (5, 6, 9) { 3 } else { 4 }
        grid(
          columns: (1fr,) * per-row,
          column-gutter: 12pt,
          row-gutter: 1.4em,
          ..shown-authors.map(a => {
            text(size: 12pt, a.name)
            set text(size: 10pt)
            for key in ("affiliation", "location", "email") {
              if key in a and a.at(key) != none { linebreak(); a.at(key) }
            }
          }),
        )
      }
      if teaser != none {
        v(1.4em)
        teaser
      }
    })

    if abstract != none {
      heading(numbering: none, outlined: false)[Abstract]
      abstract
    }
    if ccs != none {
      heading(numbering: none, outlined: false)[CCS Concepts]
      ccs-line
    }
    if keywords.len() > 0 {
      heading(numbering: none, outlined: false)[Keywords]
      keyword-line
    }
    v(0.7em)
    reference-format
    rights-note
  } else {
    // Manuscript: left-aligned title block, abstract without a heading.
    {
      set par(first-line-indent: 0pt, justify: false, leading: 0.55em, spacing: 0.7em)
      text(font: _sans, size: 14.4pt, weight: "bold", hyphenate: false, title)
      if subtitle != none {
        parbreak()
        text(font: _sans, size: 11pt, hyphenate: false, subtitle)
      }
      v(1.1em)
      for a in shown-authors {
        text(font: _sans, size: 10pt, upper(a.name))
        let rest = ("affiliation", "location").filter(k => k in a and a.at(k) != none).map(k => a.at(k))
        if rest.len() > 0 [, #rest.join(", ")]
        parbreak()
      }
    }
    v(1em)
    {
      set par(first-line-indent: 0pt, spacing: 0.9em)
      if teaser != none { teaser }
      if abstract != none { abstract; parbreak() }
      if ccs != none [CCS Concepts: #ccs-line #parbreak()]
      if keywords.len() > 0 [Additional Key Words and Phrases: #keyword-line #parbreak()]
      reference-format
    }
    rights-note
    v(0.6em)
  }

  body
}
