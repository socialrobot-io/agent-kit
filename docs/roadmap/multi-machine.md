# Roadmap: multi-machine (deferred)

**Status:** shared storage shipped; AgentFS multi-machine items deferred.

Since 0.4, hosts that need many processes or machines use
Postgres storage, `@socialrobot-io/agent-kit-node/postgres` (see [Storage](../guides/storage.md)):
shared tables, per-tenant advisory locks, and a curator queue for workers.
The items below are about sharing one AgentFS volume, which still allows one
process at a time. Prefer self-hosted options. Do not require Turso Cloud in
`@socialrobot-io/agent-kit-*`.

- [ ] Same-host multi-process: [named sessions](https://docs.turso.tech/agentfs/guides/sessions) / shared `.db` coordination
- [ ] Remote: [AgentFS NFS](https://docs.turso.tech/agentfs/guides/nfs) (`agentfs serve nfs`, `nolock`, firewall/VPN)
- [ ] Cold move / HA: WAL checkpoint + copy/rsync of volume files
- [ ] Document [overlay](https://docs.turso.tech/agentfs/guides/overlay) as explicit host mode vs agent-home volume
- [ ] Optional host opt-in: [Turso Cloud sync](https://docs.turso.tech/agentfs/guides/sync) (never a package dependency)

Keep items deferred until a milestone implements them.
[Hosting](../guides/hosting.md) links here; it does not ship NFS.
