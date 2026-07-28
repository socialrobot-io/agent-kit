# Roadmap: multi-machine (deferred)

**Status:** deferred. v0.1 = one process, one open AgentFS volume, serialized FS.
Prefer self-hosted options. Do not require Turso Cloud in `@socialrobot-io/agent-kit-*`.

- [ ] Same-host multi-process: [named sessions](https://docs.turso.tech/agentfs/guides/sessions) / shared `.db` coordination
- [ ] Remote: [AgentFS NFS](https://docs.turso.tech/agentfs/guides/nfs) (`agentfs serve nfs`, `nolock`, firewall/VPN)
- [ ] Cold move / HA: WAL checkpoint + copy/rsync of volume files
- [ ] Document [overlay](https://docs.turso.tech/agentfs/guides/overlay) as explicit host mode vs agent-home volume
- [ ] Optional host opt-in: [Turso Cloud sync](https://docs.turso.tech/agentfs/guides/sync) (never a package dependency)

Keep items deferred until a milestone implements them.
[Hosting](../guides/hosting.md) links here; it does not ship NFS.
