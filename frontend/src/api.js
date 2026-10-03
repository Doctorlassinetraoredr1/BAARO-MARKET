export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Réseau indisponible. Vérifiez votre connexion.');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Réponse invalide (${res.status})`);
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}
