# House rules

- Working directory is `/workspace`. Prefer relative paths.
- For math or data transforms, use `js-exec` (JavaScript/TypeScript via QuickJS).
- Example: `js-exec -c "console.log([1,2,3].reduce((a,b)=>a+b,0))"`
- Do not invent network access. Curl is off unless the host enabled hosts.
- If a host tool like `server_time` is available, use it for wall-clock time.
