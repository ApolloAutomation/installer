// One GitHub API lookup per repo+channel for the page session: variants that share
// a repo reuse it, which keeps well under the unauthenticated 60 requests/hour/IP.
// A failed lookup is evicted so a later render can retry.
const memo = new Map();

export function fetchReleaseNotes(repo, channel) {
  const key = `${repo}|${channel}`;
  if (!memo.has(key)) {
    const p = load(repo, channel);
    p.catch(() => memo.delete(key));
    memo.set(key, p);
  }
  return memo.get(key);
}

async function load(repo, channel) {
  const url = channel === 'stable'
    ? `https://api.github.com/repos/${repo}/releases/latest`
    : `https://api.github.com/repos/${repo}/releases?per_page=15`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  const rel = channel === 'stable' ? data : data.find((r) => r.prerelease);
  if (!rel) throw new Error('no release found for channel');
  return { name: rel.name || rel.tag_name, tag: rel.tag_name, body: rel.body || '', url: rel.html_url };
}
