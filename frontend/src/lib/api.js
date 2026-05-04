export async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, credentials: 'include' });
  if (res.status === 401) {
    // Session expirée côté serveur → recharger pour retomber sur la page login
    window.location.reload();
  }
  return res;
}
