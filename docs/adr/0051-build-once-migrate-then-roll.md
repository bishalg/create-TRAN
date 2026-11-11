# ADR-0051 Build once, promote by digest, migrate then roll, roll back by redeploying

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [032](../specs/032-deploy-pipeline.md)

## Context

The template tests, releases a GitHub tag and builds an unsigned APK, and stops there. How the API reaches a server,
in what order, and how a bad release is undone were left to each fork, which is where the expensive mistakes are: an
image rebuilt per environment, so production runs something staging never tested; secrets baked into an image layer;
a container running as root with a full shell; a deploy that starts new code before its migration, or migrates from
three instances at once; traffic sent to a process that is not ready; a process killed mid-request; and a rollback
that fails because the schema already moved.

Earlier phases prepared the pieces: readiness and graceful shutdown (ADR-0040), migrations that keep the previous
version working and run as their own step (ADR-0049), configuration only from the environment (ADR-0039).

## Decision

1. **One image, small and locked down.** Multi-stage build, base images pinned by digest, no shell, non-root,
   read-only root filesystem. It contains the binary and its migrations, and no configuration.
2. **Build once, promote by digest.** The image built from the tag is the one staging tests and the one production
   runs. A tag can move; a digest cannot.
3. **Validate, migrate, start, wait for ready, then drain the old.** The order is one script for one reference target
   (two slots behind a proxy on one host), tested by running it against fake `docker`, `curl` and `ssh` executables;
   a failed readiness removes the new slot and leaves the old one serving. A fork replaces the target branch.
4. **Rollback is redeploying the previous digest.** No reverse migrations exist or are needed, because the schema
   always works with the previous release. The one-way doors (`-- contract:` migrations) are printed at deploy time.
5. **Prove the image by running it** in a smoke test: start, ready, a real request, `SIGTERM`, clean exit.
6. **Production is a manual, protected step.** Staging follows the tag; production needs a person and a GitHub
   environment's approval. With no target configured the workflow skips, and the live deploy test is switched off
   with a `TODO(credentials)` marker (ADR-0046).
7. **The reference target is Docker Compose on one host.** It is the smallest thing that exercises every step. A fork
   swaps the target for its platform (a container service, Kubernetes) and keeps the order.
8. **The web is static files plus a header file.** The headers a page cannot set for itself live in the repo and are
   tested against the page's own policy.
9. **Supply chain facts ship with the image:** an SBOM and a provenance attestation from the build itself.

## Consequences

- No cloud is chosen. The template shows the order and the guarantees, not a vendor's deploy syntax.
- With SQLite the database is a file on a volume, so the reference deploy is one host with a brief overlap of two
  processes on the same file. A fork with several hosts moves to a network database first (ADR-0049).
- A container runtime is needed to run the smoke test locally; without one it is skipped with a stated reason and
  still runs in CI.
- The deploy script is shell, proven by unit tests that run it against fake executables; the smoke test proves the
  image, not the script.
