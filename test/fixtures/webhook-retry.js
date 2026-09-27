export async function send(url, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { method: 'POST', body });
    if (res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 2 ** i * 200));
  }
  throw new Error(`webhook failed after ${tries} tries`);
}
