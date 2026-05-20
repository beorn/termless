# Visual Eyes Phase 7 — parser-divergence fixture.
#
# The Type line contains a literal C1 NEL control byte (U+0085) between
# "ab" and "cd". xterm.js honours NEL as "next line" (=> ab / cd on two
# rows); ghostty-web treats the byte as inert (=> abcd on one row).
# Rendered through the same canvas, the diff overlay lights up red.
Set Width 16
Set Height 3
Type "abcd"
Screenshot
