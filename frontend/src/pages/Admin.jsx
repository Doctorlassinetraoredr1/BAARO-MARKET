import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card } from '../ui/Card.jsx';

export function AdminPage({setError}) {
  const {session}=useAuth(); const [stats,setStats]=useState(null);
  useEffect(()=>{ if(!session)return; api('/api/market',{method:'POST',token:session.access_token,body:{action:'adminDashboard'}}).then(d=>setStats(d.stats)).catch(e=>setError(e.message)); },[session,setError]);
  if(!session) return <Card><h2>Administration</h2><p>Connectez-vous avec un compte administrateur.</p></Card>;
  if(!stats) return <p>Chargement…</p>;
  const cards=[['Boutiques',stats.shops],['Produits à modérer',stats.pending_products],['Commandes',stats.orders],['Litiges ouverts',stats.open_disputes],['Avis à vérifier',stats.flagged_reviews]];
  return <section><div className="mb-5"><h1 className="text-2xl font-bold">Centre d’administration</h1><p className="muted">Vue opérationnelle de BAARO MARKET.</p></div><div className="grid grid-cols-2 md:grid-cols-5 gap-3">{cards.map(([l,v])=><Card key={l}><div className="muted">{l}</div><div className="text-3xl font-extrabold">{v}</div></Card>)}</div><Card className="mt-5"><h2 className="font-bold mb-2">Contrôles prioritaires</h2><ul className="list-disc pl-5 space-y-1"><li>Traiter les produits en attente de modération.</li><li>Examiner les avis signalés par le Trust Engine.</li><li>Suivre les litiges et remboursements.</li><li>Surveiller les commandes et la qualité des vendeurs.</li></ul></Card></section>;
}
