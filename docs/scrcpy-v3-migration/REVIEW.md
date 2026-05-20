# Migration-survey review

**Verdict: APPROVED.**

All four docs (`args.md`, `control.md`, `video.md`, `lifecycle.md`) carry
the required H2 sections (`Current state in this fork`, `Upstream gap`,
`Concrete changes needed`, `Risk / unknowns`), cite file paths with line
numbers in the survey sections, and name specific symbols + offsets in
the "Concrete changes" bullets. A future v3-adapter engineer can open
each doc and start editing without re-doing the research.

## Per-doc notes

### `args.md` — strong
Maps the entire 1.19-ws6 positional argv to the 3.x `key=value` parser
with a citation for every claim (`Constants.ts:3, :16, :20`,
`ScrcpyServer.ts:13`, `ServerVersion.ts:13`, `VideoSettings.ts:154-197`).
The renamed-args table (`args.md:272-282`) and the inventory of new
master options (`args.md:194-269`) are exactly the kind of artefact an
implementer needs. The pseudo-code `buildServerArgs` (`args.md:329-353`)
is concrete enough to drop in. **Minor weak spot:** the scid discussion
(`args.md:488-493`) hedges ("looks like a CLI flag and isn't really")
where `lifecycle.md` is definitive that scid *is* a CLI key. Not a
contradiction so much as a softer treatment; the implementer should
follow `lifecycle.md` on this point.

### `control.md` — strong
The wire diffs for touch (`control.md:138-174`), scroll (`:177-208`),
and clipboard (`:210-240`) are byte-level and immediately actionable.
The renumbering plan (`:280-307`) and the per-file change list (sections
C–H) name target files and constructors. The UHID gap is correctly
flagged as the largest piece of net-new work (`:361-381`). **Weak
spot:** `TYPE_ACK_CLIPBOARD`'s value is left as `?` (`:356`,
risk #5) — the implementer has to grep upstream `DeviceMessage.java`
before wiring it up. Acceptable for a survey, but worth a follow-up
WebFetch.

### `video.md` — strong
Captures the three structural breaks (one-WS → three sockets,
in-band `TYPE_CHANGE_STREAM_PARAMETERS` → CLI-only knobs, H.264-only
players → codec-id-driven dispatch) and pins each to a file+line
(`StreamReceiver.ts:48-54`, `BasePlayer.ts:162-170`,
`WebCodecsPlayer.ts:60`, the empty `H265Parser.ts`). The 16-byte
session prelude + 12-byte per-packet header are spelled out
(`video.md:202-272`). **Weak spot:** the packet-flag bit positions are
explicitly unpinned ("`(1ULL<<63)/(1ULL<<62)` vs `(1ULL<<62)/(1ULL<<61)`",
risk 1 at `:455-461`); this is the right call (defer until a JAR
version is pinned) but the implementer must do that read on day one,
since mis-shifting silently produces a black screen.

### `lifecycle.md` — strong
Most thorough on the upstream side: scid generation
(`:195-203`), socket-name derivation (`:215-230`),
`DesktopConnection.open` ordering (`:238-255`), the 64-byte device-meta
hello (`:260-264`), the dummy-byte vs reverse-tunnel distinction
(`:251-255`, `:319-329`), and the absence of any PID file upstream
(`:332-341`). The teardown contract (`:344-366`) is the clearest
piece of cross-cutting context in the survey set. Concrete changes
(`:382-512`) are numbered, file-anchored, and cover both the minimal
("just bump the version") and faithful migration paths.

## Cross-doc consistency

Checked for the standard contradiction surfaces — no blockers.

- **`scid` flow.** `lifecycle.md` is authoritative (generated host-side
  as a 31-bit int, formatted `scid=%08x`, used to derive
  `localabstract:scrcpy_<scid>`). `args.md:488-493` mentions scid
  briefly and `control.md` doesn't touch it. Not a contradiction, but
  the args doc could lean on lifecycle's treatment more explicitly.
- **`SERVER_VERSION` bump.** `args.md:315-318` and `lifecycle.md:393-397`
  both flag this; `args.md` presents two options (`'3.3.4-ws1'` if the
  fork is rebased, `'3.3.4'` if stock is adopted), `lifecycle.md`
  commits to the stock path. Compatible — they describe a fork in the
  decision tree, not a disagreement.
- **`ServerVersion.ts:13` suffix gate.** All four docs identify this as
  the version-compat blocker. No drift.
- **`send_frame_meta`.** `args.md` notes it survives as one bool among
  many in 3.x; `video.md:483-489` notes its semantics changed (it now
  gates the 12-byte packet header, not the in-band command). Different
  facets of the same arg — both correct, neither contradicts the other.
- **Audio defaults.** `args.md`, `video.md`, and `lifecycle.md` all
  recommend `audio=false` until the audio transport ships. Consistent.
- **`TYPE_CHANGE_STREAM_PARAMETERS` (101) is fork-private.**
  `control.md` keeps it in the 101 slot; `video.md` recommends dropping
  it for codec-level fields because upstream can't change them at
  runtime. Compatible — control.md preserves the byte slot, video.md
  says don't *use* it for codec fields. Implementer should treat this
  as "deprecate the semantic, leave the slot reserved."
- **Wire-format magics (`scrcpy_initial`, `scrcpy_message`).**
  `control.md`, `video.md`, and `lifecycle.md` all correctly flag these
  as ws6-only framing that upstream does not emit. Consistent.

No punch list — the survey is ready to be handed to an adapter engineer.
