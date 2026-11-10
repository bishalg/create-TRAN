# Deploy playbook

What it is: turning the API into one container image and moving it to servers, and publishing the web app. Why it is
here: the costly release mistakes are in the order of steps and in what the image contains, and they are the same on
every platform. Rules: [spec 032](./specs/032-deploy-pipeline.md). Reasons:
[ADR-0051](./adr/0051-build-once-migrate-then-roll.md). Mobile: [MOBILE_RELEASE.md](./MOBILE_RELEASE.md).

## The rules

1. **Build once.** The image from the version tag is the one every environment runs. Deploy by digest, never rebuild.
2. **Nothing environment-specific in the image.** No secrets, no URLs. Configuration comes from the environment.
3. **Small and locked down.** Pinned base images, no shell, non-root, read-only root filesystem.
4. **One order:** check config → migrate → start new → wait for ready → drain old.
5. **Never send traffic before ready, never kill without draining.**
6. **Rollback is redeploying the previous digest.** It works because migrations keep the previous version running
   ([PERSISTENCE.md](./PERSISTENCE.md)). Know your one-way doors: `-- contract:` migrations.
7. **Production is a manual, approved step.** Staging follows the tag.
8. **Prove the image by running it** (`pnpm deploy:smoke`), not by reading the Dockerfile.

## A release

```
pnpm release auto → tag vX.Y.Z → push          version, changelog (spec 017)
CI builds the image once, with SBOM            → registry, digest recorded
staging:    scripts/deploy.sh staging <digest>   automatic
            check config → migrate → start → ready → drain old
test staging
production: Actions → Deploy → production       manual, approved; the same digest
bad?        scripts/deploy.sh production <previous digest>
```

## Where it lives

| Part                              | Place                                      |
| :-------------------------------- | :----------------------------------------- |
| Image                             | `apps/api/Dockerfile`, `.dockerignore`     |
| Deploy order and reference target | `scripts/deploy.sh`, `deploy/compose.yaml` |
| Config validation                 | `cargo run -p api -- check-config`         |
| Pipeline                          | `.github/workflows/deploy.yml`             |
| Web headers and cache rules       | `deploy/web/`                              |
| Image smoke test                  | `pnpm deploy:smoke`                        |

## What a fork adds

- **Its target:** replace the Compose target with its platform's commands; keep the order and the readiness gate.
- **Registry and host credentials** in the protected GitHub environments ([CREDENTIALS.md](./CREDENTIALS.md)).
- **A network database** before running more than one host.
- **TLS and a proxy or load balancer** in front, with `TRUSTED_PROXIES` set ([RATE_LIMITING.md](./RATE_LIMITING.md)).
- **Backups before each migration** and a restore drill.
- **Alerts** on the deploy: error rate and readiness, from [OBSERVABILITY.md](./OBSERVABILITY.md).
