# Your license scanner is answering the wrong question

*Draft for dev.to / personal blog. Written to stand on its own — the tool is
mentioned once, at the end. If it reads like an ad for the tool, it has failed
and should be cut back further.*

---

Run a license scanner over a typical Node or Python project and you get a table:
package, license, risk level. `GPL-3.0` comes back red. `MIT` comes back green.
`MPL-2.0` comes back yellow, probably.

That table is answering a question nobody asked, which is *"is this license
scary?"* The question you actually have is *"does this obligate me to do
something?"* — and for a large fraction of licenses, the honest answer is: it
depends on facts the scanner never asked you about.

## Copyleft obligations attach to events, not to code

Read GPL-3.0 looking for the trigger and you find it in section 5: the
requirement to license the whole work under the same terms and make
corresponding source available applies when you **convey** the work. Conveying
is distribution. If you never distribute, the obligation never fires.

So consider a hosted SaaS product with a GPL-3.0 library in `node_modules`,
running on your own servers, with users reaching it over HTTPS.

You have not distributed anything. Nobody received a copy. The obligation does
not arise.

Your scanner said red.

Now consider the same library, same version, same lockfile, in a desktop app you
ship to customers. Distribution. The obligation fires, and it fires on *the
whole work* — your proprietary code included.

Your scanner said red. Same red. Same shade of red.

One of those two answers was useless. The scanner had no way to tell them apart,
because it never asked how the software reaches its users.

## The AGPL exists precisely because that gap is real

The Free Software Foundation noticed the SaaS hole and wrote a license to close
it. AGPL-3.0 section 13 adds an obligation the GPL does not have: if users
interact with a modified version **over a network**, you must offer them the
corresponding source of the whole work.

That single clause is the entire practical difference for a hosted service:

| | Hosted SaaS | Distributed binary | Internal only |
|---|---|---|---|
| GPL-3.0 | no obligation | obligation fires | no obligation |
| AGPL-3.0 | **obligation fires** | obligation fires | no obligation |

Two licenses that most tools file under the same "strong copyleft, high risk"
heading, producing opposite answers for the deployment model most companies
actually use.

And note the third column. For internal-only software — an internal dashboard,
a build tool, something that never leaves the company — neither license
obligates you to disclose anything. Not because of a loophole, but because
neither distribution nor network interaction with outside users ever happens.

## Dev dependencies are a different question entirely

This one causes more unnecessary panic than anything else.

If a GPL-3.0 package appears in your lockfile as a dev dependency — a test
runner, a linter, a bundler — it is not part of the artifact you ship. No
distribution of *that package* occurs. No obligation arises.

The caveat worth stating out loud: tools that **emit code into your output** are
a separate case. A code generator whose templates land in your shipped source is
not the same as a linter that only reads your source. Worth checking
individually rather than assuming.

Most scanners flatten this too. `dependencies` and `devDependencies` are right
there in the manifest, distinguished by the ecosystem itself, and the report
still shows one risk column.

## Not every license works this way

It is worth being precise about which licenses this distinction actually
changes, because "it depends" is not useful if it applies to everything.

**It changes the answer for:** GPL, AGPL, LGPL, and the source-available
licenses like SSPL and BUSL — anything whose trigger is a distribution or
network-interaction event.

**It does not change the answer for:** MIT, Apache-2.0, BSD. Permissive licenses
ask for attribution and not much else, in every model. Apache-2.0 adds a patent
grant and a NOTICE requirement, which are obligations, but they do not vary by
how you ship.

**MPL-2.0 is the interesting middle.** Its copyleft is per *file*, not per
project. Files it covers stay under it and their modifications must be
published; your own files carry whatever terms you choose. It treats static and
dynamic linking alike. So the shipping model barely matters — but for a reason
that is the opposite of the permissive case: the obligation is real, it is just
scoped narrowly enough that it does not reach your code.

Three genuinely different mechanisms. One risk column cannot represent them.

## Linkage is the second axis

For compiled languages there is a further fact the manifest does not tell you.

LGPL's whole design is that you may use the library in a proprietary work
provided the user can replace it — which dynamic linking gives you almost for
free, and static linking does not. In Go and Rust, static linking is the
default. So the same LGPL dependency has a materially different answer in a Rust
binary than in a Node application, and nothing in `Cargo.lock` says so.

## What to do about it

Nothing exotic. When you look at a license question, fix three facts first:

1. **How does this reach users?** Hosted, distributed binary, delivered to a
   customer's environment, internal only, or published as a library.
2. **Is it in the shipped artifact?** Runtime or dev-only.
3. **How is it linked?** Static or dynamic — only matters for compiled
   languages and only for a few licenses.

With those three fixed, most "it depends" answers collapse into one answer. Not
a risk score — an actual yes or no, with the clause that produced it.

That is also the honest reason a scanner cannot do this for you out of the box:
two of those three facts are not in your repository. They are facts about your
business.

---

*I got annoyed enough at re-deriving this by hand that I built a small free tool
that takes the shipping model as an input and gives the per-model answer with
the clause behind it: <https://licenseguard.tenchorooms.com>. It also runs as an
MCP server if you want your coding agent to stop guessing at this. Source is
Apache-2.0 on GitHub.*

*Not legal advice. It tells you which clause is implicated and why, which is the
part that is mechanical. Whether it applies to your situation is not.*
