export async function fetchReleaseNotes(repo, channel) {
  const url = channel === 'stable'
    ? `https://api.github.com/repos/${repo}/releases/latest`
    : `https://api.github.com/repos/${repo}/releases?per_page=15`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  const rel = channel === 'stable' ? data : data.find((r) => r.prerelease);
  if (!rel) throw new Error('no release found for channel');
  return { name: rel.name || rel.tag_name, body: rel.body || '', url: rel.html_url };
}
