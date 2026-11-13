= Introduction

Scholars have long imagined tools that externalize the associative trails of thought. Bush's memex {@bush1945} and Engelbart's framework for augmenting human intellect {@engelbart1962} both describe a workspace in which documents are linked by the reader's own reasoning. Today, a literature review is still spread across a reference manager, a note-taking application, and a word processor. Each transition between these tools discards structure: the reason a paper was saved is lost by the time it is cited.

Sensemaking research explains why this fragmentation is costly. Analysts alternate between a foraging loop, in which sources are gathered and filtered, and a synthesis loop, in which a schema is built and revised {@pirolli2005}. The representation used to hold intermediate results determines how expensive each revision is {@russell1993}. We therefore ask: _what if the representation used for organizing sources were also the manuscript?_

This paper contributes (1) ThoughtWeave, a system that stores papers, notes, figures, and tables as nodes of a layered knowledge graph (@fig:teaser); (2) a pipeline that compiles connected notes into a formatted paper; and (3) a controlled study of both.

= Related Work

Russell et al. {@russell1993} characterize sensemaking as a search for a representation that lowers the cost of a task, and Pirolli and Card {@pirolli2005} identify leverage points where tools can help, such as shifting attention between evidence and schema. Shneiderman's mantra of "overview first, zoom and filter, then details on demand" {@shneiderman1996} motivates our use of a zoomable canvas. Concept maps make relations between ideas explicit {@novak1984}, but they are typically abandoned once drafting begins. ThoughtWeave instead treats the map as the source of the document.

= ThoughtWeave

== Layered Knowledge Graph

Each project is a stack of _layers_, and each layer holds a _core_ node that states the current thesis. Paper nodes carry bibliographic metadata, note nodes carry prose, and image and table nodes carry evidence. Edges are weighted from 1 to 5. A new layer inherits the core, preserving earlier stages of thinking.

== From Graph to Manuscript

A _render_ node compiles all notes connected to it, ordered by their position on the canvas. Inside a note, a citation is a reference to a paper node, a figure is a reference to an image node, and a number may be a reference to a single table cell. Updating a table node thus updates every sentence that reports it.

== Sensemaking Gain

To reason about when the graph pays off, we follow the cost-structure view of sensemaking {@russell1993} and define the gain rate of a review session as

$ G = (sum_(i=1)^n w_i q_i) / (t_"forage" + t_"synth") $ <eq:gain>

where $q_i in [0, 1]$ is the rated quality of the $i$-th integrated source, $w_i$ is the weight of its strongest edge, and the denominator is the time spent foraging and synthesizing. ThoughtWeave targets $t_"synth"$ by removing the transcription step between outline and draft.

= Evaluation

== Method

We recruited 24 graduate students. In a within-subjects design, participants wrote a one-page synthesis of 15 provided papers with ThoughtWeave and with a baseline consisting of a reference manager and a word processor. Tool order and paper set were counterbalanced. After each condition, participants completed the NASA-TLX {@hart1988} and the System Usability Scale {@brooke1996}. Two blind raters counted the sources integrated into each draft.

Completion time was analyzed with a paired $t$-test. Questionnaire data were analyzed with the aligned rank transform {@wobbrock2011}.

== Results

#figure(
  table(
    columns: (1fr, auto, auto, auto),
    align: (left, right, right, right),
    table.hline(stroke: 0.8pt),
    table.header[*{@table_1[0,0]}*][*{@table_1[0,1]}*][*{@table_1[0,2]}*][*{@table_1[0,3]}*],
    table.hline(stroke: 0.5pt),
    [{@table_1[1,0]}], [{@table_1[1,1]}], [{@table_1[1,2]}], [{@table_1[1,3]}],
    [{@table_1[2,0]}], [{@table_1[2,1]}], [{@table_1[2,2]}], [{@table_1[2,3]}],
    [{@table_1[3,0]}], [{@table_1[3,1]}], [{@table_1[3,2]}], [{@table_1[3,3]}],
    [{@table_1[4,0]}], [{@table_1[4,1]}], [{@table_1[4,2]}], [{@table_1[4,3]}],
    table.hline(stroke: 0.8pt),
  ),
  caption: [Mean (SD) of the dependent measures for each condition ($N = 24$).],
  placement: top,
) <tab:results>

#figure(
  image("@image_2", width: 86%),
  caption: [NASA-TLX subscale scores by condition. Lower is better; error bars show one standard deviation.],
  placement: top,
) <fig:tlx>

@tab:results summarizes the outcomes. Participants finished the synthesis in {@table_1[1,2]} minutes with ThoughtWeave versus {@table_1[1,1]} minutes with the baseline, $t(23) = 5.12$, $p < .001$, $d = 1.05$. They also integrated more sources ({@table_1[2,2]} vs. {@table_1[2,1]}), so the gain rate in @eq:gain increased through both its numerator and its denominator.

Overall workload was lower with ThoughtWeave, $F(1, 22) = 12.4$, $p = .002$. As @fig:tlx shows, the largest differences appeared for mental demand, effort, and frustration, whereas physical demand was unaffected. Usability ratings rose from {@table_1[4,1]} to {@table_1[4,2]}.

= Discussion and Limitations

The benefit of ThoughtWeave appears to come from fewer representational shifts: the structure that guides foraging is the structure that is rendered as prose. The study has limitations: the task lasted under an hour and used a fixed set of papers, so it does not capture month-long reviews in which the schema changes repeatedly.

= Conclusion

We presented ThoughtWeave, a layered knowledge graph from which a manuscript is rendered directly. Keeping sources, evidence, and prose in one representation shortened synthesis and reduced workload in a controlled study.
